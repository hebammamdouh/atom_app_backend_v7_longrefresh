// models/User.js
// شكل بيانات اليوزر المسجل عن طريق Sign Up (MongoDB) - نفس اليوزرز اللي بيتسجلوا
// بالـ Registration PIN من server.js. اتنقل هنا (بدل ما يكون معرّف جوه server.js)
// عشان يبقى ممكن نستخدمه من أي راوت تاني (routes/auth.js و routes/admin.js) من
// غير ما نكرر تعريف الـ Schema في أكتر من مكان.

const mongoose = require('mongoose');

// جلسة/جهاز واحد مسجل دخول بحساب اليوزر ده - بنحتفظ بيها جوه الدوكيومنت نفسه
// عشان أي عملية عليها (إضافة/حذف) تبقى atomic مع باقي بيانات اليوزر
const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    deviceId: { type: String, required: true },
    deviceName: { type: String, default: 'Unknown device' },
    platform: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now },
    // refresh token خاص بالجلسة دي - بيستخدمه تطبيق الفلاتر يطلب access token
    // جديد من غير ما يحتاج يرجّع اليوزر لشاشة اللوجين (شوفي routes/auth.js /refresh)
    refreshToken: { type: String, default: null },
    refreshTokenExpiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // role: 'admin' بيفتح صلاحيات لوحة التحكم (routes/admin.js) - الافتراضي 'user'
  // ملحوظة: مفيش حاليًا طريقة من الأبليكشن لترقية يوزر MongoDB لـ admin، ده بيتعمل
  // يدوي من قاعدة البيانات وقت الحاجة (عشان محدش يعمل نفسه أدمن من الـ signup)
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  // isSubscribed: لو false يبقى الكارت/الخدمة مقفولة (subscriptionMiddleware بيمنع
  // الوصول لـ /api/equipment كله) - الأدمن بيتحكم فيها من لوحة التحكم
  isSubscribed: { type: Boolean, default: true },
  // أقصى 3 أجهزة نشطة في نفس الوقت لكل يوزر - راجعي routes/auth.js (فحص الحد وقت اللوجين)
  sessions: { type: [sessionSchema], default: [] },
});

// mongoose.models.User بترجع الموديل لو اتعرف قبل كده (زي أي جزء لسه بيعرفه جوه
// server.js) عشان منعملش "OverwriteModelError" لو الملف ده اتطلب أكتر من مرة
module.exports = mongoose.models.User || mongoose.model('User', userSchema);
