# ═══════════════════════════════════════════════════════════════
#  backup.ps1 — สำรองฐานข้อมูล PostgreSQL + ไฟล์แนบ (uploads)
#  ใช้ pg_dump (custom format) + หมุนเวียนเก็บย้อนหลัง N วัน
#
#  ตั้ง Scheduled Task ให้รันทุกวัน เช่น:
#    schtasks /Create /SC DAILY /ST 02:00 /TN "ITSM-Backup" ^
#      /TR "powershell -ExecutionPolicy Bypass -File D:\ai\it-service-desk\deploy\backup.ps1"
# ═══════════════════════════════════════════════════════════════

param(
  [string]$BackupDir = "C:\backups\itsm",
  [int]$KeepDays = 14
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

# ── อ่าน DATABASE_URL จาก .env ──
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { Write-Error ".env not found at $envFile"; exit 1 }
$dbUrl = (Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL=" }) -replace "^DATABASE_URL=", "" -replace '"', ''
if (-not $dbUrl) { Write-Error "DATABASE_URL not set in .env"; exit 1 }

# postgresql://user:pass@host:port/dbname?...
if ($dbUrl -match "postgresql://([^:]+):([^@]+)@([^:/]+):?(\d*)/([^?]+)") {
  $pgUser = $matches[1]; $pgPass = $matches[2]; $pgHost = $matches[3]
  $pgPort = if ($matches[4]) { $matches[4] } else { "5432" }; $pgDb = $matches[5]
} else { Write-Error "ไม่สามารถ parse DATABASE_URL"; exit 1 }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$dumpFile = Join-Path $BackupDir "itsm_db_$stamp.dump"

Write-Host "[1/3] สำรองฐานข้อมูล $pgDb -> $dumpFile" -ForegroundColor Yellow
$env:PGPASSWORD = $pgPass
& pg_dump -h $pgHost -p $pgPort -U $pgUser -F c -f $dumpFile $pgDb
if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump ล้มเหลว"; exit 1 }
Write-Host "  ✓ ขนาด: $([math]::Round((Get-Item $dumpFile).Length/1MB,2)) MB" -ForegroundColor Green

# ── ตรวจความสมบูรณ์ของ dump (อ่าน table of contents ได้ = ไฟล์ไม่เสีย) ──
& pg_restore --list $dumpFile | Out-Null
if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Write-Error "dump เสียหาย (pg_restore --list ล้มเหลว)"; exit 1 }
Write-Host "  ✓ ตรวจสอบ dump อ่านได้ปกติ" -ForegroundColor Green
$env:PGPASSWORD = $null

# ── สำรองไฟล์แนบ (uploads) ──
# อ่าน UPLOAD_DIR จาก .env ให้ตรงกับที่แอปใช้จริง (รองรับ absolute path)
$uploadCfg = (Get-Content $envFile | Where-Object { $_ -match "^UPLOAD_DIR=" }) -replace "^UPLOAD_DIR=", "" -replace '"', ''
if (-not $uploadCfg) { $uploadCfg = "./uploads" }
$uploads = if ([System.IO.Path]::IsPathRooted($uploadCfg)) { $uploadCfg } else { Join-Path $root ($uploadCfg -replace '^\./', '') }

if (Test-Path $uploads) {
  $fileCount = (Get-ChildItem $uploads -File -Recurse | Measure-Object).Count
  $zip = Join-Path $BackupDir "itsm_uploads_$stamp.zip"
  Write-Host "[2/3] สำรองไฟล์แนบจาก $uploads ($fileCount ไฟล์) -> $zip" -ForegroundColor Yellow
  if ($fileCount -eq 0) {
    Write-Host "  • ไม่มีไฟล์ให้สำรอง ข้าม" -ForegroundColor DarkGray
  } else {
    # ห้ามกลืน error แล้วรายงานว่าสำเร็จ — ต้องยืนยันว่าไฟล์ zip ถูกสร้างและครบจำนวน
    try {
      Compress-Archive -Path "$uploads\*" -DestinationPath $zip -Force -ErrorAction Stop
    } catch {
      $env:PGPASSWORD = $null
      Write-Error "สำรองไฟล์แนบล้มเหลว: $($_.Exception.Message)"
      exit 1
    }
    if (-not (Test-Path $zip)) { Write-Error "ไม่พบไฟล์ zip หลังสำรอง"; exit 1 }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
    $entryCount = ($archive.Entries | Where-Object { $_.Name -ne "" }).Count
    $archive.Dispose()
    if ($entryCount -lt $fileCount) {
      Write-Error "ไฟล์แนบสำรองไม่ครบ: ต้นทาง $fileCount ไฟล์ แต่ใน zip มี $entryCount"
      exit 1
    }
    Write-Host "  ✓ เสร็จ ($entryCount ไฟล์ใน zip)" -ForegroundColor Green
  }
} else { Write-Host "[2/3] ข้าม uploads (ไม่พบโฟลเดอร์ $uploads)" -ForegroundColor DarkGray }

# ── หมุนเวียน: ลบ backup เก่ากว่า KeepDays วัน ──
Write-Host "[3/3] ลบ backup เก่ากว่า $KeepDays วัน" -ForegroundColor Yellow
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem $BackupDir -Filter "itsm_*" | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
  Remove-Item $_.FullName -Force; Write-Host "  - ลบ $($_.Name)" -ForegroundColor DarkGray
}

Write-Host "`n✅ Backup เสร็จสมบูรณ์: $stamp" -ForegroundColor Green
Write-Host "   กู้คืน DB:  pg_restore -h $pgHost -U $pgUser -d $pgDb --clean `"$dumpFile`"" -ForegroundColor Cyan
