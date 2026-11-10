// middleware/subscription.js
// بتتحط بعد authMiddleware في أي راوت عايزة تقفليه لو اليوزر مش مشترك (isSubscribed:
// false) - ده اللي بيطبّق "قفل الكارت/الخدمة" من لوحة الأدمن. اليوزر لسه يقدر
// يسجل دخول عادي ويشوف Settings، بس بيتمنع من /api/equipment (شوفي بيانات
// عداداته أو يتحكم فيها) لحد ما الأدمن يفعّل الاشتراك تاني.
const { users: mockUsers } = require('../data/mockData');
const User = require('../models/User');

async function subscriptionMiddleware(req, res, next) {
  try {
    // الأدمن مايتقفلش أبدًا حتى لو حد غيّر الفلاج بتاعه بالغلط
    if (req.user && req.user.role === 'admin') return next();

    const mockUser = mockUsers.find((u) => u.id === req.user.id);
    if (mockUser) {
      if (mockUser.isSubscribed === false) {
        return res.status(402).json({
          message:
            'اشتراكك متوقف حاليًا. تواصلي مع الأدمن لإعادة تفعيل الخدمة.',
          code: 'SUBSCRIPTION_INACTIVE',
        });
      }
      return next();
    }

    // يوزر MongoDB
    const dbUser = await User.findById(req.user.id).select('isSubscribed');
    if (dbUser && dbUser.isSubscribed === false) {
      return res.status(402).json({
        message:
          'اشتراكك متوقف حاليًا. تواصلي مع الأدمن لإعادة تفعيل الخدمة.',
        code: 'SUBSCRIPTION_INACTIVE',
      });
    }
    next();
  } catch (e) {
    // لو حصل أي عطل غير متوقع (مثلاً الاتصال بالداتابيز واقع) منقفلش الخدمة على
    // اليوزر بسبب عطل تقني مش ليه دخل بيه - fail-open بدل ما نكسر التطبيق كله
    console.error('[Subscription] middleware error:', e.message);
    next();
  }
}

module.exports = { subscriptionMiddleware };
