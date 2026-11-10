// routes/settings.js
// إعدادات التنبيهات الخاصة باليوزر: Flow High / Flow Low / Total Threshold
// كل يوزر عنده نسخته الخاصة من العتبات دي (مش إعداد عام للتطبيق كله)
const express = require('express');
const router = express.Router();

const store = require('../data/store');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/settings -> يرجع عتبات التنبيه الحالية لليوزر (null يعني التنبيه ده مقفول)
router.get('/', (req, res) => {
  res.json({ settings: store.getSettingsForUser(req.user.id) });
});

// PATCH /api/settings -> تحديث عتبة واحدة أو أكتر
// body: { flowHigh?: number|null, flowLow?: number|null, totalThreshold?: number|null }
router.patch('/', (req, res) => {
  const { flowHigh, flowLow, totalThreshold } = req.body;

  const isValid = (v) => v === null || v === undefined || typeof v === 'number';
  if (!isValid(flowHigh) || !isValid(flowLow) || !isValid(totalThreshold)) {
    return res.status(400).json({
      message: 'flowHigh, flowLow, and totalThreshold must be numbers or null',
    });
  }

  const updated = store.updateSettingsForUser(req.user.id, {
    flowHigh,
    flowLow,
    totalThreshold,
  });
  res.json({ settings: updated });
});

module.exports = router;
