# ═══════════════════════════════════════════════════════════════
#  restore.ps1 — กู้คืน/ทดสอบกู้คืนฐานข้อมูลจากไฟล์ backup (.dump)
#
#  โหมดปกติ (แนะนำให้ทำเดือนละครั้ง): กู้คืนลง DB ทดสอบชั่วคราว
#  แล้วนับจำนวน row เพื่อยืนยันว่า backup ใช้กู้ได้จริง — ไม่แตะ DB ใช้งานจริง
#    .\restore.ps1 -DumpFile D:\backups\itsm\itsm_db_20260611_020000.dump
#
#  เพิ่ม -Drop เพื่อลบ DB ทดสอบทิ้งหลังตรวจเสร็จ:
#    .\restore.ps1 -DumpFile <ไฟล์> -Drop
#
#  โหมดกู้คืนจริง (อันตราย! เขียนทับ DB ที่ใช้งานอยู่ — ต้องหยุดแอปก่อน):
#    .\restore.ps1 -DumpFile <ไฟล์> -InPlace
# ═══════════════════════════════════════════════════════════════

param(
  [Parameter(Mandatory = $true)][string]$DumpFile,
  [string]$TestDb = "itsm_restore_test",
  [switch]$Drop,
  [switch]$InPlace
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $DumpFile)) { Write-Error "ไม่พบไฟล์ backup: $DumpFile"; exit 1 }

# ── อ่าน DATABASE_URL จาก .env ──
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { Write-Error ".env not found at $envFile"; exit 1 }
$dbUrl = (Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL=" }) -replace "^DATABASE_URL=", "" -replace '"', ''
if ($dbUrl -match "postgresql://([^:]+):([^@]+)@([^:/]+):?(\d*)/([^?]+)") {
  $pgUser = $matches[1]; $pgPass = $matches[2]; $pgHost = $matches[3]
  $pgPort = if ($matches[4]) { $matches[4] } else { "5432" }; $pgDb = $matches[5]
} else { Write-Error "ไม่สามารถ parse DATABASE_URL"; exit 1 }

# ── ตั้งค่าตามโหมด ──
if ($InPlace) {
  Write-Host "⚠ โหมดกู้คืนจริง: จะเขียนทับฐานข้อมูล '$pgDb' ที่ใช้งานอยู่!" -ForegroundColor Red
  Write-Host "  ตรวจสอบว่าได้หยุดแอป (pm2 stop) แล้ว เพื่อไม่ให้มี connection ค้าง" -ForegroundColor Yellow
  $confirm = Read-Host "  พิมพ์ชื่อฐานข้อมูล '$pgDb' เพื่อยืนยัน"
  if ($confirm -ne $pgDb) { Write-Host "ยกเลิก" -ForegroundColor Gray; exit 0 }
  $targetDb = $pgDb
} else {
  # โหมดทดสอบจะ DROP DATABASE เป้าหมายทิ้ง — ต้องมั่นใจว่าไม่ใช่ DB จริงหรือ DB ระบบ
  $systemDbs = @("postgres", "template0", "template1")
  if ($TestDb -eq $pgDb) {
    Write-Error "หยุด: -TestDb '$TestDb' ตรงกับฐานข้อมูลใช้งานจริง โหมดทดสอบจะลบฐานข้อมูลนี้ทิ้ง`n      ถ้าต้องการกู้คืนทับของจริง ให้ใช้ -InPlace ซึ่งมีขั้นตอนยืนยัน"
    exit 1
  }
  if ($systemDbs -contains $TestDb.ToLower()) {
    Write-Error "หยุด: -TestDb '$TestDb' เป็นฐานข้อมูลระบบของ PostgreSQL"
    exit 1
  }
  if ($TestDb -notlike "itsm_restore*") {
    Write-Error "หยุด: ชื่อ DB ทดสอบต้องขึ้นต้นด้วย 'itsm_restore' (ได้รับ '$TestDb')`n      ข้อจำกัดนี้กันการเผลอลบฐานข้อมูลอื่นบนเซิร์ฟเวอร์เดียวกัน"
    exit 1
  }
  $targetDb = $TestDb
  Write-Host "=== ทดสอบกู้คืนลง DB ชั่วคราว '$targetDb' (ไม่แตะ '$pgDb' จริง) ===" -ForegroundColor Cyan
}

# ใช้ superuser เพื่อ create/drop DB ทดสอบ (และ grant ให้ owner)
$superPass = Read-Host "  ใส่รหัสผ่าน postgres (superuser)" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($superPass))

if (-not $InPlace) {
  Write-Host "`n[1/3] เตรียม DB ทดสอบ '$targetDb'..." -ForegroundColor Yellow
  # ตัด connection เดิม + สร้างใหม่สด
  & psql -U postgres -h $pgHost -p $pgPort -d postgres -c "DROP DATABASE IF EXISTS `"$targetDb`";" | Out-Null
  & psql -U postgres -h $pgHost -p $pgPort -d postgres -c "CREATE DATABASE `"$targetDb`" OWNER `"$pgUser`";" | Out-Null
  if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Write-Error "สร้าง DB ทดสอบไม่สำเร็จ"; exit 1 }
  Write-Host "  ✓ สร้าง '$targetDb' แล้ว" -ForegroundColor Green
}

Write-Host "`n[2/3] กู้คืนจาก $DumpFile ..." -ForegroundColor Yellow
$cleanFlag = if ($InPlace) { "--clean", "--if-exists" } else { @() }
& pg_restore -h $pgHost -p $pgPort -U postgres -d $targetDb --no-owner --role=$pgUser $cleanFlag $DumpFile
$restoreExit = $LASTEXITCODE
$allOk = $true
if ($restoreExit -ne 0) {
  # ไม่ถือว่าผ่านโดยอัตโนมัติ — รายงานไว้แล้วให้การนับ row ด้านล่างเป็นตัวยืนยันซ้ำ
  Write-Host "  ⚠ pg_restore คืน exit code $restoreExit — อาจมีบางส่วนกู้ไม่ครบ" -ForegroundColor Yellow
  $allOk = $false
} else {
  Write-Host "  ✓ กู้คืนเสร็จ (exit code 0)" -ForegroundColor Green
}

Write-Host "`n[3/3] ตรวจสอบจำนวน row (ยืนยัน backup ใช้ได้จริง)..." -ForegroundColor Yellow
# ตรวจให้ครบทุกตารางที่กู้มาได้ ไม่ใช่แค่ 3 ตารางหลัก
$expectedTables = @("users", "tickets", "assets")
foreach ($t in $expectedTables) {
  $cnt = (& psql -U postgres -h $pgHost -p $pgPort -d $targetDb -tAc "SELECT count(*) FROM `"$t`";" 2>$null)
  if ($LASTEXITCODE -eq 0 -and $cnt -match '^\d+$') {
    Write-Host ("  ✓ {0,-10} {1,6} แถว" -f $t, $cnt) -ForegroundColor Green
  } else {
    Write-Host "  ✗ อ่านตาราง '$t' ไม่ได้" -ForegroundColor Red; $allOk = $false
  }
}

# เทียบจำนวนตารางที่กู้ได้กับที่มีในไฟล์ dump — จับกรณีตารางอื่นหาย
$dumpTables = (& pg_restore --list $DumpFile 2>$null | Select-String -Pattern "TABLE DATA " | Measure-Object).Count
$liveTables = (& psql -U postgres -h $pgHost -p $pgPort -d $targetDb -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null)
if ($liveTables -match '^\d+$') {
  Write-Host ("  • ตารางใน dump {0} / กู้มาได้ {1}" -f $dumpTables, $liveTables) -ForegroundColor Gray
  if ([int]$liveTables -lt $dumpTables) {
    Write-Host "  ✗ จำนวนตารางที่กู้ได้น้อยกว่าในไฟล์ backup" -ForegroundColor Red; $allOk = $false
  }
} else {
  Write-Host "  ✗ นับตารางในฐานข้อมูลไม่ได้" -ForegroundColor Red; $allOk = $false
}

if ($Drop -and -not $InPlace) {
  & psql -U postgres -h $pgHost -p $pgPort -d postgres -c "DROP DATABASE IF EXISTS `"$targetDb`";" | Out-Null
  Write-Host "`n  • ลบ DB ทดสอบ '$targetDb' แล้ว" -ForegroundColor DarkGray
}
$env:PGPASSWORD = $null

if ($allOk) {
  Write-Host "`n✅ ทดสอบกู้คืนสำเร็จ — backup นี้ใช้กู้คืนได้จริง" -ForegroundColor Green
} else {
  Write-Host "`n❌ การกู้คืนมีปัญหา — ตรวจสอบ backup/สิทธิ์ DB" -ForegroundColor Red
  exit 1
}
