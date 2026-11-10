# คู่มือขึ้นใช้งานจริง (Go-Live) — IT Service Desk

ระบบนี้ออกแบบให้รันบน **Windows Server 2022 + IIS (reverse proxy) + PostgreSQL 16 + PM2**
Node/Express ฟังที่ port ภายใน (เช่น 3200) และ IIS ทำหน้าที่รับ HTTPS จากภายนอกแล้ว proxy เข้ามา

---

## 1) HTTPS / SSL (IIS Reverse Proxy)

ติดตั้งส่วนเสริม IIS: **URL Rewrite** + **Application Request Routing (ARR)**

**ทางลัด (อัตโนมัติ):** ติดตั้ง URL Rewrite + ARR แล้วรัน (Administrator):
```
.\deploy\setup-iis.ps1 -Hostname servicedesk.company.com -CertThumbprint <thumbprint> -NodePort 3200
```
สคริปต์จะ: เช็คส่วนเสริม → เปิด ARR proxy → สร้างไซต์ → วาง web.config (ปรับ port ให้) → ผูกใบรับรอง SSL กับ 443
(หา thumbprint: `Get-ChildItem Cert:\LocalMachine\My | Format-List Subject, Thumbprint`)

**หรือทำเอง:**
1. เปิด ARR proxy: IIS Manager → เครื่อง → *Application Request Routing Cache* → *Server Proxy Settings* → ติ๊ก **Enable proxy**
2. สร้างเว็บไซต์ผูกโดเมน + ใบรับรอง SSL (binding `https` 443) — ใช้ใบรับรองจริง (เช่น Let's Encrypt ผ่าน *win-acme*, หรือใบจากองค์กร)
3. เพิ่มกฎ URL Rewrite ใน `web.config` ของไซต์ (ดูตัวอย่าง `deploy/web.config`)

หลักการ: ภายนอกเข้า `https://servicedesk.company.com` → IIS terminate SSL → forward ไป `http://127.0.0.1:3200`
แอปตั้ง `app.set("trust proxy", 1)` ไว้แล้ว จึงอ่าน `X-Forwarded-*` ได้ถูกต้อง

### บังคับ HTTPS + HSTS
- helmet เปิด HSTS อัตโนมัติเมื่อ `NODE_ENV=production`
- เพิ่มกฎ redirect `http → https` ใน IIS (ดู `web.config`)

### Secure cookie
ตั้ง `NODE_ENV=production` ใน `.env` → cookie `token` จะมี `Secure` flag อัตโนมัติ (ส่งผ่าน HTTPS เท่านั้น)
และตั้ง `APP_URL=https://servicedesk.company.com` เพื่อจำกัด CORS

---

## 2) ตัวแปรแวดล้อม (.env) ที่ต้องตั้งก่อน Go-Live

```
NODE_ENV=production
PORT=3200
APP_URL=https://servicedesk.company.com
DATABASE_URL=postgresql://itsd_user:<STRONG_PASS>@localhost:5432/it_service_desk
JWT_SECRET=<สุ่ม 64+ ตัวอักษร — install.ps1 สุ่มให้>
JWT_EXPIRES_IN=8h

# นโยบายล็อกบัญชี (ดีฟอลต์ 5 ครั้ง / 15 นาที)
LOGIN_MAX_FAILED=5
LOGIN_LOCK_MINUTES=15

# อีเมลแจ้งเตือน (ถ้าใช้)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="IT Service Desk <helpdesk@company.com>"

# Email-to-Ticket (ถ้าเปิด)
IMAP_ENABLED=false
IMAP_HOST=...
IMAP_PORT=993
IMAP_USER=helpdesk@company.com
IMAP_PASS=...
IMAP_POLL_SECONDS=60

# LDAP/AD (ถ้าใช้)
LDAP_ENABLED=false
```

---

## 3) ฐานข้อมูล — ใช้ Migration (ไม่ใช่ db push)

ระบบมี migration history ใน `prisma/migrations/`
- **ติดตั้ง/อัปเดต production:** `npx prisma migrate deploy` (install.ps1 เรียกให้แล้ว) — ปลอดภัย ไม่ทำลายข้อมูล
- **แก้ schema ใน dev:** `npx prisma migrate dev --name <ชื่อ>` แล้ว commit โฟลเดอร์ migration ใหม่
- ห้ามใช้ `db push` บน production

---

## 4) สำรองข้อมูลอัตโนมัติ

ใช้ `deploy/backup.ps1` (pg_dump custom format + zip uploads + **verify dump** + หมุนเวียน 14 วัน)

**ตั้ง Scheduled Task อัตโนมัติ** (Administrator) — รันทุกวันตี 2:
```
.\deploy\setup-backup-task.ps1            # หรือ -Time "01:30" กำหนดเวลาเอง
```
ทดสอบรันทันที: `Start-ScheduledTask -TaskName ITSM-Backup`

**ทดสอบกู้คืน (ทำเดือนละครั้ง)** — กู้ลง DB ชั่วคราว + นับ row ยืนยัน ไม่แตะ DB จริง:
```
.\deploy\restore.ps1 -DumpFile D:\backups\itsm\itsm_db_<stamp>.dump -Drop
```
กู้คืนจริง (อันตราย เขียนทับ — หยุดแอปก่อน): `.\deploy\restore.ps1 -DumpFile <ไฟล์> -InPlace`

> ✅ backup.ps1 ตรวจ `pg_restore --list` ทุกครั้งเพื่อยืนยันไฟล์ dump ไม่เสีย

---

## 5) Process & Log rotation (PM2)

```
pm2 start src/server.js --name itsm -i 1
pm2 save
pm2 startup   # ตั้งให้รันอัตโนมัติเมื่อบูตเครื่อง
```

ติดตั้ง log rotation:
```
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

> หมายเหตุ: รันแบบ instance เดียว (`-i 1`) เพราะ in-app SLA job + lockout ใช้สถานะใน DB
> ถ้าจะ scale หลาย instance ควรย้าย scheduled job ออกเป็น service แยก

---

## 6) Health check / Monitoring

- `GET /health` — คืน `200` + `{ok, db, uptimeSec, version}` เมื่อปกติ, `503` เมื่อ DB ล่ม
- ใช้กับ IIS Application Initialization, load balancer probe, หรือ uptime monitor
- ตัวอย่างเช็คด้วย PowerShell:
  ```
  (Invoke-WebRequest http://127.0.0.1:3200/health -UseBasicParsing).StatusCode
  ```

---

## 7) Checklist ก่อนเปิดใช้จริง

- [ ] `NODE_ENV=production`, `JWT_SECRET` สุ่มใหม่, รหัส DB เปลี่ยนจากค่า dev
- [ ] เปลี่ยนรหัส `admin@company.local` จาก seed ทันทีหลังติดตั้ง
- [ ] HTTPS ทำงาน + redirect http→https + ใบรับรองไม่หมดอายุ
- [ ] `prisma migrate deploy` สำเร็จ (ไม่ใช้ db push)
- [ ] Scheduled backup รันได้ (`setup-backup-task.ps1`) + ทดสอบกู้คืนแล้ว (`restore.ps1`)
- [ ] PM2 startup + logrotate ตั้งแล้ว
- [ ] `/health` ตอบ 200
- [ ] ไม่รัน demo data บน production (`demo.js` มี guard ปฏิเสธเมื่อ NODE_ENV=production แล้ว)
