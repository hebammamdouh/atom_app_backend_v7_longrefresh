// services/mqttService.js
//
// ده بيتكلم مع نفس الـ MQTT broker والـ topics المستخدمة في فيرموير الـ ESP32
// (wifi_telegram_modbus.ino) - يعني أي جهاز حقيقي شغال بالكود ده هيتوصل هنا تلقائي.
//
// من الفيرموير:
//   mqtt_server  = "devgadbadr.me"
//   mqtt_port    = 1883
//   flow_topic   = "sensors/flow"     -> { "total":.., "flow":.., "velocity":.., "unid":"<platformUID>" }
//   status_topic = "status/meters"    -> { "status":"connected"|"disconnected", "unid":"<platformUID>" }
//
// كل جهاز بيبعت على نفس الـ topics، والفرق بينهم هو حقل "unid" (ده اللي احنا سميناه mqttUnid).
// عشان جهاز جديد يظهر في الأبليكشن، لازم تضيفيه أولاً (POST /api/equipment) وتحطي
// نفس platformUID بتاعه في حقل mqttUnid، أو فعّلي AUTO_REGISTER_UNKNOWN_DEVICES تحت
// عشان أي جهاز يبعت بيانات لأول مرة يتسجل تلقائي.

const mqtt = require('mqtt');
const store = require('../data/store');

const MQTT_HOST = process.env.MQTT_HOST || 'devgadbadr.me';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const FLOW_TOPIC = process.env.MQTT_FLOW_TOPIC || 'sensors/flow';
const STATUS_TOPIC = process.env.MQTT_STATUS_TOPIC || 'status/meters';

// لو true: أي جهاز يبعت بيانات بـ unid مش موجود عندنا، هنضيفه تلقائي كـ "New Device"
// مفيد وقت الاختبار الأول، ممكن تقفليه بعدين (خليها false) لما تحبي تضبطي الأجهزة يدوي فقط
const AUTO_REGISTER_UNKNOWN_DEVICES =
  (process.env.MQTT_AUTO_REGISTER || 'true') === 'true';

// كل جهاز مش باعت رسالة لمدة أكتر من كده، هيتحط Offline تلقائي
const OFFLINE_TIMEOUT_MS = 30000;

let client = null;

function connectMqtt() {
  const url = `mqtt://${MQTT_HOST}:${MQTT_PORT}`;
  console.log(`[MQTT] Connecting to ${url} ...`);

  client = mqtt.connect(url, {
    clientId: `atom-backend-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000, // يحاول يتصل تاني كل 5 ثواني لو اتقطع
  });

  client.on('connect', () => {
    console.log('[MQTT] ✅ Connected to broker');
    client.subscribe([FLOW_TOPIC, STATUS_TOPIC], (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err.message);
      } else {
        console.log(`[MQTT] Subscribed to "${FLOW_TOPIC}" and "${STATUS_TOPIC}"`);
      }
    });
  });

  client.on('message', (topic, payloadBuffer) => {
    const raw = payloadBuffer.toString();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn(`[MQTT] Received non-JSON payload on ${topic}:`, raw);
      return;
    }

    const unid = data.unid;
    if (!unid) return;

    if (topic === FLOW_TOPIC) {
      handleFlowMessage(unid, data);
    } else if (topic === STATUS_TOPIC) {
      handleStatusMessage(unid, data);
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Connection error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
  });
}

function handleFlowMessage(unid, data) {
  let device = store.findByMqttUnid(unid);

  if (!device && AUTO_REGISTER_UNKNOWN_DEVICES) {
    // ownerId: null يعني "لسه مش مستلم" - هيبان لكل اليوزرز لحد ما حد يتفاعل معاه
    // (تسمية/فيفورت/تحكم) فيبقى ملكه هو بس تلقائي (auto-claim - شوفي data/store.js)
    device = store.addDevice({
      name: `Device ${unid.slice(0, 8)}`,
      type: 'sensor',
      mqttUnid: unid,
      ownerId: null,
    });
    console.log(`[MQTT] 🆕 Auto-registered new device: ${device.id} (unid=${unid})`);
  }

  if (!device) {
    console.log(`[MQTT] Data from unknown unid (ignored, auto-register off): ${unid}`);
    return;
  }

  store.updateReadingsByUnid(unid, {
    flow: data.flow,
    velocity: data.velocity,
    total: data.total,
  });
}

function handleStatusMessage(unid, data) {
  const device = store.findByMqttUnid(unid);
  if (!device) return; // لسه معندناش الجهاز ده مسجل، هيتسجل أول ما يبعت قراءة على flow_topic
  store.updateStatusByUnid(unid, data.status);
  console.log(`[MQTT] Status update: ${device.name} -> ${data.status}`);
}

// فحص دوري كل 10 ثواني: أي جهاز عدى عليه وقت طويل من غير رسائل يتحط Offline
function startStaleCheckLoop() {
  setInterval(() => {
    store.markStaleDevicesOffline(OFFLINE_TIMEOUT_MS);
  }, 10000);
}

function initMqtt() {
  connectMqtt();
  startStaleCheckLoop();
}

module.exports = { initMqtt };
