---
name: install-it-service-desk
description: ติดตั้ง/deploy ระบบ IT Service Desk (ITSM) บน Windows Server (IIS + Node.js + PostgreSQL + PM2). ใช้เมื่อผู้ใช้ต้องการติดตั้งโปรแกรมนี้บนเครื่องใหม่ ตั้งค่า production go-live ตั้ง HTTPS ตั้ง backup หรือ deploy แอป ครอบคลุมลำดับการรันสคริปต์ deploy/*.ps1 การตรวจสอบ และการแก้ปัญหาที่พบบ่อย
---

# ติดตั้ง IT Service Desk (ITSM)

ระบบ Node.js + Express + Prisma + PostgreSQL 16 + vanilla JS SPA รันบน Windows Server 2022
สถาปัตยกรรม: **IIS (รับ HTTPS ภายนอก) → reverse proxy → Node/PM2 (ฟัง 127.0.0.1:3200)**

## ก่อนเริ่ม — ถามผู้ใช้ให้ครบ

ก่อนรันต้องได้ข้อมูลเหล่านี้ (ถามถ้ายังไม่รู้):
1. **โดเมนจริง** (เช่น `servicedesk.company.com`) — สำหรับ HTTPS/CORS
2. **รหัสผ่าน DB ใหม่** (≥12 ตัว) — ห้ามใช้ค่า dev
3. **รหัสผ่าน admin ใหม่** (≥8 ตัว มีพิมพ์ใหญ่/เล็ก/ตัวเลข)
4. **ใบรับรอง SSL** ติดตั้งใน `Cert:\LocalMachine\My` แล้วหรือยัง (หา thumbprint ด้วย `Get-ChildItem Cert:\LocalMachine\My | Format-List Subject, Thumbprint`)

## Prerequisites (ติดตั้งด้วยมือก่อน)

- **Node.js 20 LTS** — https://nodejs.org
- **PostgreSQL 16** — จดรหัส superuser `postgres`
- **IIS** + **URL Rewrite 2.1** + **Application Request Routing (ARR) 3.0** (ดาวน์โหลดจาก iis.net)
- คัดลอกโค้ดทั้งหมดไปไว้ที่ `C:\inetpub\itsd` (หรือปรับ `$AppDir` ใน `install.ps1`)

## ลำดับการติดตั้ง (รัน PowerShell แบบ Administrator)

รันสคริปต์ตามลำดับนี้ — ทุกตัวอยู่ในโฟลเดอร์ `deploy\` **ทั้งหมดเป็น UTF-8 with BOM**

### 1) ติดตั้งแอป + DB + seed + บังคับตั้งรหัส
```powershell
cd C:\inetpub\itsd
.\deploy\install.ps1
```
สคริปต์จะ **บังคับ** ตั้งค่าความปลอดภัย (กันค่า default หลุดขึ้น prod):
- ถามรหัส DB ใหม่ (≥12 ตัว) ถ้ายังเป็น placeholder
- ถาม APP_URL โดเมนจริง (ต้องขึ้น `http(s)://`)
- สุ่ม `JWT_SECRET` 96 hex + ตั้ง `NODE_ENV=production`
- รัน `prisma migrate deploy` (ไม่ใช่ db push) + `npm run seed`
- **บังคับเปลี่ยนรหัส admin** จากค่า seed (loop จนกว่าจะผ่าน policy)
- ตั้ง PM2 + startup เมื่อ reboot

### 2) ตั้ง HTTPS / IIS reverse proxy
```powershell
.\deploy\setup-iis.ps1 -Hostname servicedesk.company.com -CertThumbprint <thumbprint> -NodePort 3200
```
เช็ค URL Rewrite+ARR → เปิด ARR proxy → สร้างไซต์ → วาง `web.config` (ปรับ port ให้) → ผูก cert กับ 443 (SNI) + redirect http→https + HSTS
(ถ้าไม่ใส่ `-CertThumbprint` จะข้ามการผูก SSL แล้วบอกวิธีผูกเอง)

### 3) ตั้ง backup อัตโนมัติ + ทดสอบกู้คืน
```powershell
.\deploy\setup-backup-task.ps1                    # Scheduled Task รายวันตี 2 (SYSTEM)
Start-ScheduledTask -TaskName ITSM-Backup         # ทดสอบ backup ทันที
.\deploy\restore.ps1 -DumpFile D:\backups\itsm\itsm_db_<stamp>.dump -Drop   # ทดสอบกู้คืนลง DB ชั่วคราว
```
`backup.ps1` = pg_dump + zip uploads + verify dump + หมุนเวียน 14 วัน
`restore.ps1 -InPlace` = กู้คืนจริง (อันตราย เขียนทับ — หยุด pm2 ก่อน, มี confirm)

## ตรวจสอบหลังติดตั้ง

```powershell
pm2 ls                                                          # แอปทำงาน
(Invoke-WebRequest http://127.0.0.1:3200/health).Content        # {"ok":true,"db":"up",...}
Invoke-WebRequest https://servicedesk.company.com/health        # ผ่าน IIS ได้ 200
```
แล้วลอง login ด้วย `admin@company.local` + รหัสที่เพิ่งตั้ง

## Checklist go-live (ดูเต็มใน deploy/GO-LIVE.md)

- [ ] `NODE_ENV=production`, `JWT_SECRET` สุ่มใหม่, รหัส DB เปลี่ยนแล้ว
- [ ] เปลี่ยนรหัส admin จาก seed แล้ว
- [ ] HTTPS + redirect http→https + ใบรับรองไม่หมดอายุ
- [ ] `prisma migrate deploy` สำเร็จ (ห้าม db push บน prod)
- [ ] Scheduled backup รันได้ + ทดสอบ restore แล้ว
- [ ] PM2 startup + logrotate (`pm2 install pm2-logrotate`)
- [ ] `/health` ตอบ 200
- [ ] **ไม่รัน `deploy/demo.js` บน prod** (มี guard ปฏิเสธเมื่อ NODE_ENV=production แล้ว)

## บริการเสริม (เปิดถ้าต้องใช้ ตั้งใน .env)

- **อีเมลแจ้งเตือน:** `EMAIL_ENABLED=true` + `SMTP_*`/`SMTP_FROM`
- **Email-to-Ticket (IMAP):** `IMAP_ENABLED=true` + `IMAP_*` (ต้องมี imapflow+mailparser — ติดตั้งแล้ว)
- **Telegram:** `TELEGRAM_ENABLED=true` + `TELEGRAM_BOT_TOKEN` (จาก @BotFather)
- **LDAP/AD:** `LDAP_ENABLED=true` + ต้อง `npm i ldapjs`

## ข้อควรระวัง / แก้ปัญหาที่พบบ่อย

- **PowerShell parse error / ภาษาไทยพัง:** ไฟล์ `.ps1` ต้องเป็น **UTF-8 with BOM** (PowerShell 5.1 อ่าน UTF-8 ไม่มี BOM เป็น ANSI codepage 874 → พัง). แก้: `[System.IO.File]::WriteAllText($f, $content, [System.Text.UTF8Encoding]::new($true))`
- **`prisma migrate dev` P3014 (สร้าง shadow DB ไม่ได้):** dev user ไม่มีสิทธิ์ CREATEDB. บน production ใช้ `migrate deploy` เท่านั้น (install.ps1 ทำให้แล้ว). ถ้าต้องแก้ schema → ทำ migration ใน dev แล้ว commit โฟลเดอร์ `prisma/migrations/` มา
- **prisma generate EPERM:** Prisma DLL ถูก lock เพราะแอปรันอยู่ — `pm2 stop` ก่อน generate
- **migrate deploy ล้มเหลว:** ตรวจ `DATABASE_URL` ใน `.env` + สิทธิ์ DB user
- **เข้า https ไม่ได้:** ตรวจ ARR proxy เปิด, แอป Node ทำงาน (`pm2 ls`), firewall เปิด 443, cert ผูกกับไซต์ถูก hostname
- **รันแบบ instance เดียวเท่านั้น** (`pm2 ... -i 1`): SLA job + lockout ใช้สถานะร่วมใน DB; ถ้าจะ scale หลาย instance ต้องแยก scheduled job ออกเป็น service

## ไฟล์สำคัญใน deploy/

| ไฟล์ | หน้าที่ |
|------|---------|
| `install.ps1` | ติดตั้งหลัก (DB+migrate+seed+PM2+บังคับตั้งรหัส) |
| `set-admin-password.js` | helper เปลี่ยนรหัส admin (install.ps1 เรียก) |
| `setup-iis.ps1` | ตั้ง IIS reverse proxy + HTTPS |
| `web.config` | กฎ IIS (proxy + redirect https + HSTS + upload limit) |
| `backup.ps1` | สำรอง DB + uploads + verify + rotate |
| `setup-backup-task.ps1` | ลง Scheduled Task backup รายวัน |
| `restore.ps1` | กู้คืน/ทดสอบกู้คืน |
| `GO-LIVE.md` | คู่มือ go-live ฉบับเต็ม |
| `demo.js` | ข้อมูลตัวอย่าง (มี guard ห้ามรันบน prod) |
