# NoteVault installer (current user, no admin needed).
#   Install NoteVault.cmd                      double-click: installs, adds Start menu + Ctrl+Alt+N, opens the app
#   install.ps1 -Startup                       also starts NoteVault quietly at sign-in (faster first open)
#   install.ps1 -Uninstall                     removes the app and shortcuts (your notes are kept)
#   install.ps1 -InstallDir X -NoShortcuts     install somewhere else without touching shortcuts (for testing)
param(
    [switch]$Startup,
    [switch]$Uninstall,
    [switch]$NoShortcuts,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\NoteVault')
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dataDir = Join-Path $env:LOCALAPPDATA 'NoteVault'
$programs = [Environment]::GetFolderPath('Programs')
$startupDir = [Environment]::GetFolderPath('Startup')
$menuLnk = Join-Path $programs 'NoteVault.lnk'
$startLnk = Join-Path $startupDir 'NoteVault (background).lnk'
$port = 47823
$appFiles = @('server.js', 'notepad-import.js', 'demo-notes.js', 'public\index.html', 'public\editor.js',
              'icon.ico', 'logo.svg', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'install.ps1',
              'Install NoteVault.cmd', 'Uninstall NoteVault.cmd')

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

function Stop-NoteVault {
    # Stop a running NoteVault so its files can be replaced. Only touches the process that answers as NoteVault.
    try {
        $ping = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/ping" -TimeoutSec 2
        if ($ping.app -eq 'notevault') {
            Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Milliseconds 400
        }
    } catch { }
}

function Find-Node {
    $candidates = @()
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) {
            try {
                $v = [version](& $c -p 'process.versions.node')
                if ($v -ge [version]'22.13.0') { return $c }
                Say "Found Node.js $v, but NoteVault needs 22.13 or newer." 'Yellow'
            } catch { }
        }
    }
    return $null
}

if ($Uninstall) {
    Stop-NoteVault
    Remove-Item $menuLnk, $startLnk -ErrorAction SilentlyContinue
    if ((Test-Path $InstallDir) -and ($InstallDir -ne $src)) { Remove-Item $InstallDir -Recurse -Force }
    Say "NoteVault was removed. Your notes are still in $dataDir - delete that folder too if you want them gone." 'Green'
    return
}

Say ''
Say '  NoteVault installer' 'Cyan'
Say ''

# 1. Node.js (runs NoteVault's small local server)
$node = Find-Node
if (-not $node) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Say 'NoteVault needs Node.js 22.13 or newer. Install the LTS version from https://nodejs.org and run this installer again.' 'Yellow'
        exit 1
    }
    $answer = Read-Host 'NoteVault needs Node.js (free, from nodejs.org). Install it now with winget? [Y/n]'
    if ($answer -match '^(n|no)$') { Say 'Cancelled. Install Node.js LTS, then run this installer again.' 'Yellow'; exit 1 }
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $node = Find-Node
    if (-not $node) { Say 'Node.js did not install. Install the LTS version from https://nodejs.org, then run this installer again.' 'Red'; exit 1 }
}
Say "Node.js: $node"

# 2. Copy the app (files from the internet are marked unsafe by Windows; clear that mark first)
Get-ChildItem $src -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
if (-not $NoShortcuts) { Stop-NoteVault }   # a test install leaves any running copy alone
if ($InstallDir -ne $src) {
    foreach ($f in $appFiles) {
        $from = Join-Path $src $f
        if (-not (Test-Path $from)) { continue }
        $to = Join-Path $InstallDir $f
        New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
        Copy-Item $from $to -Force
    }
}
Say "Installed to: $InstallDir"

# 3. Hidden launchers (no console window)
function Write-Launcher($name, $flag) {
    $vbs = "CreateObject(""WScript.Shell"").Run """"""$node"""" --no-warnings """"$InstallDir\server.js"""" $flag"", 0, False"
    Set-Content -Path (Join-Path $InstallDir $name) -Value $vbs -Encoding ASCII
}
Write-Launcher 'launch.vbs' '--open'
Write-Launcher 'background.vbs' '--background'

if ($NoShortcuts) { Say 'Shortcuts skipped (-NoShortcuts).'; return }

# 4. Start menu shortcut + Ctrl+Alt+N
$shell = New-Object -ComObject WScript.Shell
function New-Shortcut($path, $vbs, $hotkey) {
    $s = $shell.CreateShortcut($path)
    $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $s.Arguments = '"' + (Join-Path $InstallDir $vbs) + '"'
    $s.WorkingDirectory = $InstallDir
    $s.IconLocation = (Join-Path $InstallDir 'icon.ico') + ',0'
    $s.Description = 'NoteVault - auto-saving, searchable notes'
    if ($hotkey) { $s.Hotkey = $hotkey }
    $s.Save()
}
New-Shortcut $menuLnk 'launch.vbs' 'Ctrl+Alt+N'
if ($Startup) { New-Shortcut $startLnk 'background.vbs' $null }

Say ''
Say 'Done! Open NoteVault any time: press Win, type "notev", Enter - or press Ctrl+Alt+N.' 'Green'
Say "Your notes are stored only on this PC, in $dataDir"
Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $InstallDir 'launch.vbs') + '"')
