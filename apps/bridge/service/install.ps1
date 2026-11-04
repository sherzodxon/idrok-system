# Installs (or updates) the Idrok Bridge Windows service. Run in an elevated PowerShell on the school PC:
#   .\install.ps1 -Server https://api.<domain>/api/v1 -Token <token shown once in Idrok> [-Port 8090]
# Needs: Node.js 24+ in PATH, WinSW-x64.exe (https://github.com/winsw/winsw/releases) next to this script,
# and main.js from `pnpm --filter @idrok/bridge build` (apps/bridge/dist/main.js).
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Token,
  [int]$Port = 8090,
  [string]$InstallDir = "$env:ProgramFiles\IdrokBridge",
  [string]$DataDir = "$env:ProgramData\IdrokBridge"
)
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this script as Administrator." }
$nodeVersion = (& node --version) -replace "^v", ""
if ([int]($nodeVersion.Split(".")[0]) -lt 24) { throw "Node.js 24 or newer is required (found $nodeVersion)." }
foreach ($f in @("WinSW-x64.exe", "IdrokBridge.xml", "main.js")) {
  if (-not (Test-Path (Join-Path $PSScriptRoot $f))) { throw "$f must be next to install.ps1." }
}

$exe = Join-Path $InstallDir "IdrokBridge.exe"
if (Test-Path $exe) { & $exe stop | Out-Null }
New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot "WinSW-x64.exe") $exe -Force
Copy-Item (Join-Path $PSScriptRoot "IdrokBridge.xml") (Join-Path $InstallDir "IdrokBridge.xml") -Force
Copy-Item (Join-Path $PSScriptRoot "main.js") (Join-Path $InstallDir "main.js") -Force
if (Test-Path (Join-Path $PSScriptRoot "main.js.map")) {
  Copy-Item (Join-Path $PSScriptRoot "main.js.map") (Join-Path $InstallDir "main.js.map") -Force
}

# The token and terminal passwords are for SYSTEM and Administrators only.
& icacls $DataDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

if ($Token) {
  & node (Join-Path $InstallDir "main.js") setup --server $Server --token $Token --port $Port --data-dir $DataDir
  if ($LASTEXITCODE -ne 0) { throw "setup failed" }
} elseif (-not (Test-Path (Join-Path $DataDir "token"))) {
  throw "First install needs -Token."
}

# Terminals push events to this PC: allow the port from the local network only.
if (-not (Get-NetFirewallRule -DisplayName "Idrok Bridge" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Idrok Bridge" -Direction Inbound -Protocol TCP -LocalPort $Port `
    -RemoteAddress LocalSubnet -Action Allow | Out-Null
}

if (-not (Get-Service IdrokBridge -ErrorAction SilentlyContinue)) { & $exe install | Out-Null }
& $exe start | Out-Null
Start-Sleep -Seconds 3
& node (Join-Path $InstallDir "main.js") status --data-dir $DataDir
