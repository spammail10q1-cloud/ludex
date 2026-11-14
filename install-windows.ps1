# Ludex installer / updater for Windows.
# Run in PowerShell:
#   irm https://raw.githubusercontent.com/spammail10q1-cloud/ludex/main/install-windows.ps1 | iex
param(
  [switch]$Update,
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"
$Repo = "spammail10q1-cloud/ludex"
$InstallDir = Join-Path $env:LOCALAPPDATA "Ludex"
$ExePath = Join-Path $InstallDir "Ludex.exe"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$DesktopDir = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $StartMenuDir "Ludex.lnk"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "==> Fetching latest Ludex release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "Ludex-Installer" }
$assets = @($release.assets)

function Get-Score($name) {
  $n = $name.ToLowerInvariant()
  if ($n -like "*portable*.exe") { return 0 }
  if ($n -like "*setup*.exe") { return 2 }
  if ($n -like "*.exe") { return 1 }
  return 99
}

$asset = $assets | Sort-Object { Get-Score $_.name } | Where-Object { (Get-Score $_.name) -lt 99 } | Select-Object -First 1
if (-not $asset) {
  throw "No Windows executable was found in the latest Ludex release."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$downloadPath = Join-Path $env:TEMP $asset.name
Write-Host "==> Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath -UseBasicParsing

if ($asset.name -like "*setup*.exe") {
  Write-Host "==> Running installer..."
  $proc = Start-Process -FilePath $downloadPath -ArgumentList "/S" -Wait -PassThru
  if ($proc.ExitCode -ne 0) { throw "Installer exited with code $($proc.ExitCode)" }
  Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
  Write-Host "Ludex installed."
  exit 0
}

if (Get-Process -Name "Ludex" -ErrorAction SilentlyContinue) {
  throw "Ludex is running. Close it and run this script again."
}

Copy-Item -Force $downloadPath $ExePath
Unblock-File -Path $ExePath -ErrorAction SilentlyContinue
Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue

Write-Host "==> Creating shortcuts..."
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $ExePath
$shortcut.WorkingDirectory = $InstallDir
$shortcut.IconLocation = "$ExePath,0"
$shortcut.Description = "Ludex game library and launcher"
$shortcut.Save()

if (-not $NoDesktopShortcut) {
  $desktopShortcut = $shell.CreateShortcut((Join-Path $DesktopDir "Ludex.lnk"))
  $desktopShortcut.TargetPath = $ExePath
  $desktopShortcut.WorkingDirectory = $InstallDir
  $desktopShortcut.IconLocation = "$ExePath,0"
  $desktopShortcut.Save()
}

Write-Host ""
Write-Host "Ludex installed."
Write-Host "  App:    $ExePath"
Write-Host "  Start:  $ShortcutPath"
