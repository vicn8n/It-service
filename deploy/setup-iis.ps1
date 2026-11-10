# ═══════════════════════════════════════════════════════════════
#  setup-iis.ps1 — ตั้งค่า IIS เป็น HTTPS reverse proxy ให้แอป Node
#  รันด้วยสิทธิ์ Administrator
#
#  ต้องติดตั้งส่วนเสริมก่อน (ดาวน์โหลดจาก Microsoft):
#    - URL Rewrite 2.1
#    - Application Request Routing (ARR) 3.0
#
#  ตัวอย่าง:
#    .\setup-iis.ps1 -Hostname servicedesk.company.com `
#       -CertThumbprint AB12CD34... -NodePort 3200
#
#  หา thumbprint ของใบรับรองที่ติดตั้งไว้ใน LocalMachine\My:
#    Get-ChildItem Cert:\LocalMachine\My | Format-List Subject, Thumbprint
# ═══════════════════════════════════════════════════════════════
#Requires -RunAsAdministrator

param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [string]$CertThumbprint,
  [int]$NodePort = 3200,
  [string]$SiteName = "ITServiceDesk",
  [string]$SitePath = "C:\inetpub\itsd-site"
)

$ErrorActionPreference = "Stop"
Import-Module WebAdministration -ErrorAction Stop

Write-Host "=== ตั้งค่า IIS reverse proxy สำหรับ $Hostname → 127.0.0.1:$NodePort ===" -ForegroundColor Cyan

# 1) ตรวจ URL Rewrite + ARR
Write-Host "`n[1/5] ตรวจส่วนเสริม URL Rewrite + ARR..." -ForegroundColor Yellow
$rewriteOk = Test-Path "$env:windir\System32\inetsrv\rewrite.dll"
$arrKey = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing" -ErrorAction SilentlyContinue
if (-not $rewriteOk) { Write-Host "  ✗ ไม่พบ URL Rewrite — ติดตั้งก่อน: https://www.iis.net/downloads/microsoft/url-rewrite" -ForegroundColor Red; exit 1 }
if (-not $arrKey)    { Write-Host "  ✗ ไม่พบ ARR — ติดตั้งก่อน: https://www.iis.net/downloads/microsoft/application-request-routing" -ForegroundColor Red; exit 1 }
Write-Host "  ✓ พบ URL Rewrite + ARR" -ForegroundColor Green

# 2) เปิด ARR proxy (ระดับเซิร์ฟเวอร์)
Write-Host "`n[2/5] เปิด ARR proxy..." -ForegroundColor Yellow
Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" `
  -Filter "system.webServer/proxy" -Name "enabled" -Value "True"
Write-Host "  ✓ ARR proxy เปิดแล้ว" -ForegroundColor Green

# web.config ตั้ง HTTP_X_FORWARDED_* ผ่าน <serverVariables> ซึ่ง IIS จะปฏิเสธ (500)
# ถ้าไม่ได้ whitelist ชื่อตัวแปรไว้ที่ applicationHost.config ก่อน
Write-Host "  • whitelist server variables ที่ rewrite rule ใช้..." -ForegroundColor Yellow
$allowedVars = Get-WebConfiguration -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/rewrite/allowedServerVariables"
foreach ($v in @("HTTP_X_FORWARDED_PROTO", "HTTP_X_FORWARDED_HOST")) {
  $exists = $allowedVars.Collection | Where-Object { $_.name -eq $v }
  if (-not $exists) {
    Add-WebConfiguration -PSPath "MACHINE/WEBROOT/APPHOST" `
      -Filter "system.webServer/rewrite/allowedServerVariables" -Value @{ name = $v }
    Write-Host "    + $v" -ForegroundColor Green
  } else {
    Write-Host "    = $v (มีอยู่แล้ว)" -ForegroundColor DarkGray
  }
}

# 3) สร้างโฟลเดอร์ไซต์ + วาง web.config
Write-Host "`n[3/5] เตรียมโฟลเดอร์ไซต์ + web.config..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $SitePath | Out-Null
$srcWebConfig = Join-Path $PSScriptRoot "web.config"
if (-not (Test-Path $srcWebConfig)) { Write-Error "ไม่พบ deploy\web.config"; exit 1 }
# แทนที่ port ในไฟล์ให้ตรงกับ -NodePort (ดีฟอลต์ในไฟล์คือ 3200)
(Get-Content $srcWebConfig -Raw) -replace "127\.0\.0\.1:\d+", "127.0.0.1:$NodePort" |
  Set-Content (Join-Path $SitePath "web.config") -Encoding UTF8
Write-Host "  ✓ วาง web.config (proxy → 127.0.0.1:$NodePort)" -ForegroundColor Green

# 4) สร้าง/อัปเดต Application Pool + Site
Write-Host "`n[4/5] สร้างเว็บไซต์ IIS '$SiteName'..." -ForegroundColor Yellow
$poolName = "$SiteName-pool"
if (-not (Test-Path "IIS:\AppPools\$poolName")) { New-WebAppPool -Name $poolName | Out-Null }
# ไม่ต้องโหลด .NET (เป็น proxy อย่างเดียว)
Set-ItemProperty "IIS:\AppPools\$poolName" -Name "managedRuntimeVersion" -Value ""

if (Test-Path "IIS:\Sites\$SiteName") {
  Write-Host "  • ไซต์มีอยู่แล้ว — ข้ามการสร้าง" -ForegroundColor DarkGray
} else {
  New-Website -Name $SiteName -PhysicalPath $SitePath -ApplicationPool $poolName `
    -HostHeader $Hostname -Port 80 | Out-Null
  Write-Host "  ✓ สร้างไซต์ (HTTP:80 host=$Hostname)" -ForegroundColor Green
}

# 5) ผูก HTTPS (443) + ใบรับรอง
Write-Host "`n[5/5] ผูก HTTPS (443)..." -ForegroundColor Yellow
if (-not $CertThumbprint) {
  Write-Host "  ⚠ ไม่ได้ระบุ -CertThumbprint — ข้ามการผูก SSL" -ForegroundColor Yellow
  Write-Host "    ผูกเองภายหลัง: New-WebBinding -Name '$SiteName' -Protocol https -Port 443 -HostHeader '$Hostname' -SslFlags 1" -ForegroundColor Gray
  Write-Host "    แล้ว: (Get-Item Cert:\LocalMachine\My\<thumbprint>) | New-Item IIS:\SslBindings\..." -ForegroundColor Gray
} else {
  $cert = Get-Item "Cert:\LocalMachine\My\$CertThumbprint" -ErrorAction SilentlyContinue
  if (-not $cert) { Write-Error "ไม่พบใบรับรอง thumbprint $CertThumbprint ใน LocalMachine\My"; exit 1 }
  $existing = Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $Hostname -SslFlags 1
  }
  # ผูก cert กับ SNI binding
  $binding = Get-WebBinding -Name $SiteName -Protocol https
  $binding.AddSslCertificate($cert.GetCertHashString(), "My")
  Write-Host "  ✓ ผูกใบรับรอง '$($cert.Subject)' กับ HTTPS:443" -ForegroundColor Green
}

Write-Host "`n=== เสร็จสิ้น ===" -ForegroundColor Cyan
Write-Host "ตรวจสอบ: https://$Hostname/health  (ควรได้ 200 + db:up)" -ForegroundColor White
Write-Host "ถ้าเข้าไม่ได้: ตรวจว่าแอป Node ทำงาน (pm2 ls) + firewall เปิด 443" -ForegroundColor White
