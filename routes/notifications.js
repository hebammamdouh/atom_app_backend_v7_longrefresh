// routes/notifications.js
// نوتفيكيشنز اليوزر: أونلاين/أوفلاين + تنبيهات الفلو (high/low) + تنبيه التوتال
// دي بتتولد تلقائي من data/store.js كل ما جهاز يغير حالته أو يعدي عتبة محددة
const express = require('express');
const router = express.Router();

const store = require('../data/store');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/notifications?limit=50 -> الأحدث الأول + عدد الغير مقروء
router.get('/', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
  const notifications = store.getNotificationsForUser(req.user.id, { limit });
  const unreadCount = store.getUnreadCountForUser(req.user.id);
  res.json({ notifications, unreadCount });
});

// PATCH /api/notifications/:id/read -> تعليم نوتفيكيشن واحدة كمقروءة
router.patch('/:id/read', (req, res) => {
  const notif = store.markNotificationRead(req.params.id, req.user.id);
  if (!notif) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  res.json({ notification: notif });
});

// POST /api/notifications/read-all -> تعليم كل النوتفيكيشنز كمقروءة (زرار في أعلى الصفحة)
router.post('/read-all', (req, res) => {
  store.markAllNotificationsRead(req.user.id);
  res.json({ success: true });
});

module.exports = router;
