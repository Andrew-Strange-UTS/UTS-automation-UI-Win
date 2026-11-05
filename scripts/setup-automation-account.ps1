<#
    setup-automation-account.ps1

    Creates the local account that scheduled desktop tests run as. Run from an
    elevated PowerShell. Safe to re-run, and re-running it on a VM set up by
    an older version migrates it (EPEA-TBD-17).

    There is no autologon. The VM team does not allow a VM that signs itself in
    and whose desktop is reachable from the VMware console, so the scheduler
    service opens a session only for a desktop run, by making an RDP connection
    from the VM to itself (127.0.0.2), and logs it off afterwards. That session
    is never the console session.

    To log on each time, the service needs the account's password. It is
    generated here from a CSPRNG and written to an LSA secret only SYSTEM can
    read (L$MarvinAutomationPassword). It is never printed, never written to a
    file and never put in Marvin's secrets store, and no person knows it.

    What this changes:
      - creates the account (or resets its password), never an administrator
      - stores the password in the LSA secret above
      - turns autologon OFF and deletes the old autologon password
      - logs off any session the account has open (an old autologon session)
      - denies network logon; allows Remote Desktop logon, which loopback RDP
        needs (removes the old deny, adds the account to Remote Desktop Users)
      - hides the account from the sign-in screen
      - removes the old keep-alive scheduled task
      - per-user no-lock settings (once the profile exists)
      - read access to the install, and the run directories

    Recovery, if the password ever has to change: run this again. It resets
    the account and stores the new password.

      -Account    local account name (default marvin-auto)
      -DataDir    Marvin's shared data directory
      -AppDir     Marvin's install directory, granted read+execute
      -Mode       all | settings   ("settings" re-applies the per-user
                  lock/screensaver settings once the profile exists, which is
                  after the first session: use Test session in Marvin first)
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
        return "Note: the machine-wide inactivity limit is $value seconds. Each desktop run gets a fresh session, so this only matters if a single test goes that long without any input; that run would fail on a locked desktop and the next one would start clean."
    }
    return $null
}

# Membership by SID, through ADSI. Get-LocalGroupMember throws on a group
# holding an orphaned SID (a deleted account), which a shared VM collects, and
# that would make a working setup look broken.
function Test-InLocalGroup {
    param([string]$GroupSid, [string]$MemberSid)
    $groupName = (New-Object Security.Principal.SecurityIdentifier($GroupSid)).Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
    $group = [ADSI]"WinNT://$env:COMPUTERNAME/$groupName,group"
    foreach ($member in @($group.psbase.Invoke("Members"))) {
        $bytes = $member.GetType().InvokeMember("objectSid", "GetProperty", $null, $member, $null)
        if ($bytes -and (New-Object Security.Principal.SecurityIdentifier($bytes, 0)).Value -eq $MemberSid) { return $true }
    }
    return $false
}

# ─── Logon rights (EPEA-TBD-17) ───
#
# Network logon stays denied. Remote Desktop logon is now ALLOWED, because the
# run's session is an RDP connection from the VM to itself; an older setup
# denied it, so that deny is removed here.
function Set-LogonRights {
    param([string]$Sid)

    $export = Join-Path $env:TEMP "marvin-secpol-export.inf"
    $import = Join-Path $env:TEMP "marvin-secpol-import.inf"
    & secedit.exe /export /cfg $export /areas USER_RIGHTS /quiet | Out-Null

    function Get-Right([string]$Right) {
        $existing = (Select-String -Path $export -Pattern "^$Right\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($existing) { return ($existing.Line -split "=", 2)[1].Trim() }
        return ""
    }

    $lines = @("[Unicode]", "Unicode=yes", "[Version]", 'signature="$CHICAGO$"', "Revision=1", "[Privilege Rights]")

    $network = Get-Right "SeDenyNetworkLogonRight"
    if ($network -notmatch [regex]::Escape("*$Sid")) {
        $network = if ($network) { "$network,*$Sid" } else { "*$Sid" }
    }
    $lines += "SeDenyNetworkLogonRight = $network"

    $rdp = Get-Right "SeDenyRemoteInteractiveLogonRight"
    $rdpDenyRemoved = $false
    if ($rdp -match [regex]::Escape("*$Sid")) {
        $rdp = (($rdp -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "*$Sid" }) -join ","
        $lines += "SeDenyRemoteInteractiveLogonRight = $rdp"
        $rdpDenyRemoved = $true
    }

    Set-Content -Path $import -Value $lines -Encoding Unicode
    & secedit.exe /configure /db "$env:TEMP\marvin-secpol.sdb" /cfg $import /areas USER_RIGHTS /quiet | Out-Null
    Remove-Item $export, $import -ErrorAction SilentlyContinue

    # Remote Desktop Users, by well-known SID so it works in any language.
    if (-not (Test-InLocalGroup -GroupSid "S-1-5-32-555" -MemberSid $Sid)) {
        $groupName = (New-Object Security.Principal.SecurityIdentifier("S-1-5-32-555")).Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
        ([ADSI]"WinNT://$env:COMPUTERNAME/$groupName,group").Add("WinNT://$env:COMPUTERNAME/$Account,user")
    }

    # Read back, because secedit exits zero for a lot of things it did not do.
    & secedit.exe /export /cfg $export /areas USER_RIGHTS /quiet | Out-Null
    $stillDenied = [bool](Select-String -Path $export -Pattern ("^SeDenyRemoteInteractiveLogonRight\s*=.*" + [regex]::Escape("*$Sid")) -ErrorAction SilentlyContinue)
    Remove-Item $export -ErrorAction SilentlyContinue
    $inGroup = Test-InLocalGroup -GroupSid "S-1-5-32-555" -MemberSid $Sid

    return @{ rdpDenyRemoved = $rdpDenyRemoved; rdpAllowed = ((-not $stillDenied) -and $inGroup) }
}

# ─── LSA secrets (EPEA-TBD-17 AC2, AC3) ───
#
# Set-LsaSecret with $null deletes the secret: that is how the old autologon
# password (DefaultPassword) is removed.
function Initialize-Natives {
    if ("MarvinLsa" -as [type]) { return }
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

    [StructLayout(LayoutKind.Sequential)]
    public struct WTS_SESSION_INFO {
        public int SessionId;
        [MarshalAs(UnmanagedType.LPWStr)] public string pWinStationName;
        public int State;
    }

    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, uint DesiredAccess, out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern uint LsaStorePrivateData(IntPtr PolicyHandle, ref LSA_UNICODE_STRING KeyName, ref LSA_UNICODE_STRING PrivateData);

    [DllImport("advapi32.dll", SetLastError=true, EntryPoint="LsaStorePrivateData")]
    public static extern uint LsaDeletePrivateData(IntPtr PolicyHandle, ref LSA_UNICODE_STRING KeyName, IntPtr PrivateData);

    [DllImport("advapi32.dll")]
    public static extern uint LsaClose(IntPtr PolicyHandle);

    [DllImport("advapi32.dll")]
    public static extern int LsaNtStatusToWinError(uint Status);

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern int WTSEnumerateSessionsW(IntPtr hServer, int Reserved, int Version, ref IntPtr ppSessionInfo, ref int pCount);

    [DllImport("wtsapi32.dll")]
    public static extern void WTSFreeMemory(IntPtr pMemory);

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern bool WTSQuerySessionInformationW(IntPtr hServer, int sessionId, int wtsInfoClass, out IntPtr ppBuffer, out int pBytesReturned);

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern bool WTSLogoffSession(IntPtr hServer, int SessionId, bool bWait);

    public static LSA_UNICODE_STRING Str(string value) {
        LSA_UNICODE_STRING s = new LSA_UNICODE_STRING();
        s.Buffer = Marshal.StringToHGlobalUni(value);
        s.Length = (ushort)(value.Length * 2);
        s.MaximumLength = (ushort)((value.Length + 1) * 2);
        return s;
    }
}
"@
}

function Set-LsaSecret {
    param([string]$KeyName, [string]$Value)
    Initialize-Natives

    $attrs = New-Object MarvinLsa+LSA_OBJECT_ATTRIBUTES
    $attrs.Length = [Runtime.InteropServices.Marshal]::SizeOf($attrs)
    $policy = [IntPtr]::Zero
    $POLICY_CREATE_SECRET = 0x00000020
    $POLICY_WRITE = 0x000007F8
    $STATUS_OBJECT_NAME_NOT_FOUND = [uint32]3221225524

    $status = [MarvinLsa]::LsaOpenPolicy([IntPtr]::Zero, [ref]$attrs, ($POLICY_CREATE_SECRET -bor $POLICY_WRITE), [ref]$policy)
    if ($status -ne 0) { throw "LsaOpenPolicy failed: Win32 error $([MarvinLsa]::LsaNtStatusToWinError($status))" }

    try {
        $key = [MarvinLsa]::Str($KeyName)
        try {
            if ($null -eq $Value) {
                $status = [MarvinLsa]::LsaDeletePrivateData($policy, [ref]$key, [IntPtr]::Zero)
                if ($status -eq $STATUS_OBJECT_NAME_NOT_FOUND) { return }
            } else {
                $data = [MarvinLsa]::Str($Value)
                try {
                    $status = [MarvinLsa]::LsaStorePrivateData($policy, [ref]$key, [ref]$data)
                } finally {
                    [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($data.Buffer)
                }
            }
            if ($status -ne 0) { throw "LsaStorePrivateData($KeyName) failed: Win32 error $([MarvinLsa]::LsaNtStatusToWinError($status))" }
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($key.Buffer)
        }
    }
    finally {
        [void][MarvinLsa]::LsaClose($policy)
    }
}

# ─── Log off what the account has open (EPEA-TBD-17 AC2) ───
#
# On a VM migrating from autologon, the account is signed in on the console
# right now. That is exactly what the VM team has ruled out, so it goes here,
# not at the next reboot.
function Stop-AccountSessions {
    param([string]$Name)
    Initialize-Natives
    $p = [IntPtr]::Zero; $count = 0
    if ([MarvinLsa]::WTSEnumerateSessionsW([IntPtr]::Zero, 0, 1, [ref]$p, [ref]$count) -eq 0) { return @() }
    $ids = @()
    try {
        $size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarvinLsa+WTS_SESSION_INFO])
        for ($i = 0; $i -lt $count; $i++) {
            $info = [Runtime.InteropServices.Marshal]::PtrToStructure([IntPtr]($p.ToInt64() + $i * $size), [type][MarvinLsa+WTS_SESSION_INFO])
            if ($info.SessionId -eq 0) { continue }
            $buf = [IntPtr]::Zero; $bytes = 0
            if ([MarvinLsa]::WTSQuerySessionInformationW([IntPtr]::Zero, $info.SessionId, 5, [ref]$buf, [ref]$bytes)) {
                $user = [Runtime.InteropServices.Marshal]::PtrToStringUni($buf)
                [MarvinLsa]::WTSFreeMemory($buf)
                if ($user -ieq $Name) { $ids += $info.SessionId }
            }
        }
    } finally { [MarvinLsa]::WTSFreeMemory($p) }
    foreach ($id in $ids) { [void][MarvinLsa]::WTSLogoffSession([IntPtr]::Zero, $id, $true) }
    return $ids
}

# ─── Access to the run directories ───
#
# The service also does this at startup, but it can only do it once the account
# file exists, and on a fresh machine the service starts before this script has
# ever run. Do it here too: this is the point at which the account definitely
# exists. Per directory, never the data directory itself, which holds the
# schedule store, the encrypted secrets and the master key.
function Grant-RunDirectoryAccess {
    param([string]$Account, [string]$DataDir)

    $principal = "$env:COMPUTERNAME\$Account"
    $failures = @()

    $grants = @(
        @{ dir = "runners";  rights = "(OI)(CI)RX" },
        @{ dir = "utils";    rights = "(OI)(CI)RX" },
        @{ dir = "builtins"; rights = "(OI)(CI)RX" },
        @{ dir = "repo";     rights = "(OI)(CI)RX" },
        @{ dir = "tmp";      rights = "(OI)(CI)M" }
    )

    foreach ($grant in $grants) {
        $target = Join-Path $DataDir $grant.dir
        if (-not (Test-Path $target)) { New-Item -Path $target -ItemType Directory -Force | Out-Null }

        # No /Q: icacls exits zero for a principal it could not resolve, so its
        # output is the only signal that the grant did nothing.
        $output = & icacls.exe $target /grant "$($principal):$($grant.rights)" /C 2>&1 | Out-String
        if ($output -match "Failed processing [1-9]|Invalid parameter|No mapping between account names") {
            $failures += "$($grant.dir): $($output.Trim())"
        }
    }

    if ($failures.Count -gt 0) {
        return @{ granted = $false; detail = "Some run directory permissions were not granted: $($failures -join '; ')" }
    }
    return @{ granted = $true }
}

# ─── The old keep-alive (EPEA-TBD-18 AC3) ───
#
# It kept a permanent autologon session from hitting the inactivity limit.
# Sessions now last only as long as a run, so it is removed.
function Remove-KeepAwakeTask {
    $taskName = "Marvin keep automation session awake"
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) { return $false }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    return $true
}

# ─── Run ───

Assert-Elevated

$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
$SecretName = 'L$MarvinAutomationPassword'
$warnings = @()
$rights = $null
$loggedOff = @()
$autologonRemoved = $false

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

    Set-LsaSecret -KeyName $SecretName -Value $password
    $password = $null
    $secure = $null
    [gc]::Collect()

    # ─── Autologon off (EPEA-TBD-17 AC2) ───
    # Only Marvin's own autologon is undone. Autologon for some other account
    # is not this script's to remove, but it is still reported, because the
    # VM team has ruled out autologon on this VM whoever it is for.
    $wasOn = ((Get-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -ErrorAction SilentlyContinue).AutoAdminLogon -eq "1")
    $defaultUser = (Get-ItemProperty -Path $winlogon -Name "DefaultUserName" -ErrorAction SilentlyContinue).DefaultUserName
    if (-not $defaultUser -or ($defaultUser -ieq $Account)) {
        Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -Value "0" -Type String
        Remove-ItemProperty -Path $winlogon -Name "DefaultUserName" -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $winlogon -Name "DefaultDomainName" -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $winlogon -Name "DefaultPassword" -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $winlogon -Name "AutoLogonCount" -ErrorAction SilentlyContinue
        # The old setup put the password where Winlogon reads it. That copy is
        # now stale (the password was just reset) and has no reader, so it goes.
        Set-LsaSecret -KeyName "DefaultPassword" -Value $null
        $autologonRemoved = $wasOn
    } elseif ($wasOn) {
        $warnings += "Autologon is configured for another account ($defaultUser). This script leaves it alone, but the VM team does not allow autologon on this VM, and Marvin's startup check will show it red."
    }

    # Hidden from the sign-in screen's user list.
    $userList = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"
    if (-not (Test-Path $userList)) { New-Item -Path $userList -Force | Out-Null }
    Set-ItemProperty -Path $userList -Name $Account -Value 0 -Type DWord

    $rights = Set-LogonRights -Sid $sid
    if (-not $rights.rdpAllowed) {
        $warnings += "$Account could not be given the Remote Desktop logon right. A domain Group Policy may be setting 'Deny log on through Remote Desktop Services' or 'Allow log on through Remote Desktop Services'; the VM team has to change it there. Until then, no session can be started for desktop runs."
    }

    $loggedOff = @(Stop-AccountSessions -Name $Account)

    # Read and execute on the install directory, so the run can load node and
    # the server's node_modules.
    if ($AppDir) {
        & icacls.exe $AppDir /grant "$($env:COMPUTERNAME)\$($Account):(OI)(CI)RX" /C /Q | Out-Null
    } else {
        $warnings += "No -AppDir was given. The automation account still needs read and execute on Marvin's install directory, or scheduled desktop runs cannot load node_modules."
    }

    if (-not (Test-Path $DataDir)) { New-Item -Path $DataDir -ItemType Directory -Force | Out-Null }
    # WriteAllText, not Set-Content -Encoding UTF8: Windows PowerShell 5.1
    # writes a byte-order mark with that switch, and the service parses this
    # file as JSON, which a BOM breaks.
    $accountFile = Join-Path $DataDir "automation-account.json"
    $accountJson = @{
        user = $Account
        configuredAt = (Get-Date).ToString("o")
        sessionMode = "on-demand"
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText($accountFile, $accountJson, (New-Object System.Text.UTF8Encoding($false)))
} else {
    $sid = Get-AccountSid -Name $Account
}

if ((Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections -ne 0) {
    $warnings += "Remote Desktop is turned off on this machine. Sessions for desktop runs are opened over RDP from the machine to itself, so it has to be on."
}

$settings = Set-NoLockSettings -Sid $sid
if (-not $settings.applied) { $warnings += $settings.detail }

$inactivity = Test-MachineInactivityLimit
if ($inactivity) { $warnings += $inactivity }

$keepAwakeRemoved = Remove-KeepAwakeTask

$access = Grant-RunDirectoryAccess -Account $Account -DataDir $DataDir
if (-not $access.granted) { $warnings += $access.detail }

@{
    ok = $true
    user = $Account
    sid = $sid
    sessionMode = "on-demand"
    autologonTurnedOff = $autologonRemoved
    sessionsLoggedOff = $loggedOff
    rdpLogonAllowed = if ($rights) { $rights.rdpAllowed } else { $null }
    lockSettingsApplied = $settings.applied
    keepAwakeTaskRemoved = $keepAwakeRemoved
    runDirectoryAccessGranted = $access.granted
    warnings = $warnings
    next = "No reboot needed. Open Marvin: the Desktop Session row should be green, and Test session should start a session, answer, and log it off. After the first session exists, re-run this with -Mode settings to apply the per-user no-lock settings."
} | ConvertTo-Json -Depth 4
