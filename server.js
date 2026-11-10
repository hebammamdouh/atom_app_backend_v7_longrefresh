// server.js - نقطة الدخول الرئيسية للـ Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const equipmentRoutes = require('./routes/equipment');
const settingsRoutes = require('./routes/settings');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const { initMqtt } = require('./services/mqttService');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 4000;

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

app.use(cors());
app.use(express.json());

// 1. الاتصال بقاعدة البيانات MongoDB
mongoose.connect('mongodb://hebammamdouh18_db_user:18ا42002@ac-aizda6p-shard-00-00.b5dcoku.mongodb.net:27017,ac-aizda6p-shard-00-01.b5dcoku.mongodb.net:27017,ac-aizda6p-shard-00-02.b5dcoku.mongodb.net:27017/?ssl=true&replicaSet=atlas-j8nucs-shard-0&authSource=admin&appName=Cluster0')
  .then(() => console.log('✅ Connected to MongoDB successfully'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));


// جدول أكواد التسجيل (Registration PINs)
const pinSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false }, // هل تم استخدامه؟
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null } // مين اللي استخدمه
});
const RegistrationPin = mongoose.model('RegistrationPin', pinSchema);


// 📍 ===> استبدلي مسار الـ signup القديم بالكود ده <=== 📍
// 3. مسار تسجيل حساب جديد (Sign Up API)
// 👈 1. مسار توليد الكود (للاستخدام الإداري)
app.post('/api/auth/generate-pin', async (req, res) => {
    try {
        const newCode = 'ATOM-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const pin = new RegistrationPin({ code: newCode });
        await pin.save();
        res.status(201).json({ message: 'New PIN generated', code: newCode });
    } catch (err) {
        res.status(500).json({ message: 'Error generating PIN' });
    }
});

// 👈 2. مسار تسجيل حساب جديد (Sign Up) بالـ PIN (بديل القديم)
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, password, pinCode } = req.body;
        
        if (!pinCode) {
            return res.status(400).json({ message: 'Registration PIN is required.' });
        }

        const validPin = await RegistrationPin.findOne({ code: pinCode });
        if (!validPin) {
            return res.status(401).json({ message: 'Invalid Registration PIN.' });
        }
        if (validPin.isUsed) {
            return res.status(401).json({ message: 'This PIN has already been used.' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username is already taken.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        // role و isSubscribed و sessions بياخدوا القيم الافتراضية من models/User.js
        // ('user' / true / []) - يعني يوزر جديد بيبدأ مشترك وبـ 0 أجهزة مسجلة
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();

        validPin.isUsed = true;
        validPin.usedBy = newUser._id;
        await validPin.save();

        res.status(201).json({ message: 'User registered successfully.' });
    } catch (err) {
        console.error('Signup Error:', err);
        res.status(500).json({ message: 'Internal server error during registration.' });
    }
});


// Health check - علشان تتأكدي إن السيرفر شغال
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'ATOM Flow Systems API', time: new Date().toISOString() });
});

// مسارات التطبيق الأخرى
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', adminRoutes);

// تشغيل السيرفر والاتصال بالـ MQTT
app.listen(PORT, () => {
  console.log(`✅ ATOM Flow Systems API running on http://localhost:${PORT}`);
  initMqtt();
});
