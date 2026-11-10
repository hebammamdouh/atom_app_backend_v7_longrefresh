// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

const store = require('../data/store');
const { users } = require('../data/mockData');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const User = require('../models/User');

const MAX_DEVICES = store.MAX_DEVICES_PER_USER;

// access token: عمره قصير نسبيًا (يوم واحد) - لو سُرق بيخلص بسرعة
// refresh token: عمره طويل جدًا (سنة كاملة) وبيتخزن مرتبط بالجهاز (deviceId)
// في الـ session نفسها - تطبيق الفلاتر بيستخدمه يطلب access token جديد لما
// القديم يخلص من غير ما يحتاج يرجّع اليوزر لشاشة اللوجين تاني
// (POST /api/auth/refresh). وبما إنه بيتجدد (rotate) تلقائيًا في كل مرة
// بيستخدم فيها طول ما اليوزر بيفتح التطبيق على الأقل مرة في السنة، عمليًا
// هيفضل مسجل دخول طول الوقت من غير ما يحتاج يسجل دخول يدوي تاني أبدًا تقريبًا
const ACCESS_TOKEN_TTL = '1d';
const REFRESH_TOKEN_TTL_DAYS = 365;

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function refreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// رسالة موحدة لما اليوزر يوصل لحد الـ 3 أجهزة ويحاول يسجل دخول من جهاز رابع
function deviceLimitResponse(res) {
  return res.status(403).json({
    message: `تم الوصول للحد الأقصى (${MAX_DEVICES} أجهزة) لهذا الحساب. اطلبي من الأدمن إنهاء جلسة جهاز قديم، أو سجّلي خروج من جهاز تاني الأول.`,
    code: 'DEVICE_LIMIT_REACHED',
  });
}

// POST /api/auth/login
// body: { username, password, deviceId, deviceName?, platform? }
// الـ deviceId لازم يبقى معرف ثابت وفريد للجهاز (بيتولد مرة واحدة في التطبيق
// ويتخزن محليًا) عشان نقدر نفرّق بين 3 أجهزة مختلفة لنفس اليوزر ونمنع الرابع
router.post('/login', async (req, res) => {
  try {
      const { username, password, deviceId, deviceName, platform } = req.body;

      if (!username || !password) {
          return res.status(400).json({ message: 'Username and password are required.' });
      }
      if (!deviceId) {
          return res.status(400).json({ message: 'deviceId is required.' });
      }

      // 1. Check fallback/mock users first (This keeps your 'admin' user working)
      const mockUser = users.find(
          (u) => u.username === username && u.password === password
      );

      if (mockUser) {
          const refreshToken = generateRefreshToken();
          const refreshTokenExpiresAt = refreshTokenExpiry();

          const { error } = store.registerOrTouchSession(mockUser.id, {
              deviceId,
              deviceName,
              platform,
              refreshToken,
              refreshTokenExpiresAt,
          });
          if (error === 'LIMIT_REACHED') {
              return deviceLimitResponse(res);
          }

          const token = signAccessToken({
              id: mockUser.id,
              username: mockUser.username,
              name: mockUser.name,
              role: mockUser.role || 'user',
          });
          return res.json({
              token,
              refreshToken,
              user: {
                  id: mockUser.id,
                  username: mockUser.username,
                  name: mockUser.name,
                  role: mockUser.role || 'user',
                  isSubscribed: mockUser.isSubscribed !== false,
              },
          });
      }

      // 2. Check MongoDB for registered users
      const dbUser = await User.findOne({ username });
      if (!dbUser) {
          return res.status(401).json({ message: 'Invalid username or password.' });
      }

      // Compare the provided password with the hashed password in DB
      const isMatch = await bcrypt.compare(password, dbUser.password);
      if (!isMatch) {
          return res.status(401).json({ message: 'Invalid username or password.' });
      }

      // فحص حد الـ 3 أجهزة لليوزرز المسجلين بالـ MongoDB (sessions مخزنة جوه الدوكيومنت نفسه)
      const refreshToken = generateRefreshToken();
      const refreshTokenExpiresAt = refreshTokenExpiry();

      const existingSession = dbUser.sessions.find((s) => s.deviceId === deviceId);
      if (existingSession) {
          existingSession.lastActiveAt = new Date();
          if (deviceName) existingSession.deviceName = deviceName;
          if (platform) existingSession.platform = platform;
          existingSession.refreshToken = refreshToken;
          existingSession.refreshTokenExpiresAt = refreshTokenExpiresAt;
      } else {
          if (dbUser.sessions.length >= MAX_DEVICES) {
              return deviceLimitResponse(res);
          }
          dbUser.sessions.push({
              sessionId: crypto.randomBytes(8).toString('hex'),
              deviceId,
              deviceName: deviceName || 'Unknown device',
              platform: platform || null,
              createdAt: new Date(),
              lastActiveAt: new Date(),
              refreshToken,
              refreshTokenExpiresAt,
          });
      }
      await dbUser.save();

      // Generate token for DB user
      const token = signAccessToken({
          id: dbUser._id,
          username: dbUser.username,
          name: dbUser.username,
          role: dbUser.role || 'user',
      });

      return res.json({
          token,
          refreshToken,
          user: {
              id: dbUser._id,
              username: dbUser.username,
              name: dbUser.username,
              role: dbUser.role || 'user',
              isSubscribed: dbUser.isSubscribed !== false,
          },
      });

  } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Internal server error during login.' });
  }
});

// POST /api/auth/refresh
// body: { deviceId, refreshToken } -> بترجع access token جديد (+ refresh token
// جديد كمان، rotation) من غير ما اليوزر يحتاج يرجّع يسجل دخول تاني بيوزر/باسورد.
// دي بتتنادى تلقائي من تطبيق الفلاتر لما أي request يرجع 403 بـ code:
// 'TOKEN_INVALID' (يعني الـ access token القديم خلص - عادي وطبيعي بعد يوم واحد).
// مفيش authMiddleware هنا قصدًا، لأن أصل المشكلة إن الـ access token نفسه
// ممكن يكون منتهي، فمينفعش نطلب توكن صالح عشان نجدد توكن منتهي!
router.post('/refresh', async (req, res) => {
  try {
      const { deviceId, refreshToken } = req.body;
      if (!deviceId || !refreshToken) {
          return res
              .status(400)
              .json({ message: 'deviceId and refreshToken are required.' });
      }

      // 1. دوّري في اليوزرز المحليين (mock) الأول
      const localMatch = store.findSessionByRefreshToken(deviceId, refreshToken);
      if (localMatch) {
          const mockUser = users.find((u) => u.id === Number(localMatch.userId));
          if (mockUser) {
              const newRefreshToken = generateRefreshToken();
              const newRefreshTokenExpiresAt = refreshTokenExpiry();
              store.rotateSessionRefreshToken(mockUser.id, deviceId, {
                  refreshToken: newRefreshToken,
                  refreshTokenExpiresAt: newRefreshTokenExpiresAt,
              });

              const token = signAccessToken({
                  id: mockUser.id,
                  username: mockUser.username,
                  name: mockUser.name,
                  role: mockUser.role || 'user',
              });
              return res.json({ token, refreshToken: newRefreshToken });
          }
      }

      // 2. لو مش يوزر محلي، دوّري في يوزرز MongoDB (الـ refresh token مخزن جوه
      // sessions[].refreshToken بتاعة الدوكيومنت نفسها)
      const dbUser = await User.findOne({
          sessions: { $elemMatch: { deviceId, refreshToken } },
      });
      if (dbUser) {
          const session = dbUser.sessions.find(
              (s) => s.deviceId === deviceId && s.refreshToken === refreshToken
          );
          if (
              session &&
              (!session.refreshTokenExpiresAt || session.refreshTokenExpiresAt > new Date())
          ) {
              const newRefreshToken = generateRefreshToken();
              session.refreshToken = newRefreshToken;
              session.refreshTokenExpiresAt = refreshTokenExpiry();
              session.lastActiveAt = new Date();
              await dbUser.save();

              const token = signAccessToken({
                  id: dbUser._id,
                  username: dbUser.username,
                  name: dbUser.username,
                  role: dbUser.role || 'user',
              });
              return res.json({ token, refreshToken: newRefreshToken });
          }
      }

      // 3. مفيش تطابق، أو الـ refresh token نفسه خلص (بعد 30 يوم من غير ما
      // اليوزر يفتح التطبيق خالص) - هنا فعلاً لازم تسجيل دخول جديد بيوزر/باسورد
      return res.status(401).json({
          message: 'Session expired, please sign in again.',
          code: 'REFRESH_INVALID',
      });
  } catch (error) {
      console.error('Refresh token error:', error);
      res.status(500).json({ message: 'Internal server error during token refresh.' });
  }
});

// POST /api/auth/logout
// body: { deviceId } -> بتحرر مكان الجهاز ده من الـ 3 أماكن المتاحة (Logout عادي،
// مش لازم تنتظري أدمن). لو مبعتش deviceId التوكن هيفضل صالح لحد ما ينتهي عادي
router.post('/logout', authMiddleware, async (req, res) => {
  try {
      const { deviceId } = req.body;
      if (!deviceId) {
          return res.json({ message: 'Logged out.' });
      }

      const mockUser = users.find((u) => u.id === req.user.id);
      if (mockUser) {
          store.removeSessionByDevice(mockUser.id, deviceId);
          return res.json({ message: 'Logged out.' });
      }

      const dbUser = await User.findById(req.user.id);
      if (dbUser) {
          dbUser.sessions = dbUser.sessions.filter((s) => s.deviceId !== deviceId);
          await dbUser.save();
      }
      res.json({ message: 'Logged out.' });
  } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ message: 'Internal server error during logout.' });
  }
});

// GET /api/auth/me -> Current user data (for Settings page)
router.get('/me', authMiddleware, async (req, res) => {
  try {
      // 1. Check if the authenticated user is from mockData (admin)
      const mockUser = users.find((u) => u.id === req.user.id);
      if (mockUser) {
          return res.json({
              user: {
                  id: mockUser.id,
                  username: mockUser.username,
                  name: mockUser.name,
                  role: mockUser.role || 'user',
                  isSubscribed: mockUser.isSubscribed !== false,
                  deviceCount: store.getSessionsForUser(mockUser.id).length,
                  maxDevices: MAX_DEVICES,
              },
          });
      }

      // 2. Check if the authenticated user is from MongoDB
      const dbUser = await User.findById(req.user.id);

      if (!dbUser) {
          return res.status(404).json({ message: 'User not found.' });
      }

      res.json({
          user: {
              id: dbUser._id,
              username: dbUser.username,
              name: dbUser.username,
              role: dbUser.role || 'user',
              isSubscribed: dbUser.isSubscribed !== false,
              deviceCount: dbUser.sessions.length,
              maxDevices: MAX_DEVICES,
          },
      });
  } catch (error) {
      console.error('Fetch user error:', error);
      res.status(500).json({ message: 'Internal server error fetching user data.' });
  }
});

module.exports = router;
