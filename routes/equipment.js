// routes/equipment.js
const express = require('express');
const router = express.Router();

const store = require('../data/store');
const { authMiddleware } = require('../middleware/auth');
const { subscriptionMiddleware } = require('../middleware/subscription');

// كل الراوتس هنا لازم توكن صالح
router.use(authMiddleware);
// وكمان لازم الاشتراك يكون مفعّل (الأدمن ممكن يقفل الكارت/الخدمة من لوحة التحكم)
router.use(subscriptionMiddleware);

// GET /api/equipment  -> ترجع أجهزة اليوزر الحالي بس (+ أي جهاز اتسجل تلقائي
// من MQTT ولسه محدش استلمه) - كل يوزر معزول تمامًا عن أجهزة اليوزرز التانيين
router.get('/', (req, res) => {
  res.json({ devices: store.getDevicesForUser(req.user.id) });
});

// GET /api/equipment/:id -> جهاز واحد بالتفصيل (بيانات + لوكيشن + id)
router.get('/:id', (req, res) => {
  const device = store.findByIdForUser(req.params.id, req.user.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }
  res.json({ device });
});

// POST /api/equipment -> إضافة جهاز/كارت جديد بـ id تلقائي - بيبقى ملك اليوزر
// اللي ضافه على طول (ownerId)، محدش تاني يقدر يشوفه
// body: { name, type: 'sensor'|'relay'|'valve', mqttUnid?, location?: { label, lat, lng } }
router.post('/', (req, res) => {
  const { name, type, mqttUnid, location } = req.body;

  if (!name || !type) {
    return res.status(400).json({ message: 'Name and type are required' });
  }
  if (!['sensor', 'relay', 'valve'].includes(type)) {
    return res
      .status(400)
      .json({ message: "type must be 'sensor', 'relay', or 'valve'" });
  }

  const device = store.addDevice({
    name,
    type,
    mqttUnid,
    location,
    ownerId: req.user.id,
  });
  res.status(201).json({ device });
});

// POST /api/equipment/:id/claim -> استلام جهاز اتسجل تلقائي من MQTT (ownerId=null)
// وضمه لحساب اليوزر الحالي - بعد كده هيختفي من عند أي يوزر تاني
router.post('/:id/claim', (req, res) => {
  const device = store.claimDevice(req.params.id, req.user.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }
  res.json({ device });
});

// PATCH /api/equipment/:id/control -> للتحكم في relay/valve (on/off)
router.patch('/:id/control', (req, res) => {
  const { state } = req.body; // 'on' | 'off'
  const device = store.findByIdForUser(req.params.id, req.user.id);

  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }
  if (!device.control) {
    return res.status(400).json({ message: 'This device does not support control' });
  }
  if (!['on', 'off'].includes(state)) {
    return res.status(400).json({ message: "state must be 'on' or 'off'" });
  }

  // TODO: الفيرموير الحالي بيدعم فقط device/{unid}/ping و pong (health check)
  // لسه مفيش أمر تحكم فعلي عن طريق MQTT، لازم نضيف topic زي device/{unid}/set
  // في الفيرموير الأول عشان الأمر ده يوصل فعلياً للريلاي/الفالف
  const updated = store.setControlState(req.params.id, state, req.user.id);

  res.json({ device: updated });
});

// PATCH /api/equipment/:id/favorite -> تفعيل/إلغاء المفضلة لجهاز (بتظهر بعدين في صفحة Favorite)
// body: { favorite: true|false }
router.patch('/:id/favorite', (req, res) => {
  const { favorite } = req.body;
  const device = store.setFavorite(req.params.id, favorite, req.user.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }
  res.json({ device });
});

// GET /api/equipment/:id/logs -> سجل القرايات (flow/velocity/totalizer) بتاع عداد معين
// query: ?limit=200 (اختياري) - بيرجع الأحدث الأول، مفيد لصفحة Reports وتحميل CSV
router.get('/:id/logs', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
  const logs = store.getLogsById(req.params.id, { limit }, req.user.id);
  if (logs === null) {
    return res.status(404).json({ message: 'Device not found' });
  }
  res.json({ logs });
});

// PATCH /api/equipment/:id -> تعديل بيانات جهاز (زي اللوكيشن أو الاسم)
// أي تعديل هنا (خصوصًا إعادة تسمية جهاز اتسجل تلقائي auto-register) بيتحفظ على الديسك
// فورًا، فهيفضل زي ما هو حتى لو السيرفر اتقفل وترستارت
router.patch('/:id', (req, res) => {
  const device = store.findByIdForUser(req.params.id, req.user.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }
  const { name, location, mqttUnid } = req.body;
  const updated = store.updateDevice(
    req.params.id,
    { name, location, mqttUnid },
    req.user.id
  );

  res.json({ device: updated });
});

module.exports = router;
