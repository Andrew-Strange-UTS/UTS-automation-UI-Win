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

    Modes:
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
    [ValidateSet("probe", "launch", "desktopcheck")]
    [string]$Mode = "probe",

    # The automation account whose session to use. Local account, name only.
    [string]$User,

    # For -Mode launch. Passed to CreateProcessAsUser as the command line.
    [string]$CommandLine,

    [string]$WorkingDirectory,

    # Wait for the launched process and exit with its code.
    [switch]$Wait,

    [int]$TimeoutSeconds = 30
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
    param([int]$SessionId, [string]$Command, [string]$Directory, [bool]$WaitForExit, [int]$TimeoutMs)

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
        if (-not [MarvinSession]::CreateEnvironmentBlock([ref]$envBlock, $primaryToken, $false)) {
            $envBlock = [IntPtr]::Zero
        }

        $si = New-Object MarvinSession+STARTUPINFO
        $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
        $si.lpDesktop = "winsta0\default"   # the interactive desktop, not Session 0's
        $pi = New-Object MarvinSession+PROCESS_INFORMATION

        $flags = $CREATE_UNICODE_ENVIRONMENT -bor $CREATE_NEW_CONSOLE
        $dir = if ($Directory) { $Directory } else { $null }

        $ok = [MarvinSession]::CreateProcessAsUserW(
            $primaryToken, $null, $Command, [IntPtr]::Zero, [IntPtr]::Zero, $false,
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
                $result.reason = "probe-timeout"
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
    $outcome = Start-InSession -SessionId $session.SessionId -Command $child -Directory $null -WaitForExit $true -TimeoutMs ($TimeoutSeconds * 1000)

    if ($outcome.reason -ne "ok") {
        Write-Result $outcome.reason @{ user = $User; sessionId = $session.SessionId; state = $stateName; win32 = $outcome.win32 }
        exit 1
    }

    if ($outcome.exitCode -eq 0) {
        Write-Result "ok" @{ user = $User; sessionId = $session.SessionId; state = $stateName }
        exit 0
    }

    if ($outcome.exitCode -eq 2) {
        Write-Result "locked" @{ user = $User; sessionId = $session.SessionId; state = $stateName; detail = "The session is logged on but its input desktop cannot be opened, which means it is locked. Input cannot be sent to a locked desktop." }
        exit 1
    }

    Write-Result "launch-failed" @{ user = $User; sessionId = $session.SessionId; state = $stateName; exitCode = $outcome.exitCode; detail = "The probe process started but returned $($outcome.exitCode)." }
    exit 1
}

# ─── launch ───

if (-not $CommandLine) {
    Write-Result "launch-failed" @{ detail = "No command line was given." }
    exit 1
}

$timeoutMs = if ($Wait) { $TimeoutSeconds * 1000 } else { 0 }
$outcome = Start-InSession -SessionId $session.SessionId -Command $CommandLine -Directory $WorkingDirectory -WaitForExit ([bool]$Wait) -TimeoutMs $timeoutMs

$extra = @{ user = $User; sessionId = $session.SessionId; state = $stateName }
foreach ($key in $outcome.Keys) { if ($key -ne "reason") { $extra[$key] = $outcome[$key] } }
Write-Result $outcome.reason $extra

if ($outcome.reason -ne "ok") { exit 1 }
if ($Wait) { exit ([int]$outcome.exitCode) }
exit 0
