param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$StudentId,
  [Parameter(Mandatory=$true)][string]$VideoPath
)
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^[\p{L}\p{N}_-]{1,40}$') { throw 'Name contains unsupported characters.' }
if ($StudentId -notmatch '^\d{6,24}$') { throw 'StudentId must contain 6-24 digits.' }
$root = Split-Path -Parent $PSScriptRoot
$video = [System.IO.Path]::GetFullPath($VideoPath)
if (-not (Test-Path -LiteralPath $video -PathType Leaf)) { throw 'Video file does not exist.' }
$reports = @(Get-ChildItem -LiteralPath (Join-Path $root 'report') -Filter '*.docx' -File)
if ($reports.Count -ne 1) { throw 'Exactly one DOCX report must exist in the report directory.' }
$report = $reports[0].FullName

$base = "${Name}_${StudentId}_EX1B"
$outputRoot = Join-Path $root 'submission'
$stage = Join-Path $outputRoot $base
$source = Join-Path $stage "${Name}_${StudentId}_ex1B_src"
$zip = Join-Path $outputRoot "${base}.zip"
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Force -Path $source | Out-Null

$rootFiles = @('.env.example','.gitignore','docker-compose.yml','Dockerfile','package.json','package-lock.json','README.md')
foreach ($file in $rootFiles) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $source }
foreach ($dir in @('docs','scripts','server\src','web\src','report\assets')) {
  $destination = Join-Path $source $dir
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Copy-Item -Path (Join-Path $root "$dir\*") -Destination $destination -Recurse -Force
}
foreach ($file in @('server\package.json','server\tsconfig.json','web\package.json','web\index.html','web\tsconfig.json','web\tsconfig.app.json','web\tsconfig.node.json','web\vite.config.ts','report\build_report.py')) {
  $destination = Join-Path $source (Split-Path -Parent $file)
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $source $file) -Force
}

Copy-Item -LiteralPath $video -Destination (Join-Path $stage "${Name}_${StudentId}_ex1B_play.mp4")
Copy-Item -LiteralPath $report -Destination (Join-Path $stage "${Name}_${StudentId}_ex1B_report.docx")
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Created $zip"

