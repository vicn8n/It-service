# IT Service Desk — ระบบแจ้งซ่อม IT + ทะเบียนทรัพย์สิน IT

ระบบ web application สำหรับแจ้งซ่อม (Helpdesk Ticketing) และบริหารทะเบียนทรัพย์สิน IT (Asset Management)
ออกแบบให้ deploy บน **Windows Server 2022 + IIS + Node.js + PostgreSQL**

---

## คุณสมบัติ

### 🎫 ระบบแจ้งซ่อม (Helpdesk)
- แจ้งซ่อมพร้อมหมวดหมู่ / ความสำคัญ / แนบไฟล์ / ผูก Asset
- เลขที่ Ticket อัตโนมัติ (INC-0001...)
- Workflow สถานะ: ใหม่ → มอบหมาย → กำลังดำเนินการ → แก้ไขแล้ว → ปิด
- มอบหมายเจ้าหน้าที่ + บันทึกการดำเนินการ (มี comment ภายใน)
- **SLA tracking** อัตโนมัติ — คำนวณ deadline ตามความสำคัญ + แจ้งเตือนเมื่อเกิน SLA
- แจ้งเตือนผู้แจ้งทางอีเมลเมื่อสถานะเปลี่ยน
- ให้คะแนนความพึงพอใจ

### 📦 ทะเบียนทรัพย์สิน (Asset)
- บันทึกครบ: Asset ID, Serial, Hostname, IP/MAC, Spec, OS
- ข้อมูลจัดซื้อ & ประกัน (วันซื้อ, ราคา, vendor, วันหมดประกัน)
- ประวัติการมอบหมายผู้ครอบครอง + ประวัติการแจ้งซ่อมของแต่ละเครื่อง
- Dashboard: นับตามประเภท/สถานะ, แจ้งเตือนประกันใกล้หมด

### 🔐 ระบบกลาง
- Login + JWT (cookie httpOnly), 3 ระดับสิทธิ์: **ADMIN / AGENT / USER**
- Audit log ทุก action สำคัญ
- Rate limiting, Helmet security headers

---

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20 + Express |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | JWT + bcrypt |
| Frontend | Vanilla JS SPA (ไม่ต้อง build step) |
| Email | Nodemailer (SMTP) |
| Process | PM2 |
| Web server | IIS (reverse proxy via URL Rewrite + ARR) |

---

## ติดตั้งบน Windows Server 2022

### ขั้นที่ 0 — ติดตั้ง prerequisites
1. **Node.js 20 LTS** — https://nodejs.org
2. **PostgreSQL 16** — https://www.postgresql.org/download/windows/
3. **IIS** + โมดูล:
   - เปิด IIS ผ่าน Server Manager > Add Roles > Web Server (IIS)
   - ติดตั้ง [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
   - ติดตั้ง [Application Request Routing (ARR)](https://www.iis.net/downloads/microsoft/application-request-routing)

### ขั้นที่ 1 — วางโค้ด
```powershell
# คัดลอกโปรเจกต์ไปที่ C:\inetpub\itsd
Copy-Item -Recurse .\it-service-desk\* C:\inetpub\itsd\
```

### ขั้นที่ 2 — รัน installer
```powershell
# เปิด PowerShell แบบ Administrator
cd C:\inetpub\itsd
# แก้ AppDir/PgBin ใน deploy\install.ps1 เฉพาะเมื่อใช้ path อื่น
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\install.ps1
```
สคริปต์จะถามรหัสผ่าน DB, APP_URL และรหัสผ่าน admin แล้วจึงสร้าง DB → ติดตั้ง dependencies → migrate schema → seed → ตั้ง PM2 ให้ auto-start

ทดสอบ backend:
```powershell
curl http://127.0.0.1:3200/api/health
```

### ขั้นที่ 3 — ตั้งค่า IIS reverse proxy
1. เปิด **IIS Manager** → เลือก Server node → **Application Request Routing Cache** → *Server Proxy Settings* → ติ๊ก **Enable proxy** → Apply
2. สร้าง Site ใหม่ (เช่น `itsd`) ชี้ physical path ไปที่ `C:\inetpub\itsd`
3. ไฟล์ `web.config` (มีให้แล้วใน root) จะ rewrite ทุก request ไปยัง Node.js ที่ `127.0.0.1:3200`
4. ผูก **SSL certificate** (Let's Encrypt ผ่าน win-acme หรือ internal CA) ที่ binding port 443

### ขั้นที่ 4 — Firewall
```powershell
# เปิดเฉพาะ 80/443 จากภายนอก, ปิด 3200 ไม่ให้เข้าถึงตรง
New-NetFirewallRule -DisplayName "HTTP"  -Direction Inbound -LocalPort 80  -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

---

## บัญชีเริ่มต้น
```
อีเมล:    admin@company.local
รหัสผ่าน:  Admin@1234
```
> ⚠️ **เปลี่ยนรหัสผ่านทันที** หลัง login ครั้งแรก

---

## การ backup ฐานข้อมูล (Task Scheduler)
สร้าง scheduled task รันทุกคืน:
```powershell
$env:PGPASSWORD = "DB_PASSWORD"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U itsd_user -h localhost -d it_service_desk `
  -F c -f "D:\backup\itsd_$(Get-Date -Format yyyyMMdd).dump"
```

---

## คำสั่งที่ใช้บ่อย
```powershell
pm2 status                    # ดูสถานะ
pm2 logs it-service-desk      # ดู log
pm2 restart it-service-desk   # restart หลังอัปเดตโค้ด
npx prisma studio             # เปิด DB browser (dev)
```

## อัปเดตเวอร์ชัน
```powershell
git pull                      # หรือคัดลอกไฟล์ใหม่ทับ
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy     # ถ้ามี migration ใหม่
pm2 restart it-service-desk
```

---

## โครงสร้างโปรเจกต์
```
it-service-desk/
├── prisma/schema.prisma      # DB schema (11 ตาราง)
├── src/
│   ├── server.js             # Express entry
│   ├── routes/               # auth, tickets, assets, users, dashboard, meta
│   ├── middleware/           # auth, upload, error
│   └── services/             # email, sla, slaJob
├── public/                   # Frontend SPA (HTML/CSS/JS)
├── deploy/
│   ├── install.ps1           # ตัวติดตั้งอัตโนมัติ
│   └── seed.js               # ข้อมูลตั้งต้น
├── web.config                # IIS reverse proxy
├── ecosystem.config.js       # PM2
└── .env.example
```

---

## หมายเหตุด้านความปลอดภัยก่อนขึ้น production
- [ ] เปลี่ยนรหัส admin และ `JWT_SECRET` (installer สุ่มให้แล้ว)
- [ ] ตั้ง `DATABASE_URL` ด้วยรหัสผ่าน DB ที่แข็งแรง
- [ ] ตั้ง `EMAIL_ENABLED=true` + ค่า SMTP จริง
- [ ] เปิด HTTPS เท่านั้น (web.config บังคับ redirect แล้ว)
- [ ] ตั้ง backup อัตโนมัติ + ทดสอบ restore
- [ ] จำกัด firewall ให้เข้าถึงได้เฉพาะที่จำเป็น
