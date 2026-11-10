// data/store.js
// طبقة بسيطة فوق الـ devices array بتاعت mockData.js
// لاحقاً لما نستخدم قاعدة بيانات حقيقية، هنستبدل الدوال دي بس من غير ما نغير شكل الـ API
//
// ملحوظة مهمة: الأرايه دي كانت في الذاكرة بس (بتتصفر كل ما السيرفر يتقفل/يترستارت)،
// فكان أي تعديل زي إعادة تسمية جهاز اتسجل تلقائي (auto-register) أو تغيير لوكيشن بيضيع.
// دلوقتي بنحفظ نسخة على ديسك (devices.persist.json) وبنرجّعها تاني وقت ما السيرفر يشتغل،
// عشان التعديلات دي تفضل موجودة حتى لو السيرفر اتقفل وترستارت.

const fs = require('fs');
const path = require('path');
const { devices, users: mockUsers } = require('./mockData');

// أقصى عدد سجلات (قرايات) نحتفظ بيها لكل جهاز في الذاكرة، عشان الميموري متكبرش لانهاية
const MAX_LOGS_PER_DEVICE = 2000;

// أقصى عدد نوتفيكيشن نحتفظ بيه لكل يوزر (الأقدم بيتشال أول ما نعدي الرقم ده)
const MAX_NOTIFICATIONS_PER_USER = 300;

// أقصى عدد أجهزة (Sessions) مسموح بيها لكل يوزر في نفس الوقت
const MAX_DEVICES_PER_USER = 3;

const PERSIST_FILE = path.join(__dirname, 'devices.persist.json');
const NOTIFICATIONS_FILE = path.join(__dirname, 'notifications.persist.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.persist.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.persist.json');
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.persist.json');

// ===== Sessions: الأجهزة المسجل دخولها لكل يوزر (Local/mock users بس - يوزرز
// الـ MongoDB بتتخزن الـ sessions بتاعتهم جوه الدوكيومنت نفسه، شوفي routes/auth.js) =====
// شكلها: { [userId]: [{ sessionId, deviceId, deviceName, platform, createdAt, lastActiveAt }] }
let userSessions = {};

function loadPersistedSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        userSessions = saved;
        console.log('[Store] ✅ Restored device sessions from sessions.persist.json');
      }
    }
  } catch (e) {
    console.error('[Store] Failed to load persisted sessions:', e.message);
  }
}

function persistSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(userSessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[Store] Failed to persist sessions:', e.message);
  }
}

function generateSessionId() {
  return `sess-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
}

// بتتنادى وقت تسجيل الدخول: لو الـ deviceId ده معروف بالفعل بترجع نفس الـ session
// (وتحدث آخر وقت نشاط + الـ refresh token بتاعه)، لو جهاز جديد وعدد الأجهزة وصل
// للحد الأقصى بترجع error: 'LIMIT_REACHED' عشان الـ route يرفض تسجيل الدخول
// برسالة واضحة. refreshToken/refreshTokenExpiresAt اختياريين عشان الدالة تفضل
// شغالة حتى لو حد نادالها من غير نظام الـ refresh (توافق مع كود قديم)
function registerOrTouchSession(
  userId,
  { deviceId, deviceName, platform, refreshToken, refreshTokenExpiresAt } = {}
) {
  const key = String(userId);
  if (!userSessions[key]) userSessions[key] = [];
  const list = userSessions[key];
  const now = new Date().toISOString();

  const existing = list.find((s) => s.deviceId === deviceId);
  if (existing) {
    existing.lastActiveAt = now;
    if (deviceName) existing.deviceName = deviceName;
    if (platform) existing.platform = platform;
    if (refreshToken) existing.refreshToken = refreshToken;
    if (refreshTokenExpiresAt) existing.refreshTokenExpiresAt = refreshTokenExpiresAt;
    persistSessions();
    return { session: existing };
  }

  if (list.length >= MAX_DEVICES_PER_USER) {
    return { error: 'LIMIT_REACHED' };
  }

  const session = {
    sessionId: generateSessionId(),
    deviceId,
    deviceName: deviceName || 'Unknown device',
    platform: platform || null,
    createdAt: now,
    lastActiveAt: now,
    refreshToken: refreshToken || null,
    refreshTokenExpiresAt: refreshTokenExpiresAt || null,
  };
  list.push(session);
  persistSessions();
  return { session };
}

function getSessionsForUser(userId) {
  return userSessions[String(userId)] || [];
}

// بتدور على الجلسة (وصاحبها) اللي ليها نفس الـ deviceId + refreshToken دول
// بالظبط ولسه صالحة (مش عدى معادها) - مستخدمة في POST /api/auth/refresh عشان
// نعرف نطلع access token جديد من غير ما اليوزر يحتاج يرجّع يسجل دخول تاني.
// بترجع null لو مفيش تطابق (يبقى الـ refresh token ده مش حقيقي أو خلصت صلاحيته)
function findSessionByRefreshToken(deviceId, refreshToken) {
  if (!deviceId || !refreshToken) return null;
  for (const [userId, list] of Object.entries(userSessions)) {
    const session = list.find(
      (s) => s.deviceId === deviceId && s.refreshToken === refreshToken
    );
    if (!session) continue;
    if (
      session.refreshTokenExpiresAt &&
      new Date(session.refreshTokenExpiresAt).getTime() < Date.now()
    ) {
      return null; // الـ refresh token ده خلصت صلاحيته برضو
    }
    return { userId, session };
  }
  return null;
}

// بتبدّل الـ refresh token القديم بواحد جديد (rotation) بعد كل استخدام ناجح -
// كده لو حد سرق refresh token قديم مش هيعرف يستخدمه تاني، وبتمدد صلاحية
// الجلسة طول ما اليوزر بيفتح التطبيق بانتظام
function rotateSessionRefreshToken(userId, deviceId, { refreshToken, refreshTokenExpiresAt }) {
  const key = String(userId);
  const list = userSessions[key] || [];
  const session = list.find((s) => s.deviceId === deviceId);
  if (!session) return null;
  session.refreshToken = refreshToken;
  session.refreshTokenExpiresAt = refreshTokenExpiresAt;
  session.lastActiveAt = new Date().toISOString();
  persistSessions();
  return session;
}

// بتشيل session بالـ id بتاعها (زرار "Terminate Session" في لوحة الأدمن) - ده
// اللي بيفك ارتباط الجهاز ده ويحرر مكانه عشان جهاز جديد يقدر يسجل دخول
function terminateSession(userId, sessionId) {
  const key = String(userId);
  const list = userSessions[key] || [];
  const idx = list.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  persistSessions();
  return true;
}

// بتشيل الـ session بتاعة جهاز معين (Logout الطبيعي من التطبيق - بيحرر مكانه من غير أدمن)
function removeSessionByDevice(userId, deviceId) {
  const key = String(userId);
  const list = userSessions[key] || [];
  const before = list.length;
  userSessions[key] = list.filter((s) => s.deviceId !== deviceId);
  if (userSessions[key].length !== before) {
    persistSessions();
    return true;
  }
  return false;
}

// ===== Subscription overrides لليوزرز المحليين (mock users) - المصدر الأصلي في
// mockData.js بس القيمة دي بتتغير في الرن تايم من لوحة الأدمن، فبنحفظها على ديسك
// منفصل عشان تفضل موجودة بعد أي ريستارت من غير ما نلمس mockData.js نفسه =====
function loadPersistedSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        mockUsers.forEach((u) => {
          if (typeof saved[String(u.id)] === 'boolean') {
            u.isSubscribed = saved[String(u.id)];
          }
        });
        console.log('[Store] ✅ Restored subscription status from subscriptions.persist.json');
      }
    }
  } catch (e) {
    console.error('[Store] Failed to load persisted subscriptions:', e.message);
  }
}

function persistSubscriptions() {
  try {
    const map = {};
    mockUsers.forEach((u) => {
      map[String(u.id)] = u.isSubscribed !== false;
    });
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('[Store] Failed to persist subscriptions:', e.message);
  }
}

// تفعيل/قفل الاشتراك (الكارت/الخدمة) بتاعة يوزر محلي معين - بيتحفظ فورًا
function setMockUserSubscription(userId, isSubscribed) {
  const user = mockUsers.find((u) => u.id === userId);
  if (!user) return null;
  user.isSubscribed = !!isSubscribed;
  persistSubscriptions();
  return user;
}

// ===== Notifications: نوتفيكيشنز أونلاين/أوفلاين + تنبيهات الفلو والتوتال =====
// شكل كل نوتفيكيشن:
// { id, userId, type: 'device_online'|'device_offline'|'flow_high'|'flow_low'|'total_threshold',
//   deviceId, deviceName, message, value, threshold, createdAt, read }
let notifications = [];

function loadPersistedNotifications() {
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      const raw = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        notifications = saved;
        console.log(`[Store] ✅ Restored ${saved.length} notification(s) from notifications.persist.json`);
      }
    }
  } catch (e) {
    console.error('[Store] Failed to load persisted notifications:', e.message);
  }
}

function persistNotifications() {
  try {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2), 'utf8');
  } catch (e) {
    console.error('[Store] Failed to persist notifications:', e.message);
  }
}

// ===== Settings: عتبات التنبيه (Flow High / Flow Low / Total) لكل يوزر =====
// شكلها: { [userId]: { flowHigh: number|null, flowLow: number|null, totalThreshold: number|null } }
let userSettings = {};

const DEFAULT_SETTINGS = { flowHigh: null, flowLow: null, totalThreshold: null };

function loadPersistedSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        userSettings = saved;
        console.log('[Store] ✅ Restored alert settings from settings.persist.json');
      }
    }
  } catch (e) {
    console.error('[Store] Failed to load persisted settings:', e.message);
  }
}

function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userSettings, null, 2), 'utf8');
  } catch (e) {
    console.error('[Store] Failed to persist settings:', e.message);
  }
}

// بترجع عتبات التنبيه بتاعة يوزر معين (لو محددهاش لسه، بترجع القيم الافتراضية = null
// يعني "التنبيه ده مقفول" لحد ما اليوزر يحدد رقم من الـ Settings)
function getSettingsForUser(userId) {
  const key = String(userId);
  return { ...DEFAULT_SETTINGS, ...(userSettings[key] || {}) };
}

function updateSettingsForUser(userId, { flowHigh, flowLow, totalThreshold } = {}) {
  const key = String(userId);
  const current = getSettingsForUser(userId);
  const updated = {
    flowHigh: flowHigh !== undefined ? flowHigh : current.flowHigh,
    flowLow: flowLow !== undefined ? flowLow : current.flowLow,
    totalThreshold:
      totalThreshold !== undefined ? totalThreshold : current.totalThreshold,
  };
  userSettings[key] = updated;
  persistSettings();
  return updated;
}

function generateNotificationId() {
  return `notif-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
}

// بتضيف نوتفيكيشن جديدة ليوزر معين وتحفظها على طول - لو مفيش userId (جهاز لسه
// مش مستلم) منعملش حاجة، عشان مفيش حد يستلم النوتفيكيشن دي أصلاً
function addNotification(userId, { type, deviceId, deviceName, message, value, threshold }) {
  if (userId == null) return null;
  const notif = {
    id: generateNotificationId(),
    userId: String(userId),
    type,
    deviceId: deviceId || null,
    deviceName: deviceName || null,
    message,
    value: value !== undefined ? value : null,
    threshold: threshold !== undefined ? threshold : null,
    createdAt: new Date().toISOString(),
    read: false,
  };
  notifications.push(notif);

  // نحتفظ فقط بآخر MAX_NOTIFICATIONS_PER_USER نوتفيكيشن لكل يوزر عشان الليستة متكبرش لانهاية
  const forUser = notifications.filter((n) => n.userId === notif.userId);
  if (forUser.length > MAX_NOTIFICATIONS_PER_USER) {
    const toRemove = forUser
      .slice(0, forUser.length - MAX_NOTIFICATIONS_PER_USER)
      .map((n) => n.id);
    notifications = notifications.filter((n) => !toRemove.includes(n.id));
  }

  persistNotifications();
  return notif;
}

// أحدث النوتفيكيشنز الأول - لصفحة الجرس في التطبيق
function getNotificationsForUser(userId, { limit } = {}) {
  const key = String(userId);
  const sorted = notifications
    .filter((n) => n.userId === key)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return limit ? sorted.slice(0, limit) : sorted;
}

function getUnreadCountForUser(userId) {
  const key = String(userId);
  return notifications.filter((n) => n.userId === key && !n.read).length;
}

function markNotificationRead(id, userId) {
  const key = String(userId);
  const notif = notifications.find((n) => n.id === id && n.userId === key);
  if (!notif) return null;
  notif.read = true;
  persistNotifications();
  return notif;
}

function markAllNotificationsRead(userId) {
  const key = String(userId);
  notifications.forEach((n) => {
    if (n.userId === key) n.read = true;
  });
  persistNotifications();
}

// ملحوظة عن الفصل بين اليوزرز: كل جهاز عنده ownerId. لو جهاز اتسجل تلقائي من
// MQTT (ownerId = null) بيبان لكل اليوزرز لحد ما حد يتفاعل معاه (تسمية/فيفورت/
// تحكم) فبيبقى ملكه هو بس تلقائي (auto-claim) - شوفي findByIdForUser و_autoClaim.

// بترجع نسخة الأجهزة المحفوظة على الديسك لو موجودة، وتستبدل بيها الأرايه الأصلية
// في مكانها (نفس الـ reference) عشان كل الملفات التانية اللي عاملة import للأرايه دي
// (زي mqttService.js) تفضل شغالة على نفس البيانات المحدّثة
function loadPersistedDevices() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const raw = fs.readFileSync(PERSIST_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0) {
        devices.length = 0;
        devices.push(...saved);
        console.log(`[Store] ✅ Restored ${saved.length} device(s) from devices.persist.json`);
      }
    }
  } catch (e) {
    console.error('[Store] Failed to load persisted devices, using defaults:', e.message);
  }
}

// بتتنادى بعد أي تعديل "هيكلي" مهم (اسم/لوكيشن/إضافة جهاز/فيفورت/تحكم) عشان يتحفظ
// على طول - مش بتتنادى على كل قراية MQTT عشان منكتبش على الديسك كل ثانية من غير داعي
function persist() {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(devices, null, 2), 'utf8');
  } catch (e) {
    console.error('[Store] Failed to persist devices:', e.message);
  }
}

loadPersistedDevices();
loadPersistedNotifications();
loadPersistedSettings();
loadPersistedSessions();
loadPersistedSubscriptions();

function getAllDevices() {
  return devices;
}

// كل يوزر بيشوف بس أجهزته (ownerId بتاعه) + الأجهزة اللي اتسجلت تلقائي من MQTT
// ولسه محدش "استلمها" (ownerId = null) - دي بتبان لكل اليوزرز لحد ما حد ياخدها
function getDevicesForUser(userId) {
  return devices.filter((d) => d.ownerId === userId || d.ownerId == null);
}

// نسخة "صارمة" بترجع بس الأجهزة المملوكة فعلاً ليوزر معين (من غير الأجهزة اللي
// لسه مش مستلمة) - مستخدمة من لوحة الأدمن عشان تعرض عدادات يوزر معين بالظبط.
// بتقارن كـ string عشان تشتغل سواء الـ userId رقم (يوزر محلي) أو ObjectId string
function getDevicesForOwner(userId) {
  const key = String(userId);
  return devices.filter((d) => d.ownerId != null && String(d.ownerId) === key);
}

function findById(id) {
  return devices.find((d) => d.id === id);
}

// نفس findById بس بتتأكد إن الجهاز ده يخص اليوزر ده (أو لسه مش مستلم من حد) -
// لو الجهاز ده ملك يوزر تاني بترجع null (زي إنه مش موجود) عشان محدش يقدر يوصل
// لأجهزة يوزر تاني حتى لو عرف الـ id بتاعها
function findByIdForUser(id, userId) {
  const device = findById(id);
  if (!device) return null;
  if (device.ownerId !== userId && device.ownerId != null) return null;
  return device;
}

function findByMqttUnid(unid) {
  return devices.find((d) => d.mqttUnid === unid);
}

// توليد ID جديد تلقائي غير مكرر أبداً (يُستخدم وقت "إضافة كارت جديد" لـ meter/valve/pump)
function generateDeviceId(prefix = 'device') {
  let id;
  do {
    id = `${prefix}-${Date.now().toString(36)}-${Math.floor(
      Math.random() * 100000
    ).toString(36)}`;
  } while (devices.some((d) => d.id === id)); // نتأكد إنه مش متكرر أبداً مع أي جهاز موجود
  return id;
}

// ownerId: لو جهاز بيضيفه يوزر يدوي بيبقى ملكه على طول. لو null (زي أجهزة الـ
// MQTT auto-register) بيفضل "مش مستلم" وبيبان لكل اليوزرز لحد ما حد يتفاعل معاه
function addDevice({ name, type, mqttUnid, location, ownerId = null }) {
  // بادئة الـ ID حسب نوع الجهاز - meter / relay / valve
  const prefixMap = { sensor: 'meter', relay: 'relay', valve: 'valve' };
  const prefix = prefixMap[type] || 'device';

  const newDevice = {
    id: generateDeviceId(prefix),
    name: name || 'New Device',
    type: type || 'sensor',
    mqttUnid: mqttUnid || null,
    ownerId,
    online: false,
    lastSeen: null,
    onlineSince: null, // من إمتى الجهاز أونلاين (لو أونلاين دلوقتي)
    offlineSince: null, // من إمتى الجهاز أوفلاين (لو أوفلاين دلوقتي)
    location: location || { label: '', lat: null, lng: null },
    readings:
      type === 'relay' || type === 'valve'
        ? undefined
        : {
            flow: { value: 0.0, unit: 'm3/h' },
            velocity: { value: 0.0, unit: 'm/s' },
            totalizer: { value: 0.0, unit: 'm3' },
          },
    control:
      type === 'relay' || type === 'valve'
        ? { label: type === 'valve' ? 'Valve Control' : 'Relay Control', state: 'off' }
        : undefined,
    favorite: false,
    logs: [],
  };
  devices.push(newDevice);
  persist();
  return newDevice;
}

// بتشيل جهاز (كارت/عداد) خالص من النظام - مستخدمة من لوحة الأدمن ("Remove Meter")
// عشان تفصل يوزر عن عداد بالكامل، مش زي claim/unclaim اللي بس بتغير الملكية
function deleteDevice(id) {
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  devices.splice(idx, 1);
  persist();
  return true;
}

// عدد الأجهزة (العدادات/الكروت) المملوكة ليوزر معين - مستخدمة في لوحة الأدمن
// عشان تعرض "عدد العدادات" جنب كل يوزر. بتقارن كـ string عشان تشتغل سواء الـ
// userId رقم (يوزر محلي) أو ObjectId string (يوزر MongoDB)
function countDevicesForOwner(userId) {
  const key = String(userId);
  return devices.filter((d) => d.ownerId != null && String(d.ownerId) === key).length;
}

// لو الجهاز لسه "مش مستلم" (ownerId = null) وأي يوزر تفاعل معاه (فيفورت/تسمية/تحكم)
// بياخده ملكه تلقائي - من غير ما تحتاجي زرار "Claim" منفصل
function _autoClaim(device, userId) {
  if (device.ownerId == null && userId != null) {
    device.ownerId = userId;
  }
}

// استلام جهاز "مش مستلم" يدوي (لو عايزة زرار Claim صريح في الأبليكشن بعدين)
function claimDevice(id, userId) {
  const device = findByIdForUser(id, userId);
  if (!device) return null;
  _autoClaim(device, userId);
  persist();
  return device;
}

// تفعيل/إلغاء "المفضلة" لجهاز - ده اللي بيخلي العداد يظهر في صفحة Favorite
function setFavorite(id, favorite, userId) {
  const device = findByIdForUser(id, userId);
  if (!device) return null;
  _autoClaim(device, userId);
  device.favorite = !!favorite;
  persist();
  return device;
}

// تعديل بيانات هيكلية لجهاز (الاسم/اللوكيشن/الـ mqttUnid) - بيتحفظ فورًا عشان
// أي جهاز اتسجل تلقائي (auto-register) وغيّرتي اسمه يفضل محتفظ بيه بعد أي ريستارت
function updateDevice(id, { name, location, mqttUnid } = {}, userId) {
  const device = findByIdForUser(id, userId);
  if (!device) return null;
  _autoClaim(device, userId);
  if (name !== undefined) device.name = name;
  if (location !== undefined) device.location = location;
  if (mqttUnid !== undefined) device.mqttUnid = mqttUnid;
  persist();
  return device;
}

// تغيير حالة التحكم (on/off) لريلاي أو فالف
function setControlState(id, state, userId) {
  const device = findByIdForUser(id, userId);
  if (!device || !device.control) return null;
  _autoClaim(device, userId);
  device.control.state = state;
  persist();
  return device;
}

// رجّعي سجل القرايات بتاع جهاز معين (الأحدث الأول) - لصفحة Reports
function getLogsById(id, { limit } = {}, userId) {
  const device = findByIdForUser(id, userId);
  if (!device) return null;
  const logs = device.logs || [];
  const sorted = [...logs].reverse(); // الأحدث الأول
  if (limit) return sorted.slice(0, limit);
  return sorted;
}

// بتتنادى كل ما جهاز يتحط أونلاين أو أوفلاين - بتسجل بالظبط الوقت اللي اتغيرت فيه الحالة
// (مش كل مرة توصل فيها رسالة MQTT) عشان "أونلاين من قد" يبقى دقيق
// وكمان دي أول مكان بيتولد فيه نوتفيكيشن "العداد بقى أونلاين/أوفلاين" لصاحب الجهاز
function _applyOnlineState(device, isOnline) {
  const wasOnline = device.online;
  device.online = isOnline;
  const now = new Date().toISOString();

  if (isOnline && !wasOnline) {
    device.onlineSince = now;
    device.offlineSince = null;
    addNotification(device.ownerId, {
      type: 'device_online',
      deviceId: device.id,
      deviceName: device.name,
      message: `${device.name} is back online`,
    });
  } else if (!isOnline && wasOnline) {
    device.offlineSince = now;
    device.onlineSince = null;
    addNotification(device.ownerId, {
      type: 'device_offline',
      deviceId: device.id,
      deviceName: device.name,
      message: `${device.name} went offline`,
    });
  }
  // لو الحالة متغيرتش، سيبي onlineSince/offlineSince زي ما هي (ده اللي بيدّي الدقة)
}

// بتتنادى بعد كل قراية جديدة توصل من MQTT - بتقارن الفلو والتوتال بعتبات التنبيه
// اللي اليوزر حددها من الـ Settings (Flow High / Flow Low / Total). كل عتبة عندها
// "فلاج" على الجهاز نفسه (runtime بس، مش لازم يتحفظ) عشان منبعتش نفس التنبيه كل
// ثانية طول ما القيمة فاضلة عدّية العتبة - بيتبعت تاني بس لو القيمة رجعت تحت
// العتبة وبعدين عدّتها تاني (transition جديدة فعلاً)
function _checkThresholds(device, { flow, total }) {
  if (device.ownerId == null) return; // جهاز لسه مش مستلم، مفيش حد يستلم التنبيه أصلاً

  const settings = getSettingsForUser(device.ownerId);

  // --- Flow High ---
  if (typeof settings.flowHigh === 'number') {
    if (flow >= settings.flowHigh) {
      if (!device._flowHighActive) {
        device._flowHighActive = true;
        addNotification(device.ownerId, {
          type: 'flow_high',
          deviceId: device.id,
          deviceName: device.name,
          message: `${device.name} flow is high: ${flow} (threshold ${settings.flowHigh})`,
          value: flow,
          threshold: settings.flowHigh,
        });
      }
    } else {
      device._flowHighActive = false;
    }
  }

  // --- Flow Low ---
  if (typeof settings.flowLow === 'number') {
    if (flow <= settings.flowLow) {
      if (!device._flowLowActive) {
        device._flowLowActive = true;
        addNotification(device.ownerId, {
          type: 'flow_low',
          deviceId: device.id,
          deviceName: device.name,
          message: `${device.name} flow is low: ${flow} (threshold ${settings.flowLow})`,
          value: flow,
          threshold: settings.flowLow,
        });
      }
    } else {
      device._flowLowActive = false;
    }
  }

  // --- Total Threshold ---
  if (typeof settings.totalThreshold === 'number') {
    if (total >= settings.totalThreshold) {
      if (!device._totalAlertActive) {
        device._totalAlertActive = true;
        addNotification(device.ownerId, {
          type: 'total_threshold',
          deviceId: device.id,
          deviceName: device.name,
          message: `${device.name} total passed ${settings.totalThreshold}: ${total}`,
          value: total,
          threshold: settings.totalThreshold,
        });
      }
    } else {
      // لو التوتال رجع تحت العتبة (مثلاً العداد اتصفر) نسمح بتنبيه جديد لو عدّاها تاني
      device._totalAlertActive = false;
    }
  }
}

// بتتنادى من مسار الـ MQTT service كل ما توصل رسالة قراءات جديدة
// ملحوظة: القرايات دي بتتحدث كتير جدًا (لايف)، فمش بنعمل لها persist على الديسك
// كل مرة - القيم دي هتيجي تاني لايف أول ما الجهاز يبعت بيانات بعد أي ريستارت
function updateReadingsByUnid(unid, { flow, velocity, total }) {
  const device = findByMqttUnid(unid);
  if (!device) return null;

  _applyOnlineState(device, true);
  const now = new Date().toISOString();
  device.lastSeen = now;
  device.readings = {
    flow: { value: flow ?? 0, unit: 'm3/h' },
    velocity: { value: velocity ?? 0, unit: 'm/s' },
    totalizer: { value: total ?? 0, unit: 'm3' },
  };

  // كل قراية جديدة توصل بتتسجل في اللوج بتاع الجهاز (ده أساس شاشة Reports وتحميل الـ CSV)
  if (!device.logs) device.logs = [];
  device.logs.push({
    timestamp: now,
    flow: flow ?? 0,
    velocity: velocity ?? 0,
    totalizer: total ?? 0,
  });
  if (device.logs.length > MAX_LOGS_PER_DEVICE) {
    device.logs.splice(0, device.logs.length - MAX_LOGS_PER_DEVICE);
  }

  _checkThresholds(device, { flow: flow ?? 0, total: total ?? 0 });

  return device;
}

// بتتنادى وقت وصول رسالة status/meters (connected/disconnected)
function updateStatusByUnid(unid, status) {
  const device = findByMqttUnid(unid);
  if (!device) return null;

  _applyOnlineState(device, status === 'connected');
  device.lastSeen = new Date().toISOString();
  return device;
}

// بتتنادى كل شوية لتعليم أي جهاز عدى عليه وقت طويل من غير رسائل كـ Offline
function markStaleDevicesOffline(timeoutMs = 30000) {
  const now = Date.now();
  devices.forEach((device) => {
    if (!device.mqttUnid) return; // مش جهاز MQTT، سيبيه زي ما هو
    if (!device.lastSeen) return;
    const last = new Date(device.lastSeen).getTime();
    if (now - last > timeoutMs && device.online) {
      _applyOnlineState(device, false);
    }
  });
}

module.exports = {
  getAllDevices,
  getDevicesForUser,
  getDevicesForOwner,
  findById,
  findByIdForUser,
  findByMqttUnid,
  addDevice,
  deleteDevice,
  countDevicesForOwner,
  claimDevice,
  updateDevice,
  setControlState,
  updateReadingsByUnid,
  updateStatusByUnid,
  markStaleDevicesOffline,
  setFavorite,
  getLogsById,
  // Settings (Flow High / Flow Low / Total alert thresholds)
  getSettingsForUser,
  updateSettingsForUser,
  // Notifications
  addNotification,
  getNotificationsForUser,
  getUnreadCountForUser,
  markNotificationRead,
  markAllNotificationsRead,
  // Device sessions (max 3 devices per user) - local/mock users
  MAX_DEVICES_PER_USER,
  registerOrTouchSession,
  getSessionsForUser,
  terminateSession,
  removeSessionByDevice,
  findSessionByRefreshToken,
  rotateSessionRefreshToken,
  // Subscription status (card lock) - local/mock users
  setMockUserSubscription,
};

