<#
.SYNOPSIS
  ติดตั้ง IT Service Desk บน Windows Server 2022 (IIS + Node.js + PostgreSQL + PM2)
.DESCRIPTION
  รันด้วยสิทธิ์ Administrator. สคริปต์นี้ช่วย:
    1. ตรวจสอบ prerequisites (Node.js, PostgreSQL)
    2. ติดตั้ง dependencies (npm install + pm2)
    3. สร้าง database + รัน migration + seed
    4. ตั้งค่า PM2 ให้ start อัตโนมัติเมื่อ reboot
  ส่วน IIS (URL Rewrite + ARR + SSL) ดูขั้นตอนใน README.md
.NOTES
  ปรับค่าตัวแปรด้านล่างก่อนรัน
#>

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

# ─────────── ปรับค่าตรงนี้ ───────────
$AppDir       = "C:\it-service-desk"       # โฟลเดอร์ที่ deploy โค้ด
$DbName       = "it_service_desk"
$DbUser       = "itsd_user"
$DbPassword   = "" # เว้นว่างไว้เพื่อให้สคริปต์ถามโดยไม่เก็บ secret ใน source code
$PgBin        = "C:\Program Files\PostgreSQL\16\bin"
# ────────────────────────────────────

Write-Host "=== IT Service Desk — Installer ===" -ForegroundColor Cyan

# ─── บังคับตั้งค่าความปลอดภัยก่อนติดตั้ง (กันค่า default หลุดขึ้น production) ───
function Read-PlainSecret($prompt) {
  $sec = Read-Host $prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

if ([string]::IsNullOrWhiteSpace($DbPassword) -or $DbPassword -eq "CHANGE_ME_STRONG_PASSWORD") {
  Write-Host "`n[ตั้งค่า] ยังไม่ได้ตั้งรหัสผ่าน DB ที่ปลอดภัย" -ForegroundColor Yellow
  do { $DbPassword = Read-PlainSecret "  ตั้งรหัสผ่าน DB ใหม่ (อย่างน้อย 12 ตัว)" } while ($DbPassword.Length -lt 12)
}

if ($DbName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $DbUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
  throw "DbName และ DbUser ใช้ได้เฉพาะตัวอักษร ตัวเลข และ underscore โดยห้ามขึ้นต้นด้วยตัวเลข"
}

# โดเมนจริงสำหรับ HTTPS/CORS (เช่น https://servicedesk.company.com)
do { $AppUrl = Read-Host "  ใส่ APP_URL โดเมนจริง (เช่น https://servicedesk.company.com)" } while ($AppUrl -notmatch '^https?://')
if ($AppUrl -notmatch '^https://') {
  Write-Host "  ⚠ APP_URL ไม่ใช่ https — แนะนำให้ใช้ https บน production" -ForegroundColor Yellow
}

# 1) ตรวจ Node.js
Write-Host "`n[1/6] ตรวจสอบ Node.js..." -ForegroundColor Yellow
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Write-Host "  ✗ ไม่พบ Node.js — ติดตั้ง Node.js 20 LTS จาก https://nodejs.org ก่อน" -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ Node.js $(node --version)" -ForegroundColor Green

# 2) ตรวจ PostgreSQL
Write-Host "`n[2/6] ตรวจสอบ PostgreSQL..." -ForegroundColor Yellow
if (-not (Test-Path $PgBin)) {
  Write-Host "  ✗ ไม่พบ PostgreSQL ที่ $PgBin — แก้ตัวแปร `$PgBin หรือติดตั้ง PostgreSQL 16 ก่อน" -ForegroundColor Red
  exit 1
}
$env:Path += ";$PgBin"
Write-Host "  ✓ พบ PostgreSQL" -ForegroundColor Green

# 3) สร้าง database + user
Write-Host "`n[3/6] สร้าง database '$DbName'..." -ForegroundColor Yellow
# ใช้ -AsSecureString เพื่อไม่ให้รหัสผ่าน superuser ปรากฏบนหน้าจอ
$env:PGPASSWORD = Read-PlainSecret "  ใส่รหัสผ่าน postgres (superuser)"
$dbPasswordSql = $DbPassword.Replace("'", "''")
$createSql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE $DbUser LOGIN PASSWORD '$dbPasswordSql';
  ELSE
    ALTER ROLE $DbUser LOGIN PASSWORD '$dbPasswordSql';
  END IF;
END `$`$;
"@
$createSql | & psql -U postgres -h localhost -d postgres
if ($LASTEXITCODE -ne 0) { throw "สร้างหรืออัปเดต PostgreSQL role ไม่สำเร็จ" }

$dbExists = (& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'").Trim()
if ($LASTEXITCODE -ne 0) { throw "ตรวจสอบ PostgreSQL database ไม่สำเร็จ" }
if ($dbExists -ne "1") {
  & psql -U postgres -h localhost -d postgres -c "CREATE DATABASE $DbName OWNER $DbUser;"
  if ($LASTEXITCODE -ne 0) { throw "สร้าง PostgreSQL database ไม่สำเร็จ" }
}
& psql -U postgres -h localhost -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser;"
if ($LASTEXITCODE -ne 0) { throw "กำหนดสิทธิ์ PostgreSQL database ไม่สำเร็จ" }
$env:PGPASSWORD = $null
Write-Host "  ✓ Database พร้อม" -ForegroundColor Green

# 4) สร้าง .env หากยังไม่มี
Write-Host "`n[4/6] ตั้งค่า .env..." -ForegroundColor Yellow
Set-Location $AppDir
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  $jwt = -join ((1..96) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
  $dbPasswordUrl = [Uri]::EscapeDataString($DbPassword)
  $envContent = Get-Content ".env"
  $envContent = $envContent -replace 'DATABASE_URL=.*', "DATABASE_URL=`"postgresql://$DbUser`:$dbPasswordUrl@localhost:5432/$DbName`?schema=public`""
  $envContent = $envContent -replace 'JWT_SECRET=.*', "JWT_SECRET=`"$jwt`""
  $envContent = $envContent -replace 'NODE_ENV=.*', "NODE_ENV=production"
  $envContent = $envContent -replace 'APP_URL=.*', "APP_URL=`"$AppUrl`""
  $envContent | Set-Content ".env" -Encoding utf8
  Write-Host "  ✓ สร้าง .env (NODE_ENV=production, APP_URL=$AppUrl — ตั้ง SMTP/IMAP/Telegram เพิ่มถ้าใช้)" -ForegroundColor Green
} elseif ((Get-Content ".env" -Raw) -match 'JWT_SECRET="?dev_only') {
  Write-Host "  ⚠ .env มีอยู่แล้วแต่ยังใช้ JWT_SECRET ของ dev — ต้องเปลี่ยนก่อนขึ้น production!" -ForegroundColor Red
} else {
  Write-Host "  • .env มีอยู่แล้ว — ข้าม" -ForegroundColor Gray
}

# 5) ติดตั้ง dependencies + migrate + seed
Write-Host "`n[5/6] ติดตั้ง dependencies และ migrate..." -ForegroundColor Yellow
& npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { & npm install --omit=dev }
& npx prisma generate
# ใช้ migration history (prisma/migrations) — ปลอดภัยกว่า db push บน production
# สร้าง schema/อัปเดตตาม migration ที่ commit ไว้ (ไม่ทำลายข้อมูล)
& npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host "  ! migrate deploy ล้มเหลว — ตรวจ DATABASE_URL / สิทธิ์ DB" -ForegroundColor Red
  exit 1
}
& npm run seed
Write-Host "  ✓ ฐานข้อมูลพร้อมใช้งาน" -ForegroundColor Green

# 5.1) บังคับเปลี่ยนรหัส admin จากค่า seed (กันรหัสที่รู้กันทั่ว)
Write-Host "`n[5.1] ตั้งรหัสผ่านผู้ดูแลระบบ (admin@company.local)" -ForegroundColor Yellow
Write-Host "  นโยบาย: อย่างน้อย 8 ตัว มีพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข" -ForegroundColor Gray
do {
  $adminPw = Read-PlainSecret "  ตั้งรหัสผ่าน admin ใหม่"
  $env:NEW_ADMIN_PASS = $adminPw
  & node deploy/set-admin-password.js
  $ok = ($LASTEXITCODE -eq 0)
  if (-not $ok) { Write-Host "  ลองใหม่อีกครั้ง" -ForegroundColor Red }
} while (-not $ok)
$env:NEW_ADMIN_PASS = $null
Write-Host "  ✓ เปลี่ยนรหัส admin แล้ว" -ForegroundColor Green

# 6) ตั้งค่า PM2
Write-Host "`n[6/6] ตั้งค่า PM2..." -ForegroundColor Yellow
& npm install -g pm2 pm2-windows-startup
& pm2 start ecosystem.config.js --env production
& pm2 save
& pm2-startup install   # ให้ PM2 resurrect เมื่อ Windows reboot
Write-Host "  ✓ PM2 ทำงานแล้ว" -ForegroundColor Green

Write-Host "`n=== ติดตั้งเสร็จสิ้น ===" -ForegroundColor Cyan
Write-Host "Backend ทำงานที่ http://127.0.0.1:3200" -ForegroundColor White
Write-Host "ขั้นต่อไป: ตั้งค่า IIS reverse proxy + SSL ตาม README.md" -ForegroundColor White
Write-Host "ทดสอบ: curl http://127.0.0.1:3200/api/health" -ForegroundColor White
