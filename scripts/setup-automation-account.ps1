<#
    setup-automation-account.ps1

    Creates the local account that scheduled desktop tests run as, and sets up
    autologon so its interactive session exists at 3am with nobody at the
    machine. Run from an elevated PowerShell.

    The password is generated here, written straight to the LSA secret that
    Winlogon reads, and then discarded. It is never printed, never written to a
    file, and never put in Marvin's secrets store: the scheduler service does
    not need it. WTSQueryUserToken hands LocalSystem a token for an already
    logged-on session without any credential, so the only consumer of that
    password is Winlogon at boot.

    Recovery, if the password ever has to change: reset the account and run
    this again. There is no copy to recover.

      -Account    local account name (default marvin-auto)
      -DataDir    Marvin's shared data directory
      -AppDir     Marvin's install directory, granted read+execute
      -Mode       all | settings   ("settings" re-applies the per-user
                  lock/screensaver settings once the profile exists, which is
                  after the first autologon)
#>

[CmdletBinding()]
param(
    [string]$Account = "marvin-auto",
    [string]$DataDir = "C:\ProgramData\uts-automation",
    [string]$AppDir,
    [ValidateSet("all", "settings")]
    [string]$Mode = "all"
)

$ErrorActionPreference = "Stop"

function Assert-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This must be run from an elevated PowerShell: it creates a local account and writes an LSA secret."
    }
}

# A password nobody will ever see, including whoever runs this. Long and from a
# CSPRNG, because it is never typed and never needs to be memorable.
function New-AutomationPassword {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    # Base64 plus one of each required class, so any complexity policy is met.
    return ([Convert]::ToBase64String($bytes) + "aA1!")
}

function Get-AccountSid {
    param([string]$Name)
    return (New-Object Security.Principal.NTAccount($Name)).Translate([Security.Principal.SecurityIdentifier]).Value
}

# ─── Per-user lock settings (AC4) ───
#
# Written under the account's own hive only. The machine-wide "Interactive
# logon: Machine inactivity limit" is deliberately not touched: it would lock
# every session on this VM, including the one you RDP in with.
function Set-NoLockSettings {
    param([string]$Sid)

    $hiveLoaded = $false
    $root = "Registry::HKEY_USERS\$Sid"

    if (-not (Test-Path $root)) {
        $hive = "C:\Users\$Account\NTUSER.DAT"
        if (-not (Test-Path $hive)) {
            return @{ applied = $false; detail = "The profile for $Account does not exist yet. Reboot so autologon creates it, then re-run this with -Mode settings." }
        }
        & reg.exe load "HKU\$Sid" $hive | Out-Null
        $hiveLoaded = $true
    }

    try {
        $desktop = "$root\Control Panel\Desktop"
        $policy = "$root\Software\Policies\Microsoft\Windows\Control Panel\Desktop"
        $system = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\System"
        foreach ($key in @($desktop, $policy, $system)) {
            if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
        }

        # No screensaver, and no secure (locking) screensaver if one ever starts.
        foreach ($key in @($desktop, $policy)) {
            Set-ItemProperty -Path $key -Name "ScreenSaveActive" -Value "0" -Type String
            Set-ItemProperty -Path $key -Name "ScreenSaverIsSecure" -Value "0" -Type String
            Set-ItemProperty -Path $key -Name "ScreenSaveTimeOut" -Value "0" -Type String
        }
        # And the session cannot be locked at all, by anyone or anything.
        Set-ItemProperty -Path $system -Name "DisableLockWorkstation" -Value 1 -Type DWord

        return @{ applied = $true }
    }
    finally {
        if ($hiveLoaded) {
            [gc]::Collect()
            & reg.exe unload "HKU\$Sid" | Out-Null
        }
    }
}

# The machine-wide inactivity limit would lock our session too. Report it rather
# than changing it: it is somebody's security baseline, and silently weakening
# the whole VM is not this script's call.
function Test-MachineInactivityLimit {
    $key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
    $value = (Get-ItemProperty -Path $key -Name "InactivityTimeoutSecs" -ErrorAction SilentlyContinue).InactivityTimeoutSecs
    if ($value -and $value -gt 0) {
        return "WARNING: the machine-wide inactivity limit is set to $value seconds. It will lock the automation session too, and scheduled desktop tests will fail once it fires. This script does not change machine-wide policy: exempt this VM or clear InactivityTimeoutSecs."
    }
    return $null
}

# ─── Deny every way in except autologon (AC2) ───
function Deny-LogonRights {
    param([string]$Sid)

    $export = Join-Path $env:TEMP "marvin-secpol-export.inf"
    $import = Join-Path $env:TEMP "marvin-secpol-import.inf"
    & secedit.exe /export /cfg $export /quiet | Out-Null

    $rights = @{
        "SeDenyNetworkLogonRight" = $Sid
        "SeDenyRemoteInteractiveLogonRight" = $Sid
    }

    $lines = @("[Unicode]", "Unicode=yes", "[Version]", 'signature="$CHICAGO$"', "Revision=1", "[Privilege Rights]")
    foreach ($right in $rights.Keys) {
        $existing = (Select-String -Path $export -Pattern "^$right\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1)
        $value = if ($existing) { ($existing.Line -split "=", 2)[1].Trim() } else { "" }
        if ($value -notmatch [regex]::Escape("*$Sid")) {
            $value = if ($value) { "$value,*$Sid" } else { "*$Sid" }
        }
        $lines += "$right = $value"
    }

    Set-Content -Path $import -Value $lines -Encoding Unicode
    & secedit.exe /configure /db "$env:TEMP\marvin-secpol.sdb" /cfg $import /areas USER_RIGHTS /quiet | Out-Null
    Remove-Item $export, $import -ErrorAction SilentlyContinue
}

# ─── The LSA secret Winlogon reads (AC3) ───
function Set-AutologonSecret {
    param([string]$Password)

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class MarvinLsa {
    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_OBJECT_ATTRIBUTES {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, uint DesiredAccess, out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern uint LsaStorePrivateData(IntPtr PolicyHandle, ref LSA_UNICODE_STRING KeyName, ref LSA_UNICODE_STRING PrivateData);

    [DllImport("advapi32.dll")]
    public static extern uint LsaClose(IntPtr PolicyHandle);

    [DllImport("advapi32.dll")]
    public static extern int LsaNtStatusToWinError(uint Status);

    public static LSA_UNICODE_STRING Str(string value) {
        LSA_UNICODE_STRING s = new LSA_UNICODE_STRING();
        s.Buffer = Marshal.StringToHGlobalUni(value);
        s.Length = (ushort)(value.Length * 2);
        s.MaximumLength = (ushort)((value.Length + 1) * 2);
        return s;
    }
}
"@

    $attrs = New-Object MarvinLsa+LSA_OBJECT_ATTRIBUTES
    $attrs.Length = [Runtime.InteropServices.Marshal]::SizeOf($attrs)
    $policy = [IntPtr]::Zero
    $POLICY_CREATE_SECRET = 0x00000020
    $POLICY_WRITE = 0x000007F8

    $status = [MarvinLsa]::LsaOpenPolicy([IntPtr]::Zero, [ref]$attrs, ($POLICY_CREATE_SECRET -bor $POLICY_WRITE), [ref]$policy)
    if ($status -ne 0) { throw "LsaOpenPolicy failed: Win32 error $([MarvinLsa]::LsaNtStatusToWinError($status))" }

    try {
        $key = [MarvinLsa]::Str("DefaultPassword")
        $data = [MarvinLsa]::Str($Password)
        $status = [MarvinLsa]::LsaStorePrivateData($policy, [ref]$key, [ref]$data)
        if ($status -ne 0) { throw "LsaStorePrivateData failed: Win32 error $([MarvinLsa]::LsaNtStatusToWinError($status))" }
        [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($data.Buffer)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($key.Buffer)
    }
    finally {
        [void][MarvinLsa]::LsaClose($policy)
    }
}

# ─── Run ───

Assert-Elevated

$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
$warnings = @()

if ($Mode -eq "all") {
    $password = New-AutomationPassword
    $secure = ConvertTo-SecureString $password -AsPlainText -Force

    $existing = Get-LocalUser -Name $Account -ErrorAction SilentlyContinue
    if ($existing) {
        Set-LocalUser -Name $Account -Password $secure -PasswordNeverExpires $true
    } else {
        # Windows caps a local account description at 48 characters, and
        # New-LocalUser refuses the whole call if it is longer.
        New-LocalUser -Name $Account -Password $secure -FullName "Marvin automation" `
            -Description "Marvin scheduled desktop tests. No human logon." `
            -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    }
    # Deliberately not added to Administrators.

    $sid = Get-AccountSid -Name $Account

    Set-AutologonSecret -Password $password
    $password = $null
    $secure = $null
    [gc]::Collect()

    Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -Value "1" -Type String
    Set-ItemProperty -Path $winlogon -Name "DefaultUserName" -Value $Account -Type String
    Set-ItemProperty -Path $winlogon -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String
    # A plaintext DefaultPassword here would defeat the whole point.
    Remove-ItemProperty -Path $winlogon -Name "DefaultPassword" -ErrorAction SilentlyContinue

    # Hidden from the sign-in screen's user list.
    $userList = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"
    if (-not (Test-Path $userList)) { New-Item -Path $userList -Force | Out-Null }
    Set-ItemProperty -Path $userList -Name $Account -Value 0 -Type DWord

    Deny-LogonRights -Sid $sid

    # Read and execute on the install directory, so the run can load node and
    # the server's node_modules.
    if ($AppDir) {
        & icacls.exe $AppDir /grant "$($env:COMPUTERNAME)\$($Account):(OI)(CI)RX" /C /Q | Out-Null
    } else {
        $warnings += "No -AppDir was given. The automation account still needs read and execute on Marvin's install directory, or scheduled desktop runs cannot load node_modules."
    }

    if (-not (Test-Path $DataDir)) { New-Item -Path $DataDir -ItemType Directory -Force | Out-Null }
    @{ user = $Account; configuredAt = (Get-Date).ToString("o") } |
        ConvertTo-Json | Set-Content -Path (Join-Path $DataDir "automation-account.json") -Encoding UTF8
} else {
    $sid = Get-AccountSid -Name $Account
}

$settings = Set-NoLockSettings -Sid $sid
if (-not $settings.applied) { $warnings += $settings.detail }

$inactivity = Test-MachineInactivityLimit
if ($inactivity) { $warnings += $inactivity }

@{
    ok = $true
    user = $Account
    sid = $sid
    lockSettingsApplied = $settings.applied
    warnings = $warnings
    next = "Reboot. The account signs in automatically, and Marvin's startup check will show the Desktop Session row green once it can open that session's input desktop."
} | ConvertTo-Json -Depth 4
