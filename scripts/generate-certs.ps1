param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root 'certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$required = @('ca.crt','ca.key','server.crt','server.key','client.crt','client.key','client.p12')
$existing = $required | Where-Object { Test-Path -LiteralPath (Join-Path $certDir $_) }
if ($existing.Count -eq $required.Count -and -not $Force) {
  Write-Host 'Certificates already exist. Run npm run certs -- --Force to rebuild.'
  exit 0
}
if ($existing.Count -gt 0 -and -not $Force) { throw 'A partial certificate set exists. Run npm run certs -- --Force to rebuild it safely.' }
if ($Force) {
  foreach ($name in $required) {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $certDir $name))
    if ($candidate.StartsWith([System.IO.Path]::GetFullPath($certDir)) -and (Test-Path -LiteralPath $candidate)) {
      Remove-Item -LiteralPath $candidate -Force
    }
  }
}

if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) { throw 'OpenSSL was not found. Install OpenSSL or use the openssl.exe bundled with Git for Windows.' }
$openSslConfig = Join-Path $certDir 'openssl.cnf'
$serverExt = Join-Path $certDir 'server.ext'
$clientExt = Join-Path $certDir 'client.ext'
@"
[req]
distinguished_name=dn
[dn]
"@ | Set-Content -LiteralPath $openSslConfig -Encoding ascii
@"
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
"@ | Set-Content -LiteralPath $serverExt -Encoding ascii
@"
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
"@ | Set-Content -LiteralPath $clientExt -Encoding ascii

Push-Location $certDir
try {
  function Invoke-OpenSsl {
    param([string[]]$OpenSslArgs)
    & openssl @OpenSslArgs
    if ($LASTEXITCODE -ne 0) { throw "OpenSSL failed with exit code ${LASTEXITCODE}: $($OpenSslArgs -join ' ')" }
  }
  Invoke-OpenSsl @('genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:4096','-out','ca.key')
  Invoke-OpenSsl @('req','-x509','-new','-sha256','-config','openssl.cnf','-key','ca.key','-days','3650','-subj','/CN=Sentinel Transfer Lab CA','-out','ca.crt')
  Invoke-OpenSsl @('genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-out','server.key')
  Invoke-OpenSsl @('req','-new','-config','openssl.cnf','-key','server.key','-subj','/CN=localhost','-out','server.csr')
  Invoke-OpenSsl @('x509','-req','-sha256','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','825','-extfile','server.ext','-out','server.crt')
  Invoke-OpenSsl @('genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-out','client.key')
  Invoke-OpenSsl @('req','-new','-config','openssl.cnf','-key','client.key','-subj','/CN=lab-client','-out','client.csr')
  Invoke-OpenSsl @('x509','-req','-sha256','-in','client.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','825','-extfile','client.ext','-out','client.crt')
  Invoke-OpenSsl @('pkcs12','-export','-out','client.p12','-inkey','client.key','-in','client.crt','-certfile','ca.crt','-passout','pass:lab1-demo-only')
  Invoke-OpenSsl @('verify','-CAfile','ca.crt','server.crt','client.crt')
  Write-Host 'Certificates created. Demo client.p12 password: lab1-demo-only. Regenerate with a strong password for production.'
} finally {
  Remove-Item -LiteralPath server.csr,client.csr,server.ext,client.ext,ca.srl,openssl.cnf -Force -ErrorAction SilentlyContinue
  Pop-Location
}

