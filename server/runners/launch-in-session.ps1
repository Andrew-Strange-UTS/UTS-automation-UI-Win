<#
    launch-in-session.ps1

    Runs a process in an interactive Windows session, from a service that lives
    in Session 0.

    The scheduler service runs as LocalSystem, so everything it spawns inherits
    Session 0, which has its own window station and no interactive desktop.
    SendKeys there fails with "Access is denied" and screen capture with "The
    handle is invalid". Web tests do not care; desktop tests cannot work at all.

    So: find the automation account's session, take its token (LocalSystem can,
    without any password), and create the process in that session on
    winsta0\default.

    There is no session between runs (EPEA-TBD-17): autologon is not allowed on
    the VM. The service opens one for a run by making an RDP connection from the
    VM to itself (127.0.0.2), so it is never the console session, and logs it off
    afterwards.

    Modes:
      config       Report, without starting anything, whether an on-demand
                   session is possible: account exists, password stored, RDP
                   on, the account allowed RDP logon, and autologon off.
      start        Open a loopback RDP session as the account and report its id.
      logoff       Log off every session the account has, and close the client.
      probe        Report whether a usable session exists, proved by launching
                   a short-lived child in it that opens the input desktop.
      launch       Start a command in that session. With -Wait, exits with the
                   child's exit code.
      desktopcheck Runs *inside* the session as the child of a probe. Exits 0
                   when the input desktop can be opened, 2 when it cannot
                   (a locked session).

    Every mode except desktopcheck writes a single line of JSON to stdout.
#>

[CmdletBinding()]
param(
    [ValidateSet("probe", "launch", "desktopcheck", "diagnose", "config", "start", "logoff")]
    [string]$Mode = "probe",

    # The automation account whose session to use. Local account, name only.
    [string]$User,

    # For -Mode launch. Passed to CreateProcessAsUser as the command line.
    [string]$CommandLine,

    [string]$WorkingDirectory,

    # The executable to start. Passing this explicitly is not optional in
    # practice: see the comment in probe mode.
    [string]$ApplicationName,

    # Wait for the launched process and exit with its code.
    [switch]$Wait,

    [int]$TimeoutSeconds = 30,

    # For -Mode logoff: the RDP client that -Mode start reported, closed if the
    # logoff did not close it.
    [int]$ClientPid = 0,

    [string]$DataDir = "C:\ProgramData\uts-automation"
)

$ErrorActionPreference = "Stop"

# ─── Reason codes, matched by server/utils/sessionLauncher.js ───
#   ok             a usable session was found (and the probe child proved it)
#   not-windows    wrong platform
#   no-session     the account is not logged on
#   locked         logged on, but the input desktop cannot be opened
#   token-denied   the session exists but its token could not be taken
#   launch-failed  CreateProcessAsUser failed
#   probe-timeout  the probe child never returned
#   account-missing   the automation account does not exist
#   autologon-on      autologon is configured, which the VM team has ruled out
#   rdp-disabled      Remote Desktop is turned off on this machine
#   no-credential     the account's password is not in Marvin's LSA secret
#   rdp-denied        the account is not allowed to log on over RDP
#   config-unreadable a configuration check could not be completed
#   session-exists    -Mode start found the account already signed in
#   session-timeout   the RDP client never produced an active session
#   console-session   the new session is the console session (must never be)
#   logoff-failed     a session was still there after logoff

function Write-Result {
    param([string]$Reason, [hashtable]$Extra = @{})
    $result = @{ ok = ($Reason -eq "ok"); reason = $Reason }
    foreach ($key in $Extra.Keys) { $result[$key] = $Extra[$key] }
    Write-Output ($result | ConvertTo-Json -Compress)
}

# ─── desktopcheck: runs in the target session, no native session APIs needed ───

if ($Mode -eq "desktopcheck") {
    # OpenInputDesktop fails for a user-token process while the session is
    # locked, because the input desktop is then Winlogon's. That is the whole
    # point of this mode: it proves input is reachable rather than assuming it.
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MarvinDesktopProbe {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);
}
"@
    $DESKTOP_READOBJECTS = 0x0001
    $handle = [MarvinDesktopProbe]::OpenInputDesktop(0, $false, $DESKTOP_READOBJECTS)
    if ($handle -eq [IntPtr]::Zero) { exit 2 }
    [void][MarvinDesktopProbe]::CloseDesktop($handle)
    exit 0
}

if ($env:OS -ne "Windows_NT") {
    Write-Result "not-windows"
    exit 1
}

if (-not $User) {
    Write-Result "no-session" @{ detail = "No automation account was given." }
    exit 1
}

# ─── Native session and process APIs ───

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class MarvinSession {
    [StructLayout(LayoutKind.Sequential)]
    public struct WTS_SESSION_INFO {
        public int SessionId;
        [MarshalAs(UnmanagedType.LPWStr)] public string pWinStationName;
        public int State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern int WTSEnumerateSessionsW(IntPtr hServer, int Reserved, int Version, ref IntPtr ppSessionInfo, ref int pCount);

    [DllImport("wtsapi32.dll")]
    public static extern void WTSFreeMemory(IntPtr pMemory);

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern bool WTSQuerySessionInformationW(IntPtr hServer, int sessionId, int wtsInfoClass, out IntPtr ppBuffer, out int pBytesReturned);

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern bool WTSQueryUserToken(int sessionId, out IntPtr phToken);

    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes, int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

    [DllImport("userenv.dll", SetLastError=true)]
    public static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);

    [DllImport("userenv.dll", SetLastError=true)]
    public static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool CreateProcessAsUserW(
        IntPtr hToken, string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles,
        uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("wtsapi32.dll", SetLastError=true)]
    public static extern bool WTSLogoffSession(IntPtr hServer, int SessionId, bool bWait);

    [DllImport("kernel32.dll")]
    public static extern int WTSGetActiveConsoleSessionId();
}

public class MarvinLsaRead {
    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }

    [DllImport("advapi32.dll")] public static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, uint DesiredAccess, out IntPtr PolicyHandle);
    [DllImport("advapi32.dll")] public static extern uint LsaRetrievePrivateData(IntPtr PolicyHandle, ref LSA_UNICODE_STRING KeyName, out IntPtr PrivateData);
    [DllImport("advapi32.dll")] public static extern uint LsaFreeMemory(IntPtr Buffer);
    [DllImport("advapi32.dll")] public static extern uint LsaClose(IntPtr PolicyHandle);
    [DllImport("advapi32.dll")] public static extern int LsaNtStatusToWinError(uint Status);
}
"@

$WTS_CURRENT_SERVER = [IntPtr]::Zero
$WTSUserName = 5
$WTSActive = 0
$WTSDisconnected = 4
$TOKEN_ALL_ACCESS = 0x000F01FF
$SecurityImpersonation = 2
$TokenPrimary = 1
$CREATE_UNICODE_ENVIRONMENT = 0x00000400
$CREATE_NEW_CONSOLE = 0x00000010
$WAIT_TIMEOUT = 258

function Get-SessionUserName {
    param([int]$SessionId)
    $buffer = [IntPtr]::Zero
    $bytes = 0
    if (-not [MarvinSession]::WTSQuerySessionInformationW($WTS_CURRENT_SERVER, $SessionId, $WTSUserName, [ref]$buffer, [ref]$bytes)) {
        return $null
    }
    try { return [Runtime.InteropServices.Marshal]::PtrToStringUni($buffer) }
    finally { [MarvinSession]::WTSFreeMemory($buffer) }
}

# The automation account's session. An Active session is preferred; a
# Disconnected one still has a desktop, but it renders nothing, which is what
# turns scheduled screenshots black, so it is reported rather than hidden.
function Find-AutomationSession {
    param([string]$UserName)

    $pSessions = [IntPtr]::Zero
    $count = 0
    if ([MarvinSession]::WTSEnumerateSessionsW($WTS_CURRENT_SERVER, 0, 1, [ref]$pSessions, [ref]$count) -eq 0) {
        return $null
    }

    try {
        $size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarvinSession+WTS_SESSION_INFO])
        $found = $null
        for ($i = 0; $i -lt $count; $i++) {
            $offset = [IntPtr]($pSessions.ToInt64() + ($i * $size))
            $info = [Runtime.InteropServices.Marshal]::PtrToStructure($offset, [type][MarvinSession+WTS_SESSION_INFO])
            if ($info.SessionId -eq 0) { continue }   # Session 0 is the services session
            if ($info.State -ne $WTSActive -and $info.State -ne $WTSDisconnected) { continue }

            $name = Get-SessionUserName -SessionId $info.SessionId
            if ($name -and ($name -ieq $UserName)) {
                $candidate = [pscustomobject]@{ SessionId = $info.SessionId; User = $name; State = $info.State }
                if ($info.State -eq $WTSActive) { return $candidate }
                if (-not $found) { $found = $candidate }
            }
        }
        return $found
    }
    finally {
        [MarvinSession]::WTSFreeMemory($pSessions)
    }
}

function Get-LoggedOnUsers {
    $pSessions = [IntPtr]::Zero
    $count = 0
    if ([MarvinSession]::WTSEnumerateSessionsW($WTS_CURRENT_SERVER, 0, 1, [ref]$pSessions, [ref]$count) -eq 0) {
        return @()
    }
    try {
        $size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarvinSession+WTS_SESSION_INFO])
        $names = @()
        for ($i = 0; $i -lt $count; $i++) {
            $offset = [IntPtr]($pSessions.ToInt64() + ($i * $size))
            $info = [Runtime.InteropServices.Marshal]::PtrToStructure($offset, [type][MarvinSession+WTS_SESSION_INFO])
            if ($info.SessionId -eq 0) { continue }
            $name = Get-SessionUserName -SessionId $info.SessionId
            if ($name) { $names += $name }
        }
        return $names
    }
    finally { [MarvinSession]::WTSFreeMemory($pSessions) }
}

function Start-InSession {
    param(
        [int]$SessionId,
        [string]$Command,
        [string]$Directory,
        [bool]$WaitForExit,
        # uint32, not int: INFINITE is 0xFFFFFFFF, which overflows Int32 and
        # would throw at parameter binding rather than waiting forever.
        [uint32]$TimeoutMs,
        # Variations, so the diagnose mode can isolate which of these Windows
        # is objecting to. Defaults are exactly what production uses.
        [string]$ApplicationName = $null,
        [string]$Desktop = "winsta0\default",
        [bool]$UseEnvironmentBlock = $true,
        [int]$CreationFlags = -1,
        # What to call a timeout. A probe that does not answer in seconds is
        # wedged; a test run that takes minutes is just a test run.
        [string]$TimeoutReason = "probe-timeout"
    )

    $userToken = [IntPtr]::Zero
    if (-not [MarvinSession]::WTSQueryUserToken($SessionId, [ref]$userToken)) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        return @{ reason = "token-denied"; win32 = $code }
    }

    $primaryToken = [IntPtr]::Zero
    $envBlock = [IntPtr]::Zero
    try {
        if (-not [MarvinSession]::DuplicateTokenEx($userToken, $TOKEN_ALL_ACCESS, [IntPtr]::Zero, $SecurityImpersonation, $TokenPrimary, [ref]$primaryToken)) {
            return @{ reason = "token-denied"; win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
        }

        # Without the user's own environment block the child gets the service's,
        # so %APPDATA% and %TEMP% point at the SYSTEM profile.
        if ($UseEnvironmentBlock) {
            if (-not [MarvinSession]::CreateEnvironmentBlock([ref]$envBlock, $primaryToken, $false)) {
                $envBlock = [IntPtr]::Zero
            }
        }

        $si = New-Object MarvinSession+STARTUPINFO
        $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
        # The interactive desktop, not Session 0's. Empty string is NOT the same
        # as null here: an empty lpDesktop is one of the documented ways to get
        # ERROR_INVALID_NAME out of CreateProcessAsUser.
        if ($Desktop) { $si.lpDesktop = $Desktop }
        $pi = New-Object MarvinSession+PROCESS_INFORMATION

        $flags = if ($CreationFlags -ge 0) { $CreationFlags } else { $CREATE_UNICODE_ENVIRONMENT -bor $CREATE_NEW_CONSOLE }
        $dir = if ($Directory) { $Directory } else { $null }
        $app = if ($ApplicationName) { $ApplicationName } else { $null }

        $ok = [MarvinSession]::CreateProcessAsUserW(
            $primaryToken, $app, $Command, [IntPtr]::Zero, [IntPtr]::Zero, $false,
            $flags, $envBlock, $dir, [ref]$si, [ref]$pi)

        if (-not $ok) {
            return @{ reason = "launch-failed"; win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
        }

        $result = @{ reason = "ok"; pid = $pi.dwProcessId }

        if ($WaitForExit) {
            # Report the id before blocking, so a run in another session can be
            # stopped: the service's own process tree does not reach into it.
            Write-Output (@{ reason = "started"; pid = $pi.dwProcessId; sessionId = $SessionId } | ConvertTo-Json -Compress)
            $waited = [MarvinSession]::WaitForSingleObject($pi.hProcess, $TimeoutMs)
            if ($waited -eq $WAIT_TIMEOUT) {
                $result.reason = $TimeoutReason
                # Do not walk away from it: without this the run keeps going in
                # that session with nobody waiting for it or reading its output.
                try { Stop-Process -Id $pi.dwProcessId -Force -ErrorAction Stop }
                catch { $result.killFailed = $_.Exception.Message }
            } else {
                # GetExitCodeProcess takes an out uint, so the variable has
                # to be one before it is passed by reference.
                $exit = [uint32]0
                [void][MarvinSession]::GetExitCodeProcess($pi.hProcess, [ref]$exit)
                $result.exitCode = [int]$exit
            }
        }

        [void][MarvinSession]::CloseHandle($pi.hThread)
        [void][MarvinSession]::CloseHandle($pi.hProcess)
        return $result
    }
    finally {
        if ($envBlock -ne [IntPtr]::Zero) { [void][MarvinSession]::DestroyEnvironmentBlock($envBlock) }
        if ($primaryToken -ne [IntPtr]::Zero) { [void][MarvinSession]::CloseHandle($primaryToken) }
        if ($userToken -ne [IntPtr]::Zero) { [void][MarvinSession]::CloseHandle($userToken) }
    }
}

# ═══ On-demand sessions (EPEA-TBD-17) ═══
#
# These modes do not need the account to be signed in, so they run before the
# session is resolved below.

# Written by scripts/setup-automation-account.ps1. "L$" makes it a local
# secret: never replicated, readable only by SYSTEM on this machine.
$SecretName = 'L$MarvinAutomationPassword'
$STATUS_OBJECT_NAME_NOT_FOUND = [uint32]3221225524   # 0xC0000034

# $null when no secret is stored. The value is never written anywhere: it goes
# straight into a DPAPI blob for the RDP client, and the variable is cleared.
function Read-AutomationSecret {
    $attrs = New-Object MarvinLsaRead+LSA_OBJECT_ATTRIBUTES
    $attrs.Length = [Runtime.InteropServices.Marshal]::SizeOf($attrs)
    $policy = [IntPtr]::Zero
    $POLICY_GET_PRIVATE_INFORMATION = 0x00000004
    $status = [MarvinLsaRead]::LsaOpenPolicy([IntPtr]::Zero, [ref]$attrs, $POLICY_GET_PRIVATE_INFORMATION, [ref]$policy)
    if ($status -ne 0) { throw "LsaOpenPolicy failed: Win32 error $([MarvinLsaRead]::LsaNtStatusToWinError($status))" }
    try {
        $key = New-Object MarvinLsaRead+LSA_UNICODE_STRING
        $key.Buffer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($SecretName)
        $key.Length = [uint16]($SecretName.Length * 2)
        $key.MaximumLength = [uint16](($SecretName.Length + 1) * 2)
        $data = [IntPtr]::Zero
        try {
            $status = [MarvinLsaRead]::LsaRetrievePrivateData($policy, [ref]$key, [ref]$data)
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($key.Buffer)
        }
        if ($status -eq $STATUS_OBJECT_NAME_NOT_FOUND) { return $null }
        if ($status -ne 0) { throw "LsaRetrievePrivateData failed: Win32 error $([MarvinLsaRead]::LsaNtStatusToWinError($status))" }
        if ($data -eq [IntPtr]::Zero) { return $null }
        try {
            $s = [Runtime.InteropServices.Marshal]::PtrToStructure($data, [type][MarvinLsaRead+LSA_UNICODE_STRING])
            if ($s.Length -eq 0) { return $null }
            return [Runtime.InteropServices.Marshal]::PtrToStringUni($s.Buffer, $s.Length / 2)
        } finally {
            [void][MarvinLsaRead]::LsaFreeMemory($data)
        }
    } finally {
        [void][MarvinLsaRead]::LsaClose($policy)
    }
}

# Every session the account has, whatever state it is in.
function Get-AccountSessions {
    param([string]$UserName)
    $pSessions = [IntPtr]::Zero
    $count = 0
    if ([MarvinSession]::WTSEnumerateSessionsW($WTS_CURRENT_SERVER, 0, 1, [ref]$pSessions, [ref]$count) -eq 0) { return @() }
    try {
        $size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarvinSession+WTS_SESSION_INFO])
        $found = @()
        for ($i = 0; $i -lt $count; $i++) {
            $info = [Runtime.InteropServices.Marshal]::PtrToStructure([IntPtr]($pSessions.ToInt64() + ($i * $size)), [type][MarvinSession+WTS_SESSION_INFO])
            if ($info.SessionId -eq 0) { continue }
            $name = Get-SessionUserName -SessionId $info.SessionId
            if ($name -and ($name -ieq $UserName)) {
                $found += [pscustomobject]@{ SessionId = $info.SessionId; Station = $info.pWinStationName; State = $info.State }
            }
        }
        return $found
    } finally {
        [MarvinSession]::WTSFreeMemory($pSessions)
    }
}

function Format-Sessions {
    param($Sessions)
    return @($Sessions | ForEach-Object { "$($_.SessionId) $($_.Station) state=$($_.State)" })
}

function Test-RdpEnabled {
    $value = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections
    return ($value -eq 0)
}

function Test-AutologonConfigured {
    $value = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon
    return ("$value" -eq "1")
}

# Loopback RDP is a Remote Desktop logon, so the account needs to be outside
# "Deny log on through Remote Desktop Services" and inside Remote Desktop Users.
function Get-RdpLogonRights {
    param([string]$Sid)
    $export = Join-Path $env:TEMP ("marvin-rights-" + [guid]::NewGuid().ToString("N") + ".inf")
    try {
        & secedit.exe /export /cfg $export /areas USER_RIGHTS /quiet | Out-Null
        if (-not (Test-Path $export)) { throw "secedit did not export the user rights" }
        $line = Select-String -Path $export -Pattern "^SeDenyRemoteInteractiveLogonRight\s*=" | Select-Object -First 1
        $denied = $false
        if ($line) { $denied = (($line.Line -split "=", 2)[1] -match [regex]::Escape("*$Sid")) }
    } finally {
        Remove-Item $export -ErrorAction SilentlyContinue
    }
    $members = @(Get-LocalGroupMember -SID "S-1-5-32-555" -ErrorAction Stop)
    $inGroup = [bool]($members | Where-Object { $_.SID -and $_.SID.Value -eq $Sid })
    return @{ denied = $denied; inRemoteDesktopUsers = $inGroup; allowed = ((-not $denied) -and $inGroup) }
}

if ($Mode -eq "config") {
    if (-not (Get-LocalUser -Name $User -ErrorAction SilentlyContinue)) {
        Write-Result "account-missing" @{ user = $User; detail = "There is no local account called $User." }
        exit 1
    }

    $facts = @{ user = $User; consoleSessionId = [MarvinSession]::WTSGetActiveConsoleSessionId() }
    try {
        $facts.autologon = Test-AutologonConfigured
        $facts.rdpEnabled = Test-RdpEnabled
        $secret = Read-AutomationSecret
        $facts.credentialStored = [bool]$secret
        $secret = $null
        $sid = (New-Object Security.Principal.NTAccount("$env:COMPUTERNAME\$User")).Translate([Security.Principal.SecurityIdentifier]).Value
        $rights = Get-RdpLogonRights -Sid $sid
        $facts.rdpLogonDenied = $rights.denied
        $facts.inRemoteDesktopUsers = $rights.inRemoteDesktopUsers
        $facts.sessions = Format-Sessions (Get-AccountSessions -UserName $User)
    } catch {
        $facts.detail = $_.Exception.Message
        Write-Result "config-unreadable" $facts
        exit 1
    }

    # Autologon first: it is the configuration the VM team has ruled out, so it
    # outranks anything that merely stops desktop schedules working.
    $reason = if ($facts.autologon) { "autologon-on" }
        elseif (-not $facts.rdpEnabled) { "rdp-disabled" }
        elseif (-not $facts.credentialStored) { "no-credential" }
        elseif ($facts.rdpLogonDenied -or -not $facts.inRemoteDesktopUsers) { "rdp-denied" }
        else { "ok" }
    Write-Result $reason $facts
    if ($reason -ne "ok") { exit 1 }
    exit 0
}

if ($Mode -eq "start") {
    if (-not (Test-RdpEnabled)) {
        Write-Result "rdp-disabled" @{ user = $User }
        exit 1
    }

    # An RDP logon reconnects to an existing session rather than creating one,
    # so a leftover would be reused as-is. The lease logs leftovers off first;
    # this is the check that it did.
    $existing = @(Get-AccountSessions -UserName $User | Where-Object { $_.State -eq $WTSActive -or $_.State -eq $WTSDisconnected })
    if ($existing.Count -gt 0) {
        Write-Result "session-exists" @{ user = $User; sessions = (Format-Sessions $existing) }
        exit 1
    }

    $password = Read-AutomationSecret
    if (-not $password) {
        Write-Result "no-credential" @{ user = $User }
        exit 1
    }

    # The password reaches mstsc as a DPAPI blob (CurrentUser scope, which is
    # SYSTEM here) inside a SYSTEM-only .rdp file. Never a command line, which
    # any administrator can read, and never Credential Manager, which would be a
    # second copy. The file goes as soon as the session exists.
    $rdpDir = Join-Path $env:SystemRoot ("Temp\marvin-rdp-" + [guid]::NewGuid().ToString("N"))
    $clientPid = 0
    try {
        New-Item -Path $rdpDir -ItemType Directory -Force | Out-Null
        & icacls.exe $rdpDir /inheritance:r /grant "*S-1-5-18:(OI)(CI)F" /Q | Out-Null
        $secure = ConvertTo-SecureString $password -AsPlainText -Force
        $password = $null
        $blob = ConvertFrom-SecureString $secure
        $secure = $null
        $rdpFile = Join-Path $rdpDir "session.rdp"
        @(
            "full address:s:127.0.0.2",
            "username:s:$env:COMPUTERNAME\$User",
            "password 51:b:$blob",
            "prompt for credentials:i:0",
            "promptcredentialonce:i:0",
            "authentication level:i:0",
            "enablecredsspsupport:i:1",
            "negotiate security layer:i:1",
            "screen mode id:i:1",
            "desktopwidth:i:1920",
            "desktopheight:i:1080",
            "session bpp:i:32",
            "redirectclipboard:i:0",
            "redirectprinters:i:0",
            "redirectdrives:i:0",
            "redirectsmartcards:i:0",
            "audiomode:i:2",
            "autoreconnection enabled:i:1",
            "connection type:i:7",
            "networkautodetect:i:0"
        ) | Set-Content -Path $rdpFile -Encoding Unicode
        $blob = $null

        $began = Get-Date
        $client = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\mstsc.exe") -ArgumentList "`"$rdpFile`"" -PassThru
        $clientPid = $client.Id

        $session = $null
        $deadline = $began.AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline) {
            $session = Get-AccountSessions -UserName $User | Where-Object { $_.State -eq $WTSActive } | Select-Object -First 1
            if ($session) { break }
            if ($client.HasExited) { break }
            Start-Sleep -Milliseconds 500
        }
    } finally {
        $password = $null
        Remove-Item $rdpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not $session) {
        $extra = @{
            user = $User
            clientPid = $clientPid
            clientExited = [bool]$client.HasExited
            sessions = (Format-Sessions (Get-AccountSessions -UserName $User))
            timeoutSeconds = $TimeoutSeconds
        }
        if ($client.HasExited) { $extra.clientExitCode = $client.ExitCode }
        # A disconnected leftover means the logon happened and the client died;
        # report its id so the caller logs it off.
        $leftover = Get-AccountSessions -UserName $User | Select-Object -First 1
        if ($leftover) { $extra.sessionId = $leftover.SessionId }
        Write-Result "session-timeout" $extra
        exit 1
    }

    $console = [MarvinSession]::WTSGetActiveConsoleSessionId()
    $extra = @{
        user = $User
        sessionId = $session.SessionId
        station = $session.Station
        clientPid = $clientPid
        consoleSessionId = $console
        seconds = [int]((Get-Date) - $began).TotalSeconds
    }
    # The whole point is that the VMware console never shows this desktop. If
    # it somehow is the console session, refuse it rather than run in it.
    if ($session.SessionId -eq $console -or $session.Station -notlike "RDP-Tcp#*") {
        Write-Result "console-session" $extra
        exit 1
    }
    Write-Result "ok" $extra
    exit 0
}

if ($Mode -eq "logoff") {
    $targets = @(Get-AccountSessions -UserName $User)
    $failures = @()
    foreach ($s in $targets) {
        if (-not [MarvinSession]::WTSLogoffSession($WTS_CURRENT_SERVER, $s.SessionId, $true)) {
            $failures += "$($s.SessionId): Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
    }

    # The client normally exits by itself once its session is gone. Only ever
    # close the process -Mode start reported, and only if it is still mstsc:
    # process ids are reused.
    if ($ClientPid -gt 0) {
        $proc = Get-Process -Id $ClientPid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -ieq "mstsc") {
            if (-not $proc.WaitForExit(5000)) {
                try { $proc.Kill() } catch { $failures += "client $($ClientPid): $($_.Exception.Message)" }
            }
        }
    }

    # Checked, not assumed: WTSLogoffSession returning true is not proof.
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $left = @(Get-AccountSessions -UserName $User)
        if ($left.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    $extra = @{ user = $User; loggedOff = @($targets | ForEach-Object { $_.SessionId }) }
    if ($left.Count -gt 0 -or $failures.Count -gt 0) {
        $extra.remaining = Format-Sessions $left
        $extra.failures = $failures
        Write-Result "logoff-failed" $extra
        exit 1
    }
    Write-Result "ok" $extra
    exit 0
}

# ─── Resolve the session ───

$session = Find-AutomationSession -UserName $User
if (-not $session) {
    $others = @(Get-LoggedOnUsers)
    Write-Result "no-session" @{ user = $User; others = $others; detail = "$User is not logged on. The automation account's session provides the desktop that scheduled desktop tests run on." }
    exit 1
}

$stateName = if ($session.State -eq $WTSActive) { "active" } else { "disconnected" }

# ─── probe ───

if ($Mode -eq "probe") {
    # The probe child runs as the automation account, which has no read access
    # to this script: it lives either in the installing user's profile or in the
    # locked-down shared data directory. So the child is passed inline as an
    # encoded command and needs no file at all.
    $childScript = @'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MarvinDesktopProbe {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);
}
"@
$handle = [MarvinDesktopProbe]::OpenInputDesktop(0, $false, 0x0001)
if ($handle -eq [IntPtr]::Zero) { exit 2 }
[void][MarvinDesktopProbe]::CloseDesktop($handle)
exit 0
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
    $child = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"

    # Both an explicit application name AND an explicit working directory, which
    # is the only combination this works with. Measured with -Mode diagnose on
    # the VM: application name alone, working directory alone, no desktop and no
    # environment block all failed (123, and 3 for the directory on its own);
    # the two together succeeded. A NULL working directory means "inherit the
    # service's", and the service's is not somewhere the target user can be.
    $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $system32 = Join-Path $env:SystemRoot "System32"
    $outcome = Start-InSession -SessionId $session.SessionId -Command $child -Directory $system32 `
        -WaitForExit $true -TimeoutMs ($TimeoutSeconds * 1000) -ApplicationName $powershellPath

    if ($outcome.reason -ne "ok") {
        Write-Result $outcome.reason @{ user = $User; sessionId = $session.SessionId; state = $stateName; win32 = $outcome.win32 }
        exit 1
    }

    if ($outcome.exitCode -eq 0) {
        Write-Result "ok" @{
            user = $User
            sessionId = $session.SessionId
            state = $stateName
        }
        exit 0
    }

    if ($outcome.exitCode -eq 2) {
        Write-Result "locked" @{ user = $User; sessionId = $session.SessionId; state = $stateName; detail = "The session is logged on but its input desktop cannot be opened, which means it is locked. Input cannot be sent to a locked desktop." }
        exit 1
    }

    Write-Result "launch-failed" @{ user = $User; sessionId = $session.SessionId; state = $stateName; exitCode = $outcome.exitCode; detail = "The probe process started but returned $($outcome.exitCode)." }
    exit 1
}

# ─── diagnose ───
#
# CreateProcessAsUser can fail for several unrelated reasons that all surface as
# one Win32 error, so try the variants and report what each one does. Runs
# through Start-InSession, the same function production uses, varying one input
# at a time.

if ($Mode -eq "diagnose") {
    $childScript = 'exit 0'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
    $cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
    $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

    $variants = @(
        @{ name = "as production (app=null, desktop=winsta0\default, env block, new console)"; args = @{} },
        @{ name = "explicit application name"; args = @{ ApplicationName = $powershellPath } },
        @{ name = "no desktop (inherit)"; args = @{ Desktop = $null } },
        @{ name = "no environment block"; args = @{ UseEnvironmentBlock = $false; CreationFlags = 16 } },
        @{ name = "working directory System32"; args = @{ Directory = (Join-Path $env:SystemRoot "System32") } },
        @{ name = "CREATE_NO_WINDOW instead of CREATE_NEW_CONSOLE"; args = @{ CreationFlags = 134218752 } },
        @{ name = "explicit app name + System32 working directory"; args = @{ ApplicationName = $powershellPath; Directory = (Join-Path $env:SystemRoot "System32") } }
    )

    $results = @()
    foreach ($variant in $variants) {
        $splat = @{
            SessionId = $session.SessionId
            Command = $cmd
            Directory = $null
            WaitForExit = $true
            TimeoutMs = 15000
        }
        foreach ($key in $variant.args.Keys) { $splat[$key] = $variant.args[$key] }

        $outcome = Start-InSession @splat
        $results += [pscustomobject]@{
            variant = $variant.name
            reason = $outcome.reason
            win32 = $outcome.win32
            exitCode = $outcome.exitCode
        }
    }

    Write-Output (@{
        ok = [bool]($results | Where-Object { $_.reason -eq "ok" })
        reason = "diagnose"
        user = $User
        sessionId = $session.SessionId
        state = $stateName
        results = $results
    } | ConvertTo-Json -Depth 4 -Compress)
    exit 0
}

# ─── launch ───

if (-not $CommandLine) {
    Write-Result "launch-failed" @{ detail = "No command line was given." }
    exit 1
}

# A scheduled run has no business being cut off after the probe's timeout.
# -TimeoutSeconds 0 means wait indefinitely; a run is stopped through the
# scheduler's own Stop, which kills the process directly.
$WAIT_INFINITE = [uint32]::MaxValue
$timeoutMs = if (-not $Wait) { 0 } elseif ($TimeoutSeconds -le 0) { $WAIT_INFINITE } else { $TimeoutSeconds * 1000 }

# Same rule as the probe: never leave either of these to be inferred. A working
# directory is required even when the caller does not care what it is.
$launchDir = if ($WorkingDirectory) { $WorkingDirectory } else { Join-Path $env:SystemRoot "System32" }
$launchApp = if ($ApplicationName) { $ApplicationName } else { Join-Path $env:SystemRoot "System32\cmd.exe" }

$outcome = Start-InSession -SessionId $session.SessionId -Command $CommandLine -Directory $launchDir `
    -WaitForExit ([bool]$Wait) -TimeoutMs $timeoutMs -ApplicationName $launchApp -TimeoutReason "run-timeout"

$extra = @{ user = $User; sessionId = $session.SessionId; state = $stateName }
foreach ($key in $outcome.Keys) { if ($key -ne "reason") { $extra[$key] = $outcome[$key] } }
Write-Result $outcome.reason $extra

if ($outcome.reason -ne "ok") { exit 1 }
if ($Wait) { exit ([int]$outcome.exitCode) }
exit 0
