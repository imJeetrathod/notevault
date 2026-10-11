# Builds the downloadable zip from an explicit file list (never your notes, never machine-specific files).
#   powershell -ExecutionPolicy Bypass -File build-release.ps1 -Version 1.0.0
param([string]$Version = '1.0.0')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$files = @('server.js', 'notepad-import.js', 'demo-notes.js', 'public\index.html', 'public\editor.js',
           'icon.ico', 'logo.svg', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'install.ps1',
           'Install NoteVault.cmd', 'Uninstall NoteVault.cmd')

$dist = Join-Path $root 'dist'
$stage = Join-Path $env:TEMP "notevault-stage-$Version"
$zip = Join-Path $dist "NoteVault-$Version-windows.zip"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'NoteVault'), $dist | Out-Null
foreach ($f in $files) {
    $to = Join-Path $stage "NoteVault\$f"
    New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
    Copy-Item (Join-Path $root $f) $to
}
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage 'NoteVault') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $zip).Length
[pscustomobject]@{ file = (Split-Path $zip -Leaf); bytes = $size; sha256 = $hash } | ConvertTo-Json | Set-Content (Join-Path $dist 'release.json') -Encoding UTF8
Write-Host "Built $zip ($([math]::Round($size / 1KB)) KB)"
Write-Host "SHA-256 $hash"
