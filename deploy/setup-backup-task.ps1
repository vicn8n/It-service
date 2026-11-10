# ═══════════════════════════════════════════════════════════════
#  setup-backup-task.ps1 — ลงทะเบียน Scheduled Task สำรองข้อมูลรายวัน
#  รันด้วยสิทธิ์ Administrator
#    .\setup-backup-task.ps1                 # ดีฟอลต์ ตี 2 ทุกวัน
#    .\setup-backup-task.ps1 -Time "01:30"   # กำหนดเวลาเอง
# ═══════════════════════════════════════════════════════════════
#Requires -RunAsAdministrator

param(
  [string]$Time = "02:00",
  [string]$TaskName = "ITSM-Backup"
)

$ErrorActionPreference = "Stop"
$backupScript = Join-Path $PSScriptRoot "backup.ps1"
if (-not (Test-Path $backupScript)) { Write-Error "ไม่พบ backup.ps1 ที่ $backupScript"; exit 1 }

Write-Host "=== ตั้ง Scheduled Task '$TaskName' (รันทุกวัน $Time) ===" -ForegroundColor Cyan

$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# รันด้วยบัญชี SYSTEM สิทธิ์สูงสุด แม้ไม่มีใคร login
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# ลบของเดิมถ้ามี แล้วลงใหม่
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "  • ลบ task เดิมก่อนลงใหม่" -ForegroundColor DarkGray
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings `
  -Description "สำรองฐานข้อมูล IT Service Desk + ไฟล์แนบ (pg_dump + zip + rotate)" | Out-Null

Write-Host "  ✓ ลงทะเบียนแล้ว" -ForegroundColor Green
Write-Host "`nทดสอบรันทันที:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Cyan
Write-Host "ดูสถานะ:        Get-ScheduledTaskInfo -TaskName '$TaskName'" -ForegroundColor Cyan
Write-Host "`n⚠ อย่าลืม: ทดสอบกู้คืนจริงด้วย restore.ps1 อย่างน้อยเดือนละครั้ง" -ForegroundColor Yellow
