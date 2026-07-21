# scripts/deploy-win.ps1
# Installs Marvin machine-wide from the packaged win-unpacked output, without NSIS.
#
# Use this when `npm run dist` cannot produce an installer (locked-down build
# machines block makensis.exe). It does the same job the NSIS installer would:
# copies the app into Program Files, creates all-users Desktop and Start Menu
# shortcuts, and optionally registers the scheduler service.
#
# Run from an elevated PowerShell on the target machine:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-win.ps1
#
# The source folder can live on a network share, so one build serves many VMs:
#   ... -Source \\server\share\marvin\win-unpacked

[CmdletBinding()]
param(
    # Packaged app produced by `npm run dist` (the build succeeds up to this point
    # even when the NSIS step fails). Defaults to ..\dist\win-unpacked relative to
    # this script; resolved in the body, since $PSScriptRoot is not reliably
    # populated while param() defaults are evaluated.
    [string] $Source,

    [string] $InstallDir = (Join-Path $env:ProgramFiles "Marvin"),

    # Skip registering the Marvin Scheduler service. Without the service, no user
    # sees any schedules, so only pass this if the service is already installed.
    [switch] $SkipService
)

$ErrorActionPreference = "Stop"

function Assert-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This script must be run from an elevated PowerShell (Run as Administrator)."
    }
}

function New-Shortcut {
    param([string] $Path, [string] $Target, [string] $IconPath)

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    $shortcut.WorkingDirectory = Split-Path -Parent $Target
    $shortcut.Description = "Marvin - Desktop and Web Test Automation"
    if ($IconPath -and (Test-Path $IconPath)) { $shortcut.IconLocation = $IconPath }
    $shortcut.Save()
}

Assert-Elevated

# $PSScriptRoot is empty in some hosts; fall back to the invocation path, then cwd.
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

if (-not $Source) { $Source = Join-Path $scriptDir "..\dist\win-unpacked" }
if (-not (Test-Path $Source)) {
    throw "Source folder '$Source' not found. Run 'npm run dist' first, or pass -Source explicitly."
}
$Source = (Resolve-Path $Source).Path
$exeSource = Join-Path $Source "Marvin.exe"
if (-not (Test-Path $exeSource)) {
    throw "No Marvin.exe under '$Source'. Run 'npm run dist' first - the packaging step succeeds even if the NSIS installer step fails."
}

# Marvin.exe holds a lock on its own files, so a running instance breaks the copy.
$running = Get-Process -Name "Marvin" -ErrorAction SilentlyContinue
if ($running) {
    throw "Marvin is running (PID $($running.Id -join ', ')). Close it on every logged-in session, then re-run."
}

Write-Host "Installing Marvin"
Write-Host "  from: $Source"
Write-Host "  to:   $InstallDir"

# Replace rather than merge, so files dropped between versions don't linger.
if (Test-Path $InstallDir) {
    Write-Host "Removing the previous install..."
    Remove-Item -Recurse -Force $InstallDir
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $Source "*") -Destination $InstallDir -Recurse -Force

$exe = Join-Path $InstallDir "Marvin.exe"
$icon = Join-Path $InstallDir "resources\icons\icon.ico"
if (-not (Test-Path $icon)) { $icon = $exe }

# CommonDesktopDirectory / CommonStartMenu resolve to the all-users profiles, so
# every account that logs into the VM gets these, which is the whole point.
$commonDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
$commonPrograms = [Environment]::GetFolderPath("CommonPrograms")

New-Shortcut -Path (Join-Path $commonDesktop "Marvin.lnk") -Target $exe -IconPath $icon
New-Shortcut -Path (Join-Path $commonPrograms "Marvin.lnk") -Target $exe -IconPath $icon

Write-Host "Shortcuts created for all users:"
Write-Host "  $commonDesktop\Marvin.lnk"
Write-Host "  $commonPrograms\Marvin.lnk"

if (-not $SkipService) {
    # scripts/ is not in the electron-builder `files` list, so it is not inside
    # win-unpacked. The copy next to this script is the one that normally exists.
    $installService = Join-Path $scriptDir "install-service-win.js"

    if (Test-Path $installService) {
        Write-Host "`nRegistering the Marvin Scheduler service..."
        try {
            & node $installService
        } catch {
            Write-Warning "Scheduler service registration failed: $_"
            Write-Warning "Run 'node scripts\install-service-win.js' manually from an elevated prompt."
        }
    } else {
        Write-Warning "install-service-win.js not found. Register the scheduler service manually, or no user will see any schedules."
    }
}

Write-Host "`nDone. Marvin is installed for all users at $InstallDir"
Write-Host "Reminder: Git must be on the PATH for test repo cloning to work."
