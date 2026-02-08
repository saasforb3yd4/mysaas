/**
 * ======================================================================================
 * NEXORA SAAS - LISANS YÖNETİM SİSTEMİ (V7.0 - LUNATICARET DB & AUTH)
 * ======================================================================================
 * Özellikler:
 * - Şifre Korumalı Admin Paneli (Pass: mylittledaisy)
 * - Lunaticaret MongoDB Veritabanı (users tablosu)
 * - Single ve Premium (İkili) Mod Desteği
 * - Müşteri Bilgileri Düzenleme & Arama
 * - HWID Kilidi ve Ban Sistemi
 */

const express = require('express');
const dns = require('dns'); 
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const app = express();

// ----------------------------------------------------------------
// 🛠️ GÜVENLİK AYARLARI
// ----------------------------------------------------------------
const ADMIN_PASSWORD = "mylittledaisy"; // Belirlediğin şifre

try {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
    console.log("⚠️ DNS Ayarı Uyarısı:", e.message);
}

// ----------------------------------------------------------------
// ⚙️ AYARLAR VE VERİTABANI BAĞLANTISI
// ----------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const MONGO_URI = "mongodb+srv://lunaaticaret_mongodb:1IT2rbRJgErfUTFq@lunaticaret.axatcsg.mongodb.net/lunaticaret?retryWrites=true&w=majority&appName=lunaticaret"; 

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Lunaticaret MongoDB Bağlantısı Başarılı!"))
    .catch(err => console.error("❌ MongoDB Hatası:", err));

// ----------------------------------------------------------------
// 📝 VERİTABANI ŞEMASI (USERS TABLOSU)
// ----------------------------------------------------------------
const UserSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true },
    plan: { type: String, required: true }, 
    hwid: { type: String, default: null },
    expiryDate: { type: Date, required: true },
    isBanned: { type: Boolean, default: false },
    customer: {
        name: { type: String, default: "" },
        phone: { type: String, default: "" },
        note: { type: String, default: "" }
    },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'users' });

const User = mongoose.model('User', UserSchema);

// ----------------------------------------------------------------
// 🔐 GÜVENLİK MIDDLEWARE (ŞİFRE KONTROLÜ)
// ----------------------------------------------------------------
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['x-admin-password'];
    if (authHeader === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ success: false, message: "Yetkisiz Erişim! Şifre yanlış." });
    }
};

// ----------------------------------------------------------------
// 🚀 1. BOT GİRİŞ API (LUNA BOT) - Şifre Gerekmez
// ----------------------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { licenseKey, hwid } = req.body;
    try {
        const user = await User.findOne({ licenseKey: licenseKey });
        if (!user) return res.json({ success: false, message: "Geçersiz Lisans Anahtarı!" });
        if (user.isBanned) return res.json({ success: false, message: "Bu lisans yasaklanmıştır!" });
        if (new Date() > user.expiryDate) return res.json({ success: false, message: "Lisans süresi dolmuş!" });

        if (!user.hwid) {
            user.hwid = hwid;
            await user.save();
        } else if (user.hwid !== hwid) {
            return res.json({ success: false, message: "Lisans başka bir cihaza kilitli!" });
        }

        return res.json({ success: true, plan: user.plan, expiry: user.expiryDate });
    } catch (error) {
        res.status(500).json({ success: false, message: "Sunucu hatası" });
    }
});

// ----------------------------------------------------------------
// 🛠️ 2. YÖNETİM API'LERİ (ŞİFRE KORUMALI)
// ----------------------------------------------------------------

app.post('/api/admin/create', authMiddleware, async (req, res) => {
    const { plan, days, name, phone, note } = req.body;
    const key = "NEX-" + crypto.randomBytes(4).toString('hex').toUpperCase() + "-" + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + parseInt(days));

    const newUser = new User({
        licenseKey: key, plan, expiryDate: expiry,
        customer: { name, phone, note }
    });
    await newUser.save();
    res.json({ success: true, key });
});

app.post('/api/admin/edit', authMiddleware, async (req, res) => {
    const { id, name, phone, note, plan, addDays } = req.body;
    try {
        const user = await User.findById(id);
        if(!user) return res.json({ success: false });
        if(name) user.customer.name = name;
        if(phone) user.customer.phone = phone;
        if(note) user.customer.note = note;
        if(plan) user.plan = plan;
        if(addDays) {
            let current = new Date(user.expiryDate);
            current.setDate(current.getDate() + parseInt(addDays));
            user.expiryDate = current;
        }
        await user.save();
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/resethwid', authMiddleware, async (req, res) => {
    await User.findByIdAndUpdate(req.body.id, { hwid: null });
    res.json({ success: true });
});

app.post('/api/admin/toggleban', authMiddleware, async (req, res) => {
    const user = await User.findById(req.body.id);
    user.isBanned = !user.isBanned;
    await user.save();
    res.json({ success: true, status: user.isBanned });
});

app.post('/api/admin/delete', authMiddleware, async (req, res) => {
    await User.findByIdAndDelete(req.body.id);
    res.json({ success: true });
});

app.get('/api/admin/licenses', authMiddleware, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
});

// ----------------------------------------------------------------
// 🖥️ 3. ADMIN PANEL ARAYÜZÜ (HTML & AUTH UI)
// ----------------------------------------------------------------
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nexora V7 Admin - Lunaticaret</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --accent: #3b82f6; --danger: #ef4444; --success: #22c55e; }
            body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; margin: 0; padding: 20px; overflow-x: hidden; }
            
            /* Login Overlay */
            #loginOverlay { position: fixed; top:0; left:0; width:100%; height:100%; background: var(--bg); z-index: 9999; display: flex; justify-content: center; align-items: center; }
            .login-box { background: var(--card); padding: 40px; border-radius: 16px; border: 1px solid #334155; width: 350px; text-align: center; }

            .container { max-width: 1200px; margin: 0 auto; display: none; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid #334155; padding-bottom: 20px; }
            h1 { margin: 0; font-size: 24px; background: linear-gradient(45deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            
            .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 30px; }
            .card { background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid #334155; }
            
            input, select, textarea { width: 100%; background: #0f172a; border: 1px solid #334155; color: white; padding: 12px; margin-bottom: 15px; border-radius: 8px; box-sizing: border-box; }
            button { width: 100%; padding: 12px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
            .btn-primary { background: var(--accent); color: white; }
            
            .table-container { overflow-x: auto; background: var(--card); border-radius: 12px; border: 1px solid #334155; }
            table { width: 100%; border-collapse: collapse; }
            th { text-align: left; padding: 15px; background: #0f172a; color: #94a3b8; font-size: 13px; }
            td { padding: 15px; border-bottom: 1px solid #334155; font-size: 14px; }
            tr:hover { background: #334155; }
            
            .badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
            .bg-single { background: #dbeafe; color: #1e40af; }
            .bg-premium { background: #fce7f3; color: #9d174d; }
            
            .actions { display: flex; gap: 5px; }
            .btn-icon { padding: 6px 10px; font-size: 16px; border-radius: 6px; width: auto; }
            .banned-row { opacity: 0.5; background: #2a1212 !important; }

            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); justify-content: center; align-items: center; z-index: 1000; }
            .modal-content { background: var(--card); padding: 30px; border-radius: 12px; width: 400px; position: relative; }
        </style>
    </head>
    <body>
        <!-- Giriş Ekranı -->
        <div id="loginOverlay">
            <div class="login-box">
                <h2 style="margin-top:0">🔒 Yönetici Girişi</h2>
                <p style="color: #94a3b8; font-size: 14px;">Lütfen panel şifresini girin.</p>
                <input type="password" id="adminPass" placeholder="Şifre" onkeypress="if(event.key==='Enter') verifyPass()">
                <button class="btn-primary" onclick="verifyPass()">Giriş Yap</button>
            </div>
        </div>

        <div class="container" id="mainContainer">
            <div class="header">
                <h1>💎 Nexora V7 Admin - Lunaticaret</h1>
                <button onclick="logout()" style="width:auto; padding:8px 15px; background:#334155; color:white;">Çıkış Yap</button>
            </div>

            <div class="grid">
                <div class="card">
                    <h3 style="margin-top:0">✨ Yeni Lisans Oluştur</h3>
                    <input type="text" id="c_name" placeholder="Müşteri Adı Soyadı">
                    <input type="text" id="c_phone" placeholder="Telefon No">
                    <select id="c_plan">
                        <option value="Nexora Single">Nexora Single (Tek Ekran)</option>
                        <option value="Nexora Premium">Nexora Premium (Çift Ekran)</option>
                    </select>
                    <select id="c_days">
                        <option value="30">30 Gün</option>
                        <option value="365">1 Yıl</option>
                        <option value="9999">Sınırsız</option>
                    </select>
                    <input type="text" id="c_note" placeholder="Özel Not">
                    <button class="btn-primary" onclick="createLicense()">Lisans Oluştur</button>
                </div>

                <div class="card">
                    <h3 style="margin-top:0">🔍 Müşteri Ara</h3>
                    <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="İsim, Telefon veya Key ara...">
                    <div style="margin-top: 20px; padding: 15px; background: #0f172a; border-radius: 8px; text-align:center;">
                        <small style="color:#94a3b8">Toplam Kullanıcı</small>
                        <div id="totalCount" style="font-size: 28px; font-weight: bold;">0</div>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Müşteri Bilgisi</th>
                            <th>Paket</th>
                            <th>Kalan Gün</th>
                            <th>licenseKey</th>
                            <th>HWID</th>
                            <th>İşlemler</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody"></tbody>
                </table>
            </div>
        </div>

        <!-- Edit Modal -->
        <div id="editModal" class="modal">
            <div class="modal-content">
                <h3>✏️ Müşteri Düzenle</h3>
                <input type="hidden" id="e_id">
                <input type="text" id="e_name" placeholder="İsim">
                <input type="text" id="e_phone" placeholder="Telefon">
                <input type="text" id="e_note" placeholder="Not">
                <select id="e_plan">
                    <option value="Nexora Single">Nexora Single</option>
                    <option value="Nexora Premium">Nexora Premium</option>
                </select>
                <input type="number" id="e_addDays" value="0" placeholder="Gün Ekle/Çıkar">
                <button class="btn-primary" onclick="saveEdit()">Güncelle</button>
                <button onclick="closeModal()" style="background:transparent; color:#94a3b8; margin-top:10px;">İptal</button>
            </div>
        </div>

        <script>
            let currentPass = localStorage.getItem('nexora_admin_pass') || "";
            let allUsers = [];

            function verifyPass() {
                const pass = document.getElementById('adminPass').value;
                if(pass === "${ADMIN_PASSWORD}") {
                    currentPass = pass;
                    localStorage.setItem('nexora_admin_pass', pass);
                    showPanel();
                } else {
                    alert("Hatalı Şifre!");
                }
            }

            function showPanel() {
                document.getElementById('loginOverlay').style.display = 'none';
                document.getElementById('mainContainer').style.display = 'block';
                loadData();
            }

            function logout() {
                localStorage.removeItem('nexora_admin_pass');
                location.reload();
            }

            async function apiFetch(url, options = {}) {
                options.headers = options.headers || {};
                options.headers['x-admin-password'] = currentPass;
                options.headers['Content-Type'] = 'application/json';
                const res = await fetch(url, options);
                if(res.status === 401) { logout(); }
                return res.json();
            }

            async function loadData() {
                const data = await apiFetch('/api/admin/licenses');
                allUsers = data;
                renderTable(allUsers);
                document.getElementById('totalCount').innerText = allUsers.length;
            }

            function renderTable(data) {
                const tbody = document.getElementById('tableBody');
                tbody.innerHTML = "";
                data.forEach(u => {
                    const diff = Math.ceil((new Date(u.expiryDate) - new Date()) / (1000*60*60*24));
                    const statusText = u.isBanned ? '<span style="color:red">BAN</span>' : (diff < 0 ? '<span style="color:orange">BİTTİ</span>' : diff + " Gün");
                    
                    tbody.innerHTML += \`
                        <tr class="\${u.isBanned ? 'banned-row' : ''}">
                            <td><b>\${u.customer.name}</b><br><small>\${u.customer.phone}</small></td>
                            <td><span class="badge \${u.plan.includes('Premium') ? 'bg-premium' : 'bg-single'}">\${u.plan}</span></td>
                            <td>\${statusText}</td>
                            <td style="font-family:monospace; font-size:12px;">\${u.licenseKey}</td>
                            <td>\${u.hwid ? '🔒' : '🔓'}</td>
                            <td>
                                <div class="actions">
                                    <button class="btn-icon" style="background:#f59e0b" onclick="openEdit('\${u._id}')">✏️</button>
                                    <button class="btn-icon" style="background:#3b82f6" onclick="resetHWID('\${u._id}')">🔓</button>
                                    <button class="btn-icon" style="background:#ef4444" onclick="toggleBan('\${u._id}')">🚫</button>
                                    <button class="btn-icon" style="background:#334155" onclick="deleteU('\${u._id}')">🗑️</button>
                                </div>
                            </td>
                        </tr>\`;
                });
            }

            function filterTable() {
                const q = document.getElementById('searchInput').value.toLowerCase();
                const filtered = allUsers.filter(u => u.customer.name.toLowerCase().includes(q) || u.licenseKey.toLowerCase().includes(q));
                renderTable(filtered);
            }

            async function createLicense() {
                const body = {
                    name: document.getElementById('c_name').value,
                    phone: document.getElementById('c_phone').value,
                    plan: document.getElementById('c_plan').value,
                    days: document.getElementById('c_days').value,
                    note: document.getElementById('c_note').value
                };
                const data = await apiFetch('/api/admin/create', { method: 'POST', body: JSON.stringify(body) });
                if(data.success) { alert("Key: " + data.key); loadData(); }
            }

            async function resetHWID(id) { await apiFetch('/api/admin/resethwid', { method: 'POST', body: JSON.stringify({id}) }); loadData(); }
            async function toggleBan(id) { await apiFetch('/api/admin/toggleban', { method: 'POST', body: JSON.stringify({id}) }); loadData(); }
            async function deleteU(id) { if(confirm("Silinsin mi?")) { await apiFetch('/api/admin/delete', { method: 'POST', body: JSON.stringify({id}) }); loadData(); } }

            function openEdit(id) {
                const u = allUsers.find(x => x._id === id);
                document.getElementById('e_id').value = id;
                document.getElementById('e_name').value = u.customer.name;
                document.getElementById('e_phone').value = u.customer.phone;
                document.getElementById('e_note').value = u.customer.note;
                document.getElementById('e_plan').value = u.plan;
                document.getElementById('editModal').style.display = "flex";
            }

            function closeModal() { document.getElementById('editModal').style.display = "none"; }

            async function saveEdit() {
                const body = {
                    id: document.getElementById('e_id').value,
                    name: document.getElementById('e_name').value,
                    phone: document.getElementById('e_phone').value,
                    note: document.getElementById('e_note').value,
                    plan: document.getElementById('e_plan').value,
                    addDays: document.getElementById('e_addDays').value
                };
                await apiFetch('/api/admin/edit', { method: 'POST', body: JSON.stringify(body) });
                closeModal(); loadData();
            }

            // Sayfa başlarken şifre kontrolü
            if(currentPass === "${ADMIN_PASSWORD}") showPanel();
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`🚀 Server Başladı: http://localhost:${PORT}`));
