# ═══════════════════════════════════════════════════════════════
#  backup.ps1 — สำรองฐานข้อมูล PostgreSQL + ไฟล์แนบ (uploads)
#  ใช้ pg_dump (custom format) แล้วหมุนเวียน:
#    - รายวัน   เก็บ KeepDays วัน         ($BackupDir\itsm_*)
#    - รายเดือน เก็บชุดแรกของเดือน KeepMonths เดือน ($BackupDir\monthly\)
#    - นอกเครื่อง (ถ้าตั้ง BACKUP_OFFSITE_DIR ใน .env) ใช้กติกาเดียวกัน
#  exit 0 = สำเร็จ, 1 = backup ล้มเหลว, 2 = backup ในเครื่องสำเร็จแต่คัดลอกนอกเครื่องไม่ได้
#
#  ตั้ง Scheduled Task ให้รันทุกวัน เช่น:
#    schtasks /Create /SC DAILY /ST 02:00 /TN "ITSM-Backup" ^
#      /TR "powershell -ExecutionPolicy Bypass -File D:\ai\it-service-desk\deploy\backup.ps1"
# ═══════════════════════════════════════════════════════════════

param(
  [string]$BackupDir = "C:\backups\itsm",
  [int]$KeepDays = 14,
  [int]$KeepMonths = 12,
  [string]$OffsiteDir = ""   # ว่าง = อ่าน BACKUP_OFFSITE_DIR จาก .env
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

Write-Host "[1/4] สำรองฐานข้อมูล $pgDb -> $dumpFile" -ForegroundColor Yellow
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
  Write-Host "[2/4] สำรองไฟล์แนบจาก $uploads ($fileCount ไฟล์) -> $zip" -ForegroundColor Yellow
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
} else { Write-Host "[2/4] ข้าม uploads (ไม่พบโฟลเดอร์ $uploads)" -ForegroundColor DarkGray }

# ── รายเดือน: เก็บชุดแรกของแต่ละเดือนไว้ใน monthly\ (ย้อนหลังได้ KeepMonths เดือน) ──
# ทำก่อนลบรายวัน เพื่อให้เดือนที่ยังไม่มีสำเนาได้ไฟล์ที่เก่าที่สุดของเดือนนั้นไปเก็บ
function Get-BackupMonth($name) { if ($name -match "^itsm_(db|uploads)_(\d{6})\d{2}_") { $matches[2] } }

function Update-Monthly($dailyDir, $monthlyDir, $keepMonths) {
  New-Item -ItemType Directory -Force -Path $monthlyDir | Out-Null
  $have = @(Get-ChildItem $monthlyDir -Filter "itsm_*" | ForEach-Object { Get-BackupMonth $_.Name } | Sort-Object -Unique)
  Get-ChildItem $dailyDir -Filter "itsm_*" -File |
    Group-Object { Get-BackupMonth $_.Name } |
    Where-Object { $_.Name -and ($have -notcontains $_.Name) } |
    ForEach-Object {
      # ชุดแรกของเดือน = รอบที่เก่าที่สุดที่มีไฟล์ฐานข้อมูล (db กับ uploads รอบเดียวกันใช้ stamp เดียวกัน)
      # ไม่มี db เลยในเดือนนั้นค่อยใช้ uploads ที่เก่าที่สุด
      $pool = @($_.Group | Where-Object { $_.Name -like "itsm_db_*" })
      if (-not $pool.Count) { $pool = @($_.Group) }
      $firstStamp = ($pool | ForEach-Object { ($_.BaseName -split "_", 3)[2] } | Sort-Object | Select-Object -First 1)
      $_.Group | Where-Object { $_.BaseName.EndsWith($firstStamp) } | ForEach-Object {
        Copy-Item $_.FullName $monthlyDir -Force
        Write-Host "  + monthly: $($_.Name)" -ForegroundColor DarkGray
      }
    }
  # เก็บไว้ KeepMonths เดือนล่าสุด
  $months = @(Get-ChildItem $monthlyDir -Filter "itsm_*" | ForEach-Object { Get-BackupMonth $_.Name } | Sort-Object -Unique -Descending)
  $drop = $months | Select-Object -Skip $keepMonths
  Get-ChildItem $monthlyDir -Filter "itsm_*" | Where-Object { $drop -contains (Get-BackupMonth $_.Name) } | ForEach-Object {
    Remove-Item $_.FullName -Force; Write-Host "  - ลบ monthly $($_.Name)" -ForegroundColor DarkGray
  }
}

function Remove-OldDaily($dir, $keepDays) {
  $cutoff = (Get-Date).AddDays(-$keepDays)
  Get-ChildItem $dir -Filter "itsm_*" -File | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Remove-Item $_.FullName -Force; Write-Host "  - ลบ $($_.Name)" -ForegroundColor DarkGray
  }
}

Write-Host "[3/4] เก็บรายเดือน ($KeepMonths เดือน) + ลบรายวันเก่ากว่า $KeepDays วัน" -ForegroundColor Yellow
Update-Monthly $BackupDir (Join-Path $BackupDir "monthly") $KeepMonths
Remove-OldDaily $BackupDir $KeepDays

# ── สำเนานอกเครื่อง (NAS / share) — ตั้ง BACKUP_OFFSITE_DIR ใน .env เช่น \\nas01\backup\itsm ──
$offsiteFailed = $false
if (-not $OffsiteDir) {
  $OffsiteDir = (Get-Content $envFile | Where-Object { $_ -match "^BACKUP_OFFSITE_DIR=" }) -replace "^BACKUP_OFFSITE_DIR=", "" -replace '"', ''
}
if ($OffsiteDir) {
  Write-Host "[4/4] คัดลอกไปนอกเครื่อง: $OffsiteDir" -ForegroundColor Yellow
  try {
    New-Item -ItemType Directory -Force -Path $OffsiteDir -ErrorAction Stop | Out-Null
    # คัดลอกเฉพาะไฟล์รายวันที่ปลายทางยังไม่มี (ครั้งแรกจะได้ย้อนหลังครบ KeepDays)
    Get-ChildItem $BackupDir -Filter "itsm_*" -File | ForEach-Object {
      $dest = Join-Path $OffsiteDir $_.Name
      if (-not (Test-Path $dest) -or (Get-Item $dest).Length -ne $_.Length) {
        Copy-Item $_.FullName $dest -Force -ErrorAction Stop
        Write-Host "  → $($_.Name)" -ForegroundColor DarkGray
      }
    }
    Update-Monthly $OffsiteDir (Join-Path $OffsiteDir "monthly") $KeepMonths
    Remove-OldDaily $OffsiteDir $KeepDays
    Write-Host "  ✓ สำเนานอกเครื่องเรียบร้อย" -ForegroundColor Green
  } catch {
    # backup ในเครื่องสำเร็จแล้ว ไม่ลบทิ้ง — แต่ต้องให้ Task Scheduler เห็นว่ามีปัญหา (exit 2)
    $offsiteFailed = $true
    Write-Warning "คัดลอกไปนอกเครื่องไม่สำเร็จ: $($_.Exception.Message)"
  }
} else {
  Write-Host "[4/4] ข้ามสำเนานอกเครื่อง (ยังไม่ได้ตั้ง BACKUP_OFFSITE_DIR ใน .env)" -ForegroundColor DarkGray
}

Write-Host "`n✅ Backup เสร็จสมบูรณ์: $stamp" -ForegroundColor Green
Write-Host "   กู้คืน DB:  pg_restore -h $pgHost -U $pgUser -d $pgDb --clean `"$dumpFile`"" -ForegroundColor Cyan
if ($offsiteFailed) { exit 2 }
