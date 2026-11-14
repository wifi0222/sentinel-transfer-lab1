$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$secretDir = Join-Path $root 'secrets'
$secretFile = Join-Path $secretDir 'jwt_secret'
New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
if (Test-Path -LiteralPath $secretFile) { Write-Host 'JWT secret already exists and was not overwritten.'; exit 0 }
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
[Convert]::ToBase64String($bytes) | Set-Content -LiteralPath $secretFile -NoNewline -Encoding ascii
Write-Host 'Created secrets/jwt_secret. Do not commit this file.'

