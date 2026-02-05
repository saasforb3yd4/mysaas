const express = require('express');
const dns = require('dns'); 

// ----------------------------------------------------------------
// 🔥 KESİN ÇÖZÜM (StackOverflow Yöntemi) 🔥
dns.setServers(["1.1.1.1", "8.8.8.8"]);
// ----------------------------------------------------------------

const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const app = express();

// --- AYARLAR ---
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "mylittledaisy"; // Panel giriş şifresi

// 🔒 API GÜVENLİK ANAHTARI
const APP_SECRET = "LUNA_BOT_SECRET_KEY_2024_SECURE"; 

// 🚨 MONGODB ADRESİ
const MONGO_URI = "mongodb+srv://lunaaticaret_mongodb:1IT2rbRJgErfUTFq@lunaticaret.axatcsg.mongodb.net/?appName=lunaticaret";

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- VERİTABANI ŞEMALARI ---

// 1. Kullanıcılar
const UserSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true },
    hwid: { type: String, default: "" }, 
    note: { type: String, default: "" }, 
    email: { type: String, default: "" }, 
    phone: { type: String, default: "" }, 
    createdAt: { type: Date, default: Date.now },
    expirationDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true }
});
const User = mongoose.model('User', UserSchema);

// 2. Kara Liste (Banned HWIDs) - YENİ
const BannedHWIDSchema = new mongoose.Schema({
    hwid: { type: String, required: true, unique: true },
    note: { type: String, default: "" }, // Kimin HWID'siydi?
    bannedAt: { type: Date, default: Date.now }
});
const BannedHWID = mongoose.model('BannedHWID', BannedHWIDSchema);

// --- BAĞLANTI FONKSİYONU ---
const connectDB = async () => {
    try {
        console.log("⏳ MongoDB'ye bağlanılıyor...");
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000, family: 4 });
        console.log('✅ MongoDB BAŞARIYLA BAĞLANDI!');
        app.listen(PORT, () => {
            console.log(`🚀 Sunucu Yayında!`);
            console.log(`📡 Local: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ KRİTİK HATA: Veritabanına Bağlanılamadı!');
        console.error(err.message);
    }
};
connectDB();

// ==========================================
// 1. API (MÜŞTERİ BOT GİRİŞİ)
// ==========================================
app.post('/api/login', async (req, res) => {
    // Güvenlik Header Kontrolü
    const clientSecret = req.headers['x-app-secret'];
    if (clientSecret !== APP_SECRET) {
        return res.status(403).json({ success: false, message: "Yetkisiz Erişim!" });
    }

    const { licenseKey, hwid } = req.body;

    try {
        if (mongoose.connection.readyState !== 1) {
            return res.json({ success: false, message: "Sunucu bakımda." });
        }

        // 🛑 HWID BAN KONTROLÜ (İLK BAKILACAK YER)
        // Eğer bu bilgisayar kara listedeyse, lisansı geçerli olsa bile reddet.
        const isBanned = await BannedHWID.findOne({ hwid: hwid });
        if (isBanned) {
            return res.json({ 
                success: false, 
                message: "BU CİHAZ SUNUCU TARAFINDAN YASAKLANMIŞTIR! (HWID BAN)", 
                action: "delete_license" // Dosyayı sildir
            });
        }

        const user = await User.findOne({ licenseKey: licenseKey });

        if (!user) return res.json({ success: false, message: "Geçersiz Lisans!", action: "delete_license" });
        if (!user.isActive) return res.json({ success: false, message: "Lisans pasif.", action: "delete_license" });
        if (new Date() > user.expirationDate) return res.json({ success: false, message: "Süre doldu.", action: "expired" });

        if (!user.hwid) {
            user.hwid = hwid;
            await user.save();
        } else if (user.hwid !== hwid) {
            return res.json({ success: false, message: "Başka bilgisayara kilitli!", action: "mismatch" });
        }
        
        const daysLeft = Math.ceil((user.expirationDate - new Date()) / (1000 * 60 * 60 * 24));
        res.json({ success: true, message: "Giriş Başarılı", daysLeft: daysLeft });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Sunucu hatası" });
    }
});

// ==========================================
// 2. ADMIN PANELİ
// ==========================================

app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', (req, res) => {
    res.send(`
        <body style="font-family: sans-serif; background:#2c3e50; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <form action="/admin/dashboard" method="POST" style="background:white; padding:40px; border-radius:10px; width:300px; text-align:center;">
                <h2 style="color:#34495e;">Yönetici Girişi</h2>
                <input type="password" name="password" placeholder="Şifre" style="padding:15px; width:100%; margin-bottom:20px; border:1px solid #ddd; border-radius:5px;" required>
                <button type="submit" style="width:100%; padding:15px; background:#e74c3c; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">GİRİŞ YAP</button>
            </form>
        </body>
    `);
});

app.post('/admin/dashboard', async (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.send(`❌ Yanlış Şifre! <a href="/admin">Geri</a>`);

    try {
        const users = await User.find().sort({ createdAt: -1 });
        const bannedList = await BannedHWID.find().sort({ bannedAt: -1 }); // Yasaklı listesi

        // LİSANS TABLOSU
        let userRows = users.map(u => {
            const daysLeft = Math.ceil((u.expirationDate - new Date()) / (1000 * 60 * 60 * 24));
            const statusColor = daysLeft > 0 && u.isActive ? '#27ae60' : '#c0392b';
            
            // HWID yoksa Ban butonu çalışmaz
            const banButton = u.hwid ? 
                `<button name="action" value="ban_hwid" onclick="return confirm('BU BİLGİSAYARI SONSUZA KADAR ENGELLEMEK İSTEDİĞİNE EMİN MİSİN?')" title="Cihazı Banla (HWID Ban)" style="background:#000; color:white; border:none; padding:6px 10px; cursor:pointer; border-radius:4px;">⛔ BAN</button>` : 
                `<button disabled style="background:#ccc; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:not-allowed;">⛔</button>`;

            return `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:15px;">
                    <div style="font-weight:bold;">${u.note}</div>
                    <div style="font-size:12px; color:#555;">${u.email || '-'}</div>
                    <div style="font-size:12px; color:#555;">${u.phone || '-'}</div>
                </td>
                <td style="padding:15px; font-family:monospace; color:#2980b9; font-weight:bold;">${u.licenseKey}</td>
                <td style="padding:15px; font-size:12px;">${u.hwid ? u.hwid : '<span style="background:#f1c40f; color:white; padding:3px 8px; border-radius:10px; font-size:10px;">YOK</span>'}</td>
                <td style="padding:15px;">${daysLeft} Gün</td>
                <td style="padding:15px; color:${statusColor}; font-weight:bold;">● ${u.isActive ? 'Aktif' : 'Pasif'}</td>
                <td style="padding:15px;">
                    <form action="/admin/action" method="POST" style="display:flex; gap:5px; align-items:center;">
                        <input type="hidden" name="password" value="${ADMIN_PASSWORD}">
                        <input type="hidden" name="id" value="${u._id}">
                        
                        <input type="number" name="custom_days" placeholder="Gün" style="width:50px; padding:5px; border:1px solid #ddd; border-radius:4px;">
                        <button name="action" value="set_custom_days" style="background:#8e44ad; color:white; border:none; padding:6px; cursor:pointer; border-radius:4px;">+</button>
                        
                        <button name="action" value="reset_hwid" title="Kilit Kaldır" style="background:#f39c12; color:white; border:none; padding:6px 10px; cursor:pointer; border-radius:4px;">♻️</button>
                        <button name="action" value="toggle_status" title="Aç/Kapat" style="background:#3498db; color:white; border:none; padding:6px 10px; cursor:pointer; border-radius:4px;">⏯️</button>
                        <button name="action" value="delete" onclick="return confirm('Sil?')" title="Sil" style="background:#c0392b; color:white; border:none; padding:6px 10px; cursor:pointer; border-radius:4px;">🗑️</button>
                        
                        <!-- YENİ HWID BAN BUTONU -->
                        ${banButton}
                    </form>
                </td>
            </tr>`;
        }).join('');

        // YASAKLI CİHAZLAR TABLOSU
        let bannedRows = bannedList.map(b => `
            <tr style="border-bottom:1px solid #eee; background:#fff5f5;">
                <td style="padding:10px;">${b.note}</td>
                <td style="padding:10px; font-family:monospace;">${b.hwid}</td>
                <td style="padding:10px;">${new Date(b.bannedAt).toLocaleDateString()}</td>
                <td style="padding:10px;">
                    <form action="/admin/action" method="POST">
                        <input type="hidden" name="password" value="${ADMIN_PASSWORD}">
                        <input type="hidden" name="hwid_to_unban" value="${b.hwid}">
                        <button name="action" value="unban_hwid" style="background:#27ae60; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px;">Ban Kaldır</button>
                    </form>
                </td>
            </tr>
        `).join('');

        res.send(`
            <html>
            <head>
                <title>Admin Paneli</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; background-color: #f3f4f6; padding: 20px; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 20px; }
                    h2 { margin-top: 0; color:#333; }
                    table { width: 100%; border-collapse: collapse; }
                    th { text-align: left; padding: 10px; border-bottom: 2px solid #eee; color:#666; }
                    input, button { font-family: inherit; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 style="text-align:center;">Bot Yönetim & Güvenlik Paneli</h1>

                    <!-- EKLEME -->
                    <div class="card">
                        <h2>✨ Yeni Lisans</h2>
                        <form action="/admin/create" method="POST" style="display:flex; gap:10px; flex-wrap:wrap;">
                            <input type="hidden" name="password" value="${ADMIN_PASSWORD}">
                            <input type="text" name="note" placeholder="Ad Soyad" required style="padding:8px; border:1px solid #ddd; border-radius:4px; flex:1;">
                            <input type="email" name="email" placeholder="Email" style="padding:8px; border:1px solid #ddd; border-radius:4px; flex:1;">
                            <input type="text" name="phone" placeholder="Telefon" style="padding:8px; border:1px solid #ddd; border-radius:4px; flex:1;">
                            <input type="text" name="key" placeholder="Key (Opsiyonel)" style="padding:8px; border:1px solid #ddd; border-radius:4px; flex:1;">
                            <input type="number" name="days" value="30" placeholder="Gün" style="width:60px; padding:8px; border:1px solid #ddd; border-radius:4px;">
                            <button type="submit" style="background:#10b981; color:white; border:none; padding:8px 20px; border-radius:4px; cursor:pointer;">Oluştur</button>
                        </form>
                    </div>

                    <!-- MÜŞTERİ LİSTESİ -->
                    <div class="card">
                        <h2>👥 Müşteri Listesi</h2>
                        <table>
                            <tr><th>Müşteri</th><th>Key</th><th>HWID</th><th>Süre</th><th>Durum</th><th>İşlemler</th></tr>
                            ${userRows}
                        </table>
                    </div>

                    <!-- YASAKLI CİHAZLAR (BLACKLIST) -->
                    <div class="card" style="border: 2px solid #c0392b;">
                        <h2 style="color:#c0392b;">⛔ Yasaklı Cihazlar (HWID Blacklist)</h2>
                        <table>
                            <tr><th>Eski Sahibi</th><th>HWID</th><th>Ban Tarihi</th><th>İşlem</th></tr>
                            ${bannedRows}
                        </table>
                        ${bannedList.length === 0 ? '<p style="text-align:center; color:#999;">Yasaklı cihaz yok.</p>' : ''}
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        res.send(`Hata: ${e.message}`);
    }
});

app.post('/admin/create', async (req, res) => {
    try {
        if (req.body.password !== ADMIN_PASSWORD) return res.send("Yetkisiz!");
        let key = req.body.key || Math.random().toString(36).substring(2, 12).toUpperCase();
        let expiry = new Date(); expiry.setDate(expiry.getDate() + parseInt(req.body.days));

        await new User({ 
            licenseKey: key, note: req.body.note, email: req.body.email, phone: req.body.phone, expirationDate: expiry 
        }).save();
        
        res.send(`<form id="back" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${ADMIN_PASSWORD}"></form><script>document.getElementById('back').submit();</script>`);
    } catch (e) { res.send(`Hata: ${e.message}`); }
});

app.post('/admin/action', async (req, res) => {
    try {
        if (req.body.password !== ADMIN_PASSWORD) return res.send("Yetkisiz!");
        const { id, action } = req.body;

        if (action === 'delete') await User.findByIdAndDelete(id);
        else if (action === 'reset_hwid') await User.findByIdAndUpdate(id, { hwid: "" });
        else if (action === 'toggle_status') {
            const u = await User.findById(id); if(u) { u.isActive = !u.isActive; await u.save(); }
        }
        else if (action === 'set_custom_days') {
            const u = await User.findById(id);
            const days = parseInt(req.body.custom_days);
            if(u && !isNaN(days)) {
                let baseDate = new Date() > new Date(u.expirationDate) ? new Date() : new Date(u.expirationDate);
                baseDate.setDate(baseDate.getDate() + days);
                u.expirationDate = baseDate; u.isActive = true; await u.save();
            }
        }
        // --- HWID BAN İŞLEMİ ---
        else if (action === 'ban_hwid') {
            const u = await User.findById(id);
            if (u && u.hwid) {
                // Kara listeye ekle
                await new BannedHWID({ hwid: u.hwid, note: u.note }).save();
                // Kullanıcının lisansını da pasife çek (İsteğe bağlı)
                u.isActive = false;
                await u.save();
            }
        }
        // --- HWID BAN KALDIRMA ---
        else if (action === 'unban_hwid') {
            await BannedHWID.findOneAndDelete({ hwid: req.body.hwid_to_unban });
        }

        res.send(`<form id="back" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${ADMIN_PASSWORD}"></form><script>document.getElementById('back').submit();</script>`);
    } catch (e) { res.send(`İşlem Hatası: ${e.message}`); }
});


app.listen(PORT, () => console.log(`🚀 Sunucu Hazır!`));
