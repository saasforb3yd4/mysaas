/**
 * ======================================================================================
 * NEXORA SAAS - LISANS YÖNETİM SİSTEMİ (PREMIUM SERVER)
 * ======================================================================================
 * * Özellikler:
 * - Gelişmiş Dark Mode UI (Koyu Tema)
 * - Müşteri Yönetimi (Ad, Mail, Tel, Paket)
 * - HWID (Donanım Kilidi) Sistemi
 * - HWID Ban (Kara Liste) Sistemi
 * - API Güvenliği (Secret Key)
 * - DNS Çözümleme Fixi
 * * Author: Gemini
 * Date: 2024
 */

const express = require('express');
const dns = require('dns'); 

// ----------------------------------------------------------------
// 🛠️ AĞ VE BAĞLANTI AYARLARI (CRITICAL FIXES)
// ----------------------------------------------------------------
// Node.js'in sistem DNS'i yerine Google/Cloudflare kullanmasını zorla.
// Bu, "querySrv ETIMEOUT" hatalarını %100 çözer.
try {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    console.log("✅ DNS Sunucuları Ayarlandı (Google & Cloudflare)");
} catch (e) {
    console.log("⚠️ DNS Ayarı Uyarısı:", e.message);
}

const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const app = express();

// ----------------------------------------------------------------
// ⚙️ KONFİGÜRASYON
// ----------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "mylittledaisy"; // Panel Giriş Şifresi
const APP_SECRET = "LUNA_BOT_SECRET_KEY_2024_SECURE"; // Python Bot ile eşleşmeli

// MongoDB Atlas Bağlantı Adresi
const MONGO_URI = "mongodb+srv://lunaaticaret_mongodb:1IT2rbRJgErfUTFq@lunaticaret.axatcsg.mongodb.net/?appName=lunaticaret";

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Loglama Middleware (Her isteği konsola yazar)
app.use((req, res, next) => {
    console.log(`[LOG] ${new Date().toLocaleTimeString()} - ${req.method} ${req.url} - IP: ${req.ip}`);
    next();
});

// ----------------------------------------------------------------
// 🗄️ VERİTABANI MODELLERİ (SCHEMAS)
// ----------------------------------------------------------------

// 1. Kullanıcı (Lisans) Şeması
const UserSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true }, // Lisans Anahtarı
    hwid: { type: String, default: "" }, // Donanım Kimliği
    
    // Müşteri Bilgileri
    note: { type: String, default: "" }, // Ad Soyad
    email: { type: String, default: "" }, // E-posta
    phone: { type: String, default: "" }, // Telefon
    
    // Paket Bilgisi (Single, Plus, Premium)
    plan: { type: String, default: "Nexora Single" }, 
    
    // Tarih ve Durum
    createdAt: { type: Date, default: Date.now },
    expirationDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true }
});

const User = mongoose.model('User', UserSchema);

// 2. Yasaklı Cihazlar (HWID Blacklist) Şeması
const BannedHWIDSchema = new mongoose.Schema({
    hwid: { type: String, required: true, unique: true },
    note: { type: String, default: "" }, // Kimin cihazıydı?
    bannedAt: { type: Date, default: Date.now }
});

const BannedHWID = mongoose.model('BannedHWID', BannedHWIDSchema);

// ----------------------------------------------------------------
// 🔌 VERİTABANI BAĞLANTISI
// ----------------------------------------------------------------
const connectDB = async () => {
    try {
        console.log("⏳ MongoDB'ye bağlanılıyor...");
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            family: 4 // IPv4 zorla
        });
        console.log('✅ MongoDB BAŞARIYLA BAĞLANDI!');
        
        // Sunucuyu başlat
        app.listen(PORT, () => {
            console.log(`\n===================================================`);
            console.log(`🚀 NEXORA SERVER YAYINDA!`);
            console.log(`📡 URL: http://localhost:${PORT}`);
            console.log(`🔑 Panel Şifresi: ${ADMIN_PASSWORD}`);
            console.log(`===================================================\n`);
        });

    } catch (err) {
        console.error('❌ KRİTİK HATA: Veritabanına Bağlanılamadı!');
        console.error('Hata Detayı:', err.message);
    }
};

connectDB();

// ======================================================================================
// 🚀 API ENDPOINT (PYTHON BOTU İÇİN)
// ======================================================================================
app.post('/api/login', async (req, res) => {
    // 1. Güvenlik Header Kontrolü
    const clientSecret = req.headers['x-app-secret'];
    if (clientSecret !== APP_SECRET) {
        return res.status(403).json({ success: false, message: "Yetkisiz Erişim! (Secret Key Error)" });
    }

    const { licenseKey, hwid } = req.body;

    try {
        // DB Bağlantı Kontrolü
        if (mongoose.connection.readyState !== 1) {
            return res.json({ success: false, message: "Sunucu şu an bakımda." });
        }

        // 2. HWID Ban Kontrolü (Önce buna bakılır)
        const isBanned = await BannedHWID.findOne({ hwid: hwid });
        if (isBanned) {
            return res.json({ 
                success: false, 
                message: "CİHAZINIZ SUNUCU TARAFINDAN YASAKLANMIŞTIR (HWID BAN).", 
                action: "delete_license" 
            });
        }

        // 3. Lisans Kontrolü
        const user = await User.findOne({ licenseKey: licenseKey });

        if (!user) {
            return res.json({ success: false, message: "Geçersiz Lisans Anahtarı!", action: "delete_license" });
        }
        
        if (!user.isActive) {
            return res.json({ success: false, message: "Lisansınız pasif durumda.", action: "delete_license" });
        }
        
        if (new Date() > user.expirationDate) {
            return res.json({ success: false, message: "Lisans süreniz dolmuş.", action: "expired" });
        }

        // 4. HWID Eşleştirme ve Kilitleme
        if (!user.hwid) {
            // İlk giriş: Kilitle
            user.hwid = hwid;
            await user.save();
        } else if (user.hwid !== hwid) {
            // Başka bilgisayar
            return res.json({ success: false, message: "Bu lisans başka bir cihaza tanımlı!", action: "mismatch" });
        }
        
        // Kalan gün hesapla
        const daysLeft = Math.ceil((user.expirationDate - new Date()) / (1000 * 60 * 60 * 24));
        
        // 5. Başarılı Yanıt (Paket bilgisiyle birlikte)
        res.json({ 
            success: true, 
            message: "Giriş Başarılı", 
            daysLeft: daysLeft,
            plan: user.plan // Python botuna paket bilgisini gönder
        });

    } catch (err) {
        console.error("API Error:", err);
        res.status(500).json({ success: false, message: "Sunucu içi hata." });
    }
});

// ======================================================================================
// 🖥️ ADMIN PANELİ ROUTE'LARI
// ======================================================================================

// Kök dizin -> Admin paneline yönlendir
app.get('/', (req, res) => res.redirect('/admin'));

// Giriş Sayfası
app.get('/admin', (req, res) => {
    res.send(renderLoginPage());
});

// Dashboard (Ana Panel)
app.post('/admin/dashboard', async (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.send(renderErrorPage("Hatalı Şifre Girdiniz!"));
    }

    try {
        const users = await User.find().sort({ createdAt: -1 });
        const bannedList = await BannedHWID.find().sort({ bannedAt: -1 });
        
        res.send(renderDashboardPage(users, bannedList, ADMIN_PASSWORD));
    } catch (e) {
        res.send(renderErrorPage("Veri çekme hatası: " + e.message));
    }
});

// Lisans Oluşturma İşlemi
app.post('/admin/create', async (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.send("Yetkisiz!");

    try {
        let key = req.body.key || generateLicenseKey();
        let expiry = new Date();
        expiry.setDate(expiry.getDate() + parseInt(req.body.days));

        await new User({ 
            licenseKey: key, 
            note: req.body.note, 
            email: req.body.email, 
            phone: req.body.phone, 
            plan: req.body.plan, 
            expirationDate: expiry 
        }).save();

        // Sayfayı yenile (POST verisini tekrar submit et)
        returnBackToDashboard(res, ADMIN_PASSWORD);

    } catch (e) {
        res.send(renderErrorPage("Oluşturma Hatası: " + e.message));
    }
});

// Aksiyonlar (Sil, Banla, Yenile vb.)
app.post('/admin/action', async (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.send("Yetkisiz!");
    const { id, action } = req.body;

    try {
        if (action === 'delete') {
            await User.findByIdAndDelete(id);
        } 
        else if (action === 'reset_hwid') {
            await User.findByIdAndUpdate(id, { hwid: "" });
        } 
        else if (action === 'toggle_status') {
            const u = await User.findById(id); 
            if(u) { u.isActive = !u.isActive; await u.save(); }
        } 
        else if (action === 'extend_30_days') {
            const u = await User.findById(id); 
            if(u) { 
                let d = new Date() > new Date(u.expirationDate) ? new Date() : new Date(u.expirationDate); 
                d.setDate(d.getDate() + 30); 
                u.expirationDate = d; u.isActive = true; 
                await u.save(); 
            }
        } 
        else if (action === 'set_custom_days') {
            const u = await User.findById(id); 
            const days = parseInt(req.body.custom_days);
            if(u && !isNaN(days)) { 
                let d = new Date() > new Date(u.expirationDate) ? new Date() : new Date(u.expirationDate); 
                d.setDate(d.getDate() + days); 
                u.expirationDate = d; u.isActive = true; 
                await u.save(); 
            }
        } 
        else if (action === 'ban_hwid') {
            const u = await User.findById(id); 
            if (u && u.hwid) { 
                await new BannedHWID({ hwid: u.hwid, note: u.note }).save(); 
                u.isActive = false; 
                await u.save(); 
            }
        } 
        else if (action === 'unban_hwid') {
            await BannedHWID.findOneAndDelete({ hwid: req.body.hwid_to_unban });
        }

        returnBackToDashboard(res, ADMIN_PASSWORD);

    } catch (e) {
        res.send(renderErrorPage("İşlem Hatası: " + e.message));
    }
});

// ======================================================================================
// 🎨 HTML & CSS VIEW ENGINE (TEK DOSYADA FULL UI)
// ======================================================================================

function generateLicenseKey() {
    return 'NEX-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function returnBackToDashboard(res, password) {
    res.send(`
        <form id="backForm" action="/admin/dashboard" method="POST">
            <input type="hidden" name="password" value="${password}">
        </form>
        <script>document.getElementById('backForm').submit();</script>
    `);
}

function renderErrorPage(msg) {
    return `
    <body style="background:#1a1a2e; color:#e94560; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh;">
        <h1>⚠️ HATA</h1>
        <p>${msg}</p>
        <a href="/admin" style="color:white; margin-top:20px;">Giriş Sayfasına Dön</a>
    </body>`;
}

// ----------------------------------------------------------------
// GİRİŞ SAYFASI TASARIMI
// ----------------------------------------------------------------
function renderLoginPage() {
    return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nexora Admin Girişi</title>
        <style>
            body { background-color: #0f172a; font-family: 'Segoe UI', sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; }
            .login-card { background: #1e293b; padding: 40px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); width: 350px; text-align: center; border: 1px solid #334155; }
            h2 { color: #f8fafc; margin-bottom: 25px; font-weight: 600; letter-spacing: 1px; }
            input { width: 100%; padding: 12px; margin-bottom: 20px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; box-sizing: border-box; outline: none; transition: 0.3s; }
            input:focus { border-color: #3b82f6; box-shadow: 0 0 8px rgba(59, 130, 246, 0.3); }
            button { width: 100%; padding: 12px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.3s; }
            button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); }
            .logo { font-size: 40px; margin-bottom: 10px; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <div class="logo">🚀</div>
            <h2>NEXORA PANEL</h2>
            <form action="/admin/dashboard" method="POST">
                <input type="password" name="password" placeholder="Yönetici Şifresi" required>
                <button type="submit">GİRİŞ YAP</button>
            </form>
        </div>
    </body>
    </html>`;
}

// ----------------------------------------------------------------
// DASHBOARD TASARIMI (DARK MODE)
// ----------------------------------------------------------------
function renderDashboardPage(users, bannedList, password) {
    
    // İstatistikler
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.isActive && new Date(u.expirationDate) > new Date()).length;
    const totalBanned = bannedList.length;

    // Tablo Satırlarını Oluştur
    const userRows = users.map(u => {
        const daysLeft = Math.ceil((u.expirationDate - new Date()) / (1000 * 60 * 60 * 24));
        const isExpired = daysLeft <= 0;
        const statusClass = (u.isActive && !isExpired) ? 'status-active' : 'status-passive';
        const statusText = (u.isActive && !isExpired) ? 'AKTİF' : (isExpired ? 'SÜRE BİTTİ' : 'PASİF');
        
        // Paket Renkleri
        let planBadge = '';
        if(u.plan === 'Nexora Single') planBadge = '<span class="badge badge-gray">Single</span>';
        if(u.plan === 'Nexora Plus') planBadge = '<span class="badge badge-blue">Plus</span>';
        if(u.plan === 'Nexora Premium') planBadge = '<span class="badge badge-gold">PREMIUM</span>';

        const banButton = u.hwid ? 
            `<button name="action" value="ban_hwid" onclick="return confirm('⚠️ DİKKAT: Bu bilgisayarı (HWID) sonsuza kadar engellemek istiyor musunuz?')" class="btn-icon btn-ban" title="Cihazı Banla">⛔</button>` : 
            `<button type="button" class="btn-icon btn-disabled" disabled>⛔</button>`;

        return `
        <tr>
            <td>
                <div class="user-name">${u.note}</div>
                <div class="user-meta">${u.email || '-'}</div>
                <div class="user-meta">${u.phone || '-'}</div>
            </td>
            <td>${planBadge}</td>
            <td><code class="key-code">${u.licenseKey}</code></td>
            <td><code class="hwid-code">${u.hwid ? u.hwid.substring(0, 15)+'...' : 'BEKLİYOR'}</code></td>
            <td><span style="font-weight:bold; color:${daysLeft > 5 ? '#4ade80' : '#f87171'}">${daysLeft} Gün</span></td>
            <td><span class="status-dot ${statusClass}"></span> ${statusText}</td>
            <td>
                <form action="/admin/action" method="POST" class="action-form">
                    <input type="hidden" name="password" value="${password}">
                    <input type="hidden" name="id" value="${u._id}">
                    
                    <div class="custom-days-wrapper">
                        <input type="number" name="custom_days" placeholder="+Gün">
                        <button name="action" value="set_custom_days" class="btn-mini-add">+</button>
                    </div>

                    <button name="action" value="extend_30_days" class="btn-icon btn-green" title="30 Gün Ekle">📅</button>
                    <button name="action" value="reset_hwid" class="btn-icon btn-orange" title="HWID Sıfırla">♻️</button>
                    <button name="action" value="toggle_status" class="btn-icon btn-blue" title="Aktif/Pasif">⏯️</button>
                    <button name="action" value="delete" onclick="return confirm('Bu lisansı silmek istediğine emin misin?')" class="btn-icon btn-red" title="Sil">🗑️</button>
                    ${banButton}
                </form>
            </td>
        </tr>`;
    }).join('');

    const bannedRows = bannedList.map(b => `
        <tr>
            <td>${b.note}</td>
            <td style="font-family:monospace; color:#ef4444;">${b.hwid}</td>
            <td>${new Date(b.bannedAt).toLocaleDateString()}</td>
            <td>
                <form action="/admin/action" method="POST">
                    <input type="hidden" name="password" value="${password}">
                    <input type="hidden" name="hwid_to_unban" value="${b.hwid}">
                    <button name="action" value="unban_hwid" class="btn-small-green">Ban Kaldır</button>
                </form>
            </td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <title>Nexora SaaS Dashboard</title>
        <style>
            :root {
                --bg-dark: #0f172a;
                --bg-card: #1e293b;
                --text-main: #f1f5f9;
                --text-muted: #94a3b8;
                --border: #334155;
                --primary: #3b82f6;
                --success: #10b981;
                --danger: #ef4444;
                --warning: #f59e0b;
            }
            body { background-color: var(--bg-dark); color: var(--text-main); font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; }
            
            /* Layout */
            .container { max-width: 1400px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; background: linear-gradient(90deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            
            /* Stats Cards */
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border); text-align: center; }
            .stat-number { font-size: 32px; font-weight: bold; color: var(--primary); margin: 10px 0; }
            .stat-label { color: var(--text-muted); font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }

            /* Forms */
            .create-card { background: var(--bg-card); padding: 25px; border-radius: 12px; margin-bottom: 30px; border: 1px solid var(--border); }
            .create-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; align-items: end; }
            input, select { background: #0f172a; border: 1px solid var(--border); color: white; padding: 12px; border-radius: 6px; outline: none; width: 100%; box-sizing: border-box; }
            input:focus, select:focus { border-color: var(--primary); }
            .btn-create { background: var(--success); color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; transition: 0.2s; }
            .btn-create:hover { filter: brightness(1.1); }

            /* Tables */
            .table-container { background: var(--bg-card); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); margin-bottom: 30px; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #0f172a; padding: 15px; text-align: left; color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
            td { padding: 15px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: middle; }
            tr:last-child td { border-bottom: none; }
            tr:hover { background: #263345; }

            /* Elements */
            .user-name { font-weight: 600; color: white; font-size: 15px; }
            .user-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
            .key-code { background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #93c5fd; font-size: 13px; }
            .hwid-code { color: #64748b; font-size: 11px; }
            
            /* Badges */
            .badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; }
            .badge-gray { background: #334155; color: white; }
            .badge-blue { background: #2563eb; color: white; }
            .badge-gold { background: linear-gradient(45deg, #f59e0b, #d97706); color: white; box-shadow: 0 0 10px rgba(245, 158, 11, 0.4); }

            /* Actions */
            .action-form { display: flex; align-items: center; gap: 8px; }
            .btn-icon { width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; transition: 0.2s; }
            .btn-icon:hover { transform: scale(1.1); }
            
            .btn-green { background: rgba(16, 185, 129, 0.2); color: #34d399; }
            .btn-orange { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
            .btn-blue { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
            .btn-red { background: rgba(239, 68, 68, 0.2); color: #f87171; }
            .btn-ban { background: #000; color: #ef4444; border: 1px solid #ef4444; }
            .btn-disabled { background: #334155; color: #64748b; cursor: not-allowed; }

            .custom-days-wrapper { display: flex; align-items: center; background: #0f172a; border-radius: 6px; padding: 2px; border: 1px solid var(--border); }
            .custom-days-wrapper input { width: 50px; border: none; padding: 5px; height: 28px; font-size: 12px; text-align: center; }
            .btn-mini-add { background: var(--primary); color: white; border: none; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; margin-right: 2px; }

            .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
            .status-active { background: var(--success); box-shadow: 0 0 8px var(--success); }
            .status-passive { background: var(--danger); }

            .blacklist-section { border: 1px solid var(--danger); }
            .blacklist-header { color: var(--danger); margin: 0 0 15px 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
            .btn-small-green { background: var(--success); color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }

        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>NEXORA SaaS Yönetim Paneli</h1>
                <div style="font-size:12px; color:#64748b;">Server Status: Online 🟢</div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Toplam Lisans</div>
                    <div class="stat-number">${totalUsers}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Aktif Kullanıcı</div>
                    <div class="stat-number">${activeUsers}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Yasaklı Cihaz</div>
                    <div class="stat-number" style="color:${totalBanned > 0 ? '#ef4444' : '#94a3b8'}">${totalBanned}</div>
                </div>
            </div>

            <!-- YENİ LİSANS FORMU -->
            <div class="create-card">
                <h3 style="margin-top:0; margin-bottom:15px; color:white;">✨ Yeni Müşteri & Lisans Oluştur</h3>
                <form action="/admin/create" method="POST" class="create-form">
                    <input type="hidden" name="password" value="${password}">
                    
                    <div>
                        <input type="text" name="note" placeholder="Ad Soyad" required>
                    </div>
                    <div>
                        <input type="email" name="email" placeholder="E-Posta Adresi">
                    </div>
                    <div>
                        <input type="text" name="phone" placeholder="Telefon No">
                    </div>
                    <div>
                        <select name="plan">
                            <option value="Nexora Single">Nexora Single (1 Ekran)</option>
                            <option value="Nexora Plus">Nexora Plus (2 Ekran)</option>
                            <option value="Nexora Premium">Nexora Premium (3 Ekran)</option>
                        </select>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <input type="text" name="key" placeholder="Özel Key (Opsiyonel)" style="flex:2">
                        <input type="number" name="days" value="30" placeholder="Gün" style="flex:1">
                    </div>
                    <div>
                        <button type="submit" class="btn-create">+ OLUŞTUR</button>
                    </div>
                </form>
            </div>

            <!-- LİSANS TABLOSU -->
            <h3 style="color:white; margin-bottom:15px;">👥 Müşteri Listesi</h3>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th width="20%">Müşteri Bilgileri</th>
                            <th width="10%">Paket</th>
                            <th width="20%">Lisans Anahtarı</th>
                            <th width="15%">HWID (Cihaz ID)</th>
                            <th width="10%">Kalan Süre</th>
                            <th width="10%">Durum</th>
                            <th width="15%">Hızlı İşlemler</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${userRows}
                    </tbody>
                </table>
                ${users.length === 0 ? '<div style="padding:40px; text-align:center; color:#64748b;">Henüz kayıtlı müşteri yok.</div>' : ''}
            </div>

            <!-- BLACKLIST -->
            ${totalBanned > 0 ? `
            <div class="create-card blacklist-section">
                <h3 class="blacklist-header">⛔ Yasaklı Cihazlar (HWID Blacklist)</h3>
                <div class="table-container" style="margin-bottom:0; border:none;">
                    <table>
                        <thead>
                            <tr>
                                <th>Eski Sahibi</th>
                                <th>Engellenen HWID</th>
                                <th>Ban Tarihi</th>
                                <th>İşlem</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${bannedRows}
                        </tbody>
                    </table>
                </div>
            </div>` : ''}
        </div>
    </body>
    </html>`;
}
