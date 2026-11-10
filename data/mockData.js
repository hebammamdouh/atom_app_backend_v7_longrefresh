// data/mockData.js
// بيانات مبدئية (Mock) لحد ما نوصل الـ Backend بالـ RTU الحقيقي (Modbus / GSM / إلخ)
// كل جهاز عنده: id, name, type, online status, readings, وممكن يكون فيه control (relay/valve)
//
// ownerId: أي جهاز عنده ownerId بيبقى ملك اليوزر ده بس (فصل كامل بين اليوزرز).
// الأجهزة التجريبية دي كلها ملك حساب "admin" (id: 1) عشان تفضل زي ما هي بالظبط
// من غير ما يتغير أي حاجة في تجربتك الحالية.

// كل جهاز فعلي (RTU) عنده "platformUID" فريد بيبعته في رسائل الـ MQTT (حقل "unid")
// لازم الـ mqttUnid هنا يطابق بالظبط الـ platformUID المكتوب في فيرموير الجهاز
// (متغير platformUID في wifi_telegram_modbus.ino)
let devices = [
  {
    id: 'relay-op-4ids',
    name: 'RELAY OP 4IDs',
    type: 'relay',
    mqttUnid: null, // مفيش MQTT للتحكم لسه في الفيرموير الحالي
    ownerId: 1,
    online: false,
    lastSeen: null,
    onlineSince: null,
    offlineSince: null,
    location: { label: '', lat: null, lng: null },
    control: {
      label: 'Pump Control',
      state: 'off', // 'off' | 'on'
    },
    favorite: false,
    logs: [],
  },
  {
    id: 'gsm-data-test',
    name: 'GSM DATA TEST',
    type: 'sensor',
    mqttUnid: '08941d32-8b9c-4df1-88dd-854f1cfbbf81', // مثال - غيريه بالـ UID الحقيقي بتاع الجهاز ده
    ownerId: 1,
    online: false,
    lastSeen: null,
    onlineSince: null,
    offlineSince: null,
    location: { label: 'Nasr City Pump Station', lat: 30.0626, lng: 31.3219 },
    readings: {
      flow: { value: 0.0, unit: 'm3/h' },
      velocity: { value: 0.0, unit: 'm/s' },
      totalizer: { value: 0.0, unit: 'm3' },
    },
    favorite: false,
    // سجل القرايات (كل قراية جديدة بتوصل من الجهاز بتتضاف هنا) - ده اللي شاشة Reports بتعرضه
    logs: [],
  },
  {
    id: 'modbus-esp32s',
    name: 'MODBUS-ESP32S',
    type: 'sensor',
    mqttUnid: null, // ضيفي UID الجهاز الحقيقي هنا وقت التجربة
    ownerId: 1,
    online: false,
    lastSeen: null,
    onlineSince: null,
    offlineSince: null,
    location: { label: 'Downtown Water Station', lat: 30.0455, lng: 31.2357 },
    readings: {
      flow: { value: 0.0, unit: 'm3/h' },
      velocity: { value: 0.0, unit: 'm/s' },
      totalizer: { value: 0.0, unit: 'm3' },
    },
    favorite: false,
    logs: [],
  },
  {
    id: 'valve',
    name: 'valve',
    type: 'valve',
    mqttUnid: null,
    ownerId: 1,
    online: false,
    lastSeen: null,
    onlineSince: null,
    offlineSince: null,
    location: { label: '', lat: null, lng: null },
    control: {
      label: 'Valve Control',
      state: 'off',
    },
    favorite: false,
    logs: [],
  },
  {
    id: 'ultrasonic-esp32s',
    name: 'ULTRASONIC-ESP32S',
    type: 'sensor',
    mqttUnid: null,
    ownerId: 1,
    online: false,
    lastSeen: null,
    onlineSince: null,
    offlineSince: null,
    location: { label: '', lat: null, lng: null },
    readings: {
      flow: { value: 0.0, unit: 'm3/h' },
      velocity: { value: 0.0, unit: 'm/s' },
      totalizer: { value: 0.0, unit: 'm3' },
    },
    favorite: false,
    logs: [],
  },
  {
    id: 'atom-lab',
    name: 'ATOM LAB',
    type: 'sensor',
    mqttUnid: null,
    ownerId: 1,
    online: false,
    lastSeen: null,
    onlineSince: null,
    offlineSince: null,
    location: { label: '', lat: null, lng: null },
    readings: {
      flow: { value: 0.0, unit: 'm3/h' },
      velocity: { value: 0.0, unit: 'm/s' },
      totalizer: { value: 0.0, unit: 'm3' },
    },
    favorite: false,
    logs: [],
  },
];

// مستخدمين تجريبيين للـ Login (هنستبدلهم بقاعدة بيانات حقيقية بعدين)
// ضفنا يوزر تاني (demo) بأجهزة فاضية عشان تقدري تجربي وتتأكدي إن الفصل شغال:
// سجلي دخول بـ admin هتلاقي نفس الـ 6 أجهزة المعتادة، وسجلي بـ demo هتلاقي الهوم فاضي
const users = [
  {
    id: 1,
    username: 'admin',
    // كلمة السر: admin123 (متشفرة بـ bcrypt وقت التشغيل الأول - راجعي routes/auth.js)
    password: 'admin123',
    name: 'Admin User',
    // role: 'admin' يفتح صلاحيات لوحة التحكم (routes/admin.js) - أي يوزر تاني role: 'user'
    role: 'admin',
    // isSubscribed: لو false يبقى الكارت/الخدمة مقفولة (subscriptionMiddleware بيمنع الوصول
    // لـ /api/equipment كله) - الأدمن هو اللي بيتحكم فيها من لوحة التحكم
    isSubscribed: true,
  },
  {
    id: 2,
    username: 'demo',
    password: 'demo123',
    name: 'Demo User',
    role: 'user',
    isSubscribed: true,
  },
];

module.exports = { devices, users };
