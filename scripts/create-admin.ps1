param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[\p{L}\p{N}_.-]{3,32}$')]
  [string]$Username,
  [switch]$ResetPassword
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$mode = if ($ResetPassword) { '--reset-password' } else { '--create' }
Push-Location $projectRoot
try {
  if (-not $ResetPassword) {
    & npx tsx server/src/admin-cli.ts $Username --check
    $checkCode = $LASTEXITCODE
    if ($checkCode -eq 0) { return }
    if ($checkCode -ne 10) {
      Write-Host 'Admin check failed; no changes were made.' -ForegroundColor Red
      return
    }
  }
} finally { Pop-Location }

$secure = Read-Host 'Enter admin password (12+ chars with upper, lower, digit and symbol)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:SFT_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  Push-Location $projectRoot
  try {
    & npx tsx server/src/admin-cli.ts $Username $mode
    if ($LASTEXITCODE -ne 0) { Write-Host 'Admin operation failed; no unsafe promotion was performed.' -ForegroundColor Red }
  }
  finally { Pop-Location }
} finally {
  $env:SFT_ADMIN_PASSWORD = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
