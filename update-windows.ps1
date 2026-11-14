# Update an existing Ludex installation on Windows.
$ErrorActionPreference = "Stop"
$Repo = "spammail10q1-cloud/ludex"
$ScriptUrl = "https://raw.githubusercontent.com/$Repo/main/install-windows.ps1"

Write-Host "==> Updating Ludex from GitHub..."
$script = Invoke-RestMethod -Uri $ScriptUrl -Headers @{ "User-Agent" = "Ludex-Updater" }
& ([scriptblock]::Create($script)) -Update
