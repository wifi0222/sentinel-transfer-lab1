param([switch]$MutualTls)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) { npm install }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'certs\server.crt'))) { & (Join-Path $PSScriptRoot 'generate-certs.ps1') }
  $secretDir = Join-Path $root 'secrets'
  $secretFile = Join-Path $secretDir 'jwt_secret'
  New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
  if (-not (Test-Path -LiteralPath $secretFile)) {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($bytes) | Set-Content -LiteralPath $secretFile -NoNewline -Encoding ascii
  }
  $env:NODE_ENV = 'production'
  $env:HOST = '127.0.0.1'
  $env:PORT = '8443'
  $env:PUBLIC_ORIGIN = 'https://localhost:8443'
  $env:JWT_SECRET_FILE = $secretFile
  $env:DATA_DIR = (Join-Path $root 'data')
  $env:TLS_ENABLED = 'true'
  $env:TLS_CERT_PATH = (Join-Path $root 'certs\server.crt')
  $env:TLS_KEY_PATH = (Join-Path $root 'certs\server.key')
  $env:MTLS_ENABLED = if ($MutualTls) { 'true' } else { 'false' }
  $env:TLS_CA_PATH = (Join-Path $root 'certs\ca.crt')
  npm run build
  npm start
} finally { Pop-Location }

