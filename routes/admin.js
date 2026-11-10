// routes/admin.js
// لوحة تحكم الأدمن: عرض كل اليوزرز وعدد الأجهزة (Sessions) بتاعة كل واحد، إنهاء
// جلسة جهاز معين، إضافة/حذف عداد (Meter) ليوزر معين، وقفل/تفعيل الاشتراك (Card
// Lock) - كل الراوتس هنا محمية بـ authMiddleware + adminMiddleware (role: 'admin' بس)
const express = require('express');
const router = express.Router();

const store = require('../data/store');
const { users: mockUsers } = require('../data/mockData');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const User = require('../models/User');

router.use(authMiddleware, adminMiddleware);

// اليوزرز عندنا نوعين: يوزرز محليين (mockData.js - id رقم زي 1، 2) ويوزرز
// اتسجلوا بالـ Sign Up (MongoDB - id عبارة عن ObjectId hex string). الدالة دي
// بتحدد نوع الـ id جاي من الـ route عشان نعرف نتعامل معاه إزاي في كل راوت تحت
function isMockId(id) {
  return mockUsers.some((u) => String(u.id) === String(id));
}

// GET /api/admin/users -> قائمة كل اليوزرز (محليين + MongoDB) مع عدد العدادات
// وعدد الأجهزة المسجل دخولها وحالة الاشتراك بتاعة كل واحد
router.get('/users', async (req, res) => {
  // اليوزرز المحليين (admin/demo) دايمًا متاحين حتى لو الداتابيز واقعة
  const localList = mockUsers.map((u) => ({
    id: String(u.id),
    username: u.username,
    name: u.name,
    role: u.role || 'user',
    isSubscribed: u.isSubscribed !== false,
    meterCount: store.countDevicesForOwner(u.id),
    deviceCount: store.getSessionsForUser(u.id).length,
    maxDevices: store.MAX_DEVICES_PER_USER,
  }));

  // لو MongoDB مش متاحة، منقفلش الصفحة كلها - نرجع اليوزرز المحليين بس مع تنبيه
  let dbList = [];
  let dbError = null;
  try {
    const dbUsers = await User.find({}, 'username role isSubscribed sessions');
    dbList = dbUsers.map((u) => ({
      id: String(u._id),
      username: u.username,
      name: u.username,
      role: u.role || 'user',
      isSubscribed: u.isSubscribed !== false,
      meterCount: store.countDevicesForOwner(String(u._id)),
      deviceCount: u.sessions.length,
      maxDevices: store.MAX_DEVICES_PER_USER,
    }));
  } catch (error) {
    console.error('[Admin] Failed to list MongoDB users:', error.message);
    dbError = 'Could not reach the database - showing local accounts only.';
  }

  res.json({ users: [...localList, ...dbList], ...(dbError ? { dbError } : {}) });
});

// GET /api/admin/users/:id/sessions -> الأجهزة المسجل دخولها ليوزر معين بالتفصيل
router.get('/users/:id/sessions', async (req, res) => {
  const { id } = req.params;
  try {
    if (isMockId(id)) {
      return res.json({ sessions: store.getSessionsForUser(Number(id)) });
    }
    const dbUser = await User.findById(id, 'sessions');
    if (!dbUser) return res.status(404).json({ message: 'User not found' });
    res.json({ sessions: dbUser.sessions });
  } catch (error) {
    res.status(404).json({ message: 'User not found' });
  }
});

// DELETE /api/admin/users/:id/sessions/:sessionId -> إنهاء جلسة جهاز معين (فك
// الارتباط) - بيحرر مكان لجهاز جديد يقدر يسجل دخول بدله
router.delete('/users/:id/sessions/:sessionId', async (req, res) => {
  const { id, sessionId } = req.params;
  try {
    if (isMockId(id)) {
      const ok = store.terminateSession(Number(id), sessionId);
      if (!ok) return res.status(404).json({ message: 'Session not found' });
      return res.json({ message: 'Session terminated' });
    }
    const dbUser = await User.findById(id);
    if (!dbUser) return res.status(404).json({ message: 'User not found' });
    const before = dbUser.sessions.length;
    dbUser.sessions = dbUser.sessions.filter((s) => s.sessionId !== sessionId);
    if (dbUser.sessions.length === before) {
      return res.status(404).json({ message: 'Session not found' });
    }
    await dbUser.save();
    res.json({ message: 'Session terminated' });
  } catch (error) {
    console.error('[Admin] Failed to terminate session:', error.message);
    res.status(500).json({ message: 'Failed to terminate session' });
  }
});

// PATCH /api/admin/users/:id/subscription -> قفل/تفعيل الاشتراك (الكارت/الخدمة)
// body: { isSubscribed: true|false }
router.patch('/users/:id/subscription', async (req, res) => {
  const { id } = req.params;
  const { isSubscribed } = req.body;
  if (typeof isSubscribed !== 'boolean') {
    return res.status(400).json({ message: 'isSubscribed (boolean) is required' });
  }
  try {
    if (isMockId(id)) {
      const updated = store.setMockUserSubscription(Number(id), isSubscribed);
      if (!updated) return res.status(404).json({ message: 'User not found' });
      return res.json({ message: 'Subscription updated', isSubscribed: updated.isSubscribed });
    }
    const dbUser = await User.findByIdAndUpdate(id, { isSubscribed }, { new: true });
    if (!dbUser) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Subscription updated', isSubscribed: dbUser.isSubscribed });
  } catch (error) {
    console.error('[Admin] Failed to update subscription:', error.message);
    res.status(404).json({ message: 'User not found' });
  }
});

// GET /api/admin/users/:id/meters -> العدادات/الكروت المملوكة ليوزر معين بالظبط
router.get('/users/:id/meters', (req, res) => {
  const { id } = req.params;
  const ownerId = isMockId(id) ? Number(id) : id;
  res.json({ meters: store.getDevicesForOwner(ownerId) });
});

// POST /api/admin/users/:id/meters -> إضافة عداد/كارت جديد ليوزر معين مباشرة
// body: { name, type: 'sensor'|'relay'|'valve', mqttUnid?, location? }
router.post('/users/:id/meters', (req, res) => {
  const { id } = req.params;
  const { name, type, mqttUnid, location } = req.body;

  if (!name || !type) {
    return res.status(400).json({ message: 'Name and type are required' });
  }
  if (!['sensor', 'relay', 'valve'].includes(type)) {
    return res
      .status(400)
      .json({ message: "type must be 'sensor', 'relay', or 'valve'" });
  }

  const ownerId = isMockId(id) ? Number(id) : id;
  const device = store.addDevice({ name, type, mqttUnid, location, ownerId });
  res.status(201).json({ device });
});

// DELETE /api/admin/meters/:deviceId -> حذف/مسح عداد بالكامل من النظام
router.delete('/meters/:deviceId', (req, res) => {
  const ok = store.deleteDevice(req.params.deviceId);
  if (!ok) return res.status(404).json({ message: 'Device not found' });
  res.json({ message: 'Meter removed' });
});

module.exports = router;
