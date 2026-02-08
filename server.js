/**
 * ======================================================================================
 * NEXORA SAAS - LISANS YÖNETİM SİSTEMİ (V7.0 - LUNATICARET DB)
 * ======================================================================================
 * Özellikler:
 * - Lunaticaret MongoDB Veritabanı (users tablosu)
 * - Single ve Premium (İkili) Mod Desteği
 * - Müşteri Bilgileri Düzenleme & Arama
 * - HWID Kilidi ve Ban Sistemi
 * - Gelişmiş Dark Mode Panel
 */

const express = require('express');
const dns = require('dns'); 
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const app = express();

// ----------------------------------------------------------------
// 🛠️ AĞ VE BAĞLANTI AYARLARI
// ----------------------------------------------------------------
try {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    console.log("✅ DNS Sunucuları Ayarlandı (Google & Cloudflare)");
} catch (e) {
    console.log("⚠️ DNS Ayarı Uyarısı:", e.message);
}

// ----------------------------------------------------------------
// ⚙️ AYARLAR VE VERİTABANI BAĞLANTISI
// ----------------------------------------------------------------
const PORT = process.env.PORT || 3000;
// Lunaticaret Veritabanı Bağlantısı
const MONGO_URI = "mongodb+srv://lunaaticaret_mongodb:1IT2rbRJgErfUTFq@lunaticaret.axatcsg.mongodb.net/lunaticaret?retryWrites=true&w=majority&appName=lunaticaret"; 

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Veritabanı Bağlantısı
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Lunaticaret MongoDB Bağlantısı Başarılı!"))
    .catch(err => console.error("❌ MongoDB Hatası:", err));

// ----------------------------------------------------------------
// 📝 VERİTABANI ŞEMASI (USERS TABLOSU)
// ----------------------------------------------------------------
const UserSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true }, // License alanı
    plan: { type: String, required: true }, // "Nexora Single" veya "Nexora Premium"
    hwid: { type: String, default: null },  // HWID (Cihaz ID)
    expiryDate: { type: Date, required: true },
    isBanned: { type: Boolean, default: false }, // Yasaklanma durumu
    
    // Müşteri / User Bilgileri
    customer: {
        name: { type: String, default: "" },
        phone: { type: String, default: "" },
        note: { type: String, default: "" }
    },
    
    createdAt: { type: Date, default: Date.now }
}, { collection: 'users' }); // Açıkça 'users' tablosunu kullanması için

const User = mongoose.model('User', UserSchema);

// ----------------------------------------------------------------
// 🚀 1. BOT GİRİŞ API (LUNA BOT)
// ----------------------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { licenseKey, hwid } = req.body;

    try {
        const user = await User.findOne({ licenseKey: licenseKey });

        // 1. Kullanıcı/Lisans Yok
        if (!user) {
            return res.json({ success: false, message: "Geçersiz Lisans Anahtarı!" });
        }

        // 2. Banlı mı?
        if (user.isBanned) {
            return res.json({ success: false, message: "Bu lisans yasaklanmıştır! (BANNED)" });
        }

        // 3. Süre Kontrolü
        if (new Date() > user.expiryDate) {
            return res.json({ success: false, message: "Lisans süresi dolmuş!", action: "delete_license" });
        }

        // 4. HWID Kontrolü
        if (!user.hwid) {
            // İlk giriş: Cihazı kilitle
            user.hwid = hwid;
            await user.save();
        } else if (user.hwid !== hwid) {
            // Farklı cihaz tespiti
            return res.json({ success: false, message: "Lisans başka bir cihaza kilitli! (HWID Reset Gerekli)" });
        }

        // 5. Başarılı Giriş
        console.log(`[LOGIN] ${user.customer.name || 'Bilinmeyen'} (${user.plan}) giriş yaptı.`);
        return res.json({ 
            success: true, 
            plan: user.plan,
            expiry: user.expiryDate
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Sunucu hatası" });
    }
});

// ----------------------------------------------------------------
// 🛠️ 2. YÖNETİM API'LERİ (ADMIN PANELİ)
// ----------------------------------------------------------------

// YENİ KULLANICI / LİSANS OLUŞTUR
app.post('/api/admin/create', async (req, res) => {
    const { plan, days, name, phone, note } = req.body;
    
    // Rastgele Key Üret: NEX-XXXX-XXXX
    const key = "NEX-" + crypto.randomBytes(4).toString('hex').toUpperCase() + "-" + crypto.randomBytes(4).toString('hex').toUpperCase();
    
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + parseInt(days));

    const newUser = new User({
        licenseKey: key,
        plan,
        expiryDate: expiry,
        customer: {
            name: name || "Müşteri",
            phone: phone || "",
            note: note || ""
        }
    });

    await newUser.save();
    res.json({ success: true, key });
});

// KULLANICI BİLGİLERİNİ GÜNCELLE (EDİT)
app.post('/api/admin/edit', async (req, res) => {
    const { id, name, phone, note, plan, addDays } = req.body;

    try {
        const user = await User.findById(id);
        if(!user) return res.json({ success: false, message: "Kullanıcı bulunamadı" });

        // Bilgileri Güncelle
        if(name) user.customer.name = name;
        if(phone) user.customer.phone = phone;
        if(note) user.customer.note = note;
        if(plan) user.plan = plan;
        
        // Süre Güncelleme
        if(addDays && parseInt(addDays) !== 0) {
            const current = new Date(user.expiryDate);
            current.setDate(current.getDate() + parseInt(addDays));
            user.expiryDate = current;
        }

        await user.save();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// HWID SIFIRLAMA
app.post('/api/admin/resethwid', async (req, res) => {
    await User.findByIdAndUpdate(req.body.id, { hwid: null });
    res.json({ success: true });
});

// BAN DURUMUNU DEĞİŞTİR
app.post('/api/admin/toggleban', async (req, res) => {
    const user = await User.findById(req.body.id);
    user.isBanned = !user.isBanned;
    await user.save();
    res.json({ success: true, status: user.isBanned });
});

// KULLANICIYI SİL
app.post('/api/admin/delete', async (req, res) => {
    await User.findByIdAndDelete(req.body.id);
    res.json({ success: true });
});

// TÜM KULLANICILARI LİSTELE
app.get('/api/admin/licenses', async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
});

// ----------------------------------------------------------------
// 🖥️ 3. ADMIN PANEL ARAYÜZÜ (HTML)
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
            body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; margin: 0; padding: 20px; }
            
            .container { max-width: 1200px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid #334155; padding-bottom: 20px; }
            h1 { margin: 0; font-size: 24px; background: linear-gradient(45deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            
            .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 30px; }
            .card { background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid #334155; }
            
            input, select, textarea { width: 100%; background: #0f172a; border: 1px solid #334155; color: white; padding: 12px; margin-bottom: 15px; border-radius: 8px; box-sizing: border-box; }
            input:focus { outline: 2px solid var(--accent); border-color: transparent; }
            
            button { width: 100%; padding: 12px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
            .btn-primary { background: var(--accent); color: white; }
            .btn-primary:hover { background: #2563eb; }
            
            .table-container { overflow-x: auto; background: var(--card); border-radius: 12px; border: 1px solid #334155; }
            table { width: 100%; border-collapse: collapse; }
            th { text-align: left; padding: 15px; background: #0f172a; color: #94a3b8; font-size: 14px; }
            td { padding: 15px; border-bottom: 1px solid #334155; font-size: 14px; }
            tr:last-child td { border-bottom: none; }
            tr:hover { background: #334155; }
            
            .badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
            .bg-single { background: #dbeafe; color: #1e40af; }
            .bg-premium { background: #fce7f3; color: #9d174d; }
            
            .actions { display: flex; gap: 5px; }
            .btn-icon { padding: 6px 10px; font-size: 16px; border-radius: 6px; width: auto; }
            .btn-edit { background: #f59e0b; color: white; }
            .btn-reset { background: #3b82f6; color: white; }
            .btn-ban { background: #ef4444; color: white; }
            .banned-row { opacity: 0.5; background: #2a1212 !important; }

            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); justify-content: center; align-items: center; z-index: 1000; }
            .modal-content { background: var(--card); padding: 30px; border-radius: 12px; width: 400px; position: relative; }
            .close-modal { position: absolute; top: 15px; right: 20px; cursor: pointer; font-size: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>💎 Nexora Admin - Lunaticaret Database</h1>
                <div style="color: #94a3b8; font-size: 14px;">DB: users @ lunaticaret</div>
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
                        <option value="60">60 Gün</option>
                        <option value="365">1 Yıl</option>
                        <option value="9999">Sınırsız</option>
                    </select>
                    <input type="text" id="c_note" placeholder="Özel Not">
                    <button class="btn-primary" onclick="createLicense()">Lisans Oluştur</button>
                </div>

                <div class="card" style="display:flex; flex-direction:column;">
                    <h3 style="margin-top:0">🔍 Müşteri Ara</h3>
                    <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="İsim, Telefon, Key veya Not ara...">
                    <div style="margin-top: auto; padding: 15px; background: #0f172a; border-radius: 8px;">
                        <small style="color:#94a3b8">Toplam Kayıtlı Kullanıcı</small>
                        <div id="totalCount" style="font-size: 24px; font-weight: bold;">0</div>
                    </div>
                </div>
            </div>

            <div class="table-container">
                <table id="licenseTable">
                    <thead>
                        <tr>
                            <th>Müşteri</th>
                            <th>Paket</th>
                            <th>Bitiş & Durum</th>
                            <th>Lisans (licenseKey)</th>
                            <th>HWID</th>
                            <th>İşlemler</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody"></tbody>
                </table>
            </div>
        </div>

        <div id="editModal" class="modal">
            <div class="modal-content">
                <span class="close-modal" onclick="closeModal()">&times;</span>
                <h3>✏️ Kullanıcı Düzenle</h3>
                <input type="hidden" id="e_id">
                <label>Ad Soyad</label> <input type="text" id="e_name">
                <label>Telefon</label> <input type="text" id="e_phone">
                <label>Not</label> <input type="text" id="e_note">
                <label>Paket</label>
                <select id="e_plan">
                    <option value="Nexora Single">Nexora Single</option>
                    <option value="Nexora Premium">Nexora Premium</option>
                </select>
                <label>Süre Ekle (Gün)</label> <input type="number" id="e_addDays" value="0">
                <button class="btn-primary" onclick="saveEdit()">Güncelle</button>
            </div>
        </div>

        <script>
            let allUsers = [];

            async function loadData() {
                const res = await fetch('/api/admin/licenses');
                allUsers = await res.json();
                renderTable(allUsers);
                document.getElementById('totalCount').innerText = allUsers.length;
            }

            function renderTable(data) {
                const tbody = document.getElementById('tableBody');
                tbody.innerHTML = "";
                data.forEach(u => {
                    const bannedClass = u.isBanned ? "banned-row" : "";
                    const badge = u.plan.includes("Premium") ? "bg-premium" : "bg-single";
                    const daysLeft = Math.ceil((new Date(u.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
                    const hwidStatus = u.hwid ? "🔒 Kilitli" : "🔓 Boşta";
                    
                    tbody.innerHTML += \`
                        <tr class="\${bannedClass}">
                            <td>
                                <div style="font-weight:600">\${u.customer.name}</div>
                                <div style="font-size:12px; color:#64748b">\${u.customer.phone}</div>
                            </td>
                            <td><span class="badge \${badge}">\${u.plan}</span></td>
                            <td>
                                \${u.isBanned ? '<span style="color:red">BANLANDI</span>' : 
                                  daysLeft < 0 ? '<span style="color:orange">BİTTİ</span>' : daysLeft + " Gün"}
                                <div style="font-size:11px; color:#64748b">\${new Date(u.expiryDate).toLocaleDateString()}</div>
                            </td>
                            <td style="font-family:monospace; font-size:12px;">\${u.licenseKey}</td>
                            <td style="font-size:12px;">\${hwidStatus}</td>
                            <td>
                                <div class="actions">
                                    <button class="btn-icon btn-edit" onclick="openEdit('\${u._id}')">✏️</button>
                                    <button class="btn-icon btn-reset" onclick="resetHWID('\${u._id}')">🔓</button>
                                    <button class="btn-icon btn-ban" onclick="toggleBan('\${u._id}')">🚫</button>
                                    <button class="btn-icon" style="background:#334155" onclick="deleteU('\${u._id}')">🗑️</button>
                                </div>
                            </td>
                        </tr>\`;
                });
            }

            function filterTable() {
                const q = document.getElementById('searchInput').value.toLowerCase();
                const filtered = allUsers.filter(u => 
                    u.customer.name.toLowerCase().includes(q) || u.customer.phone.includes(q) || u.licenseKey.toLowerCase().includes(q)
                );
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
                if(!body.name) return alert("Ad zorunludur!");
                const res = await fetch('/api/admin/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
                const data = await res.json();
                if(data.success) { alert("Key: " + data.key); loadData(); }
            }

            async function resetHWID(id) { if(confirm("HWID sıfırlansın mı?")) { await fetch('/api/admin/resethwid', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }); loadData(); } }
            async function toggleBan(id) { await fetch('/api/admin/toggleban', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }); loadData(); }
            async function deleteU(id) { if(confirm("Silinsin mi?")) { await fetch('/api/admin/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }); loadData(); } }

            function openEdit(id) {
                const u = allUsers.find(x => x._id === id);
                document.getElementById('e_id').value = id;
                document.getElementById('e_name').value = u.customer.name;
                document.getElementById('e_phone').value = u.customer.phone;
                document.getElementById('e_note').value = u.customer.note;
                document.getElementById('e_plan').value = u.plan;
                document.getElementById('e_addDays').value = 0;
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
                await fetch('/api/admin/edit', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
                closeModal(); loadData();
            }

            loadData();
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`🚀 Server Başladı: http://localhost:${PORT}`));
