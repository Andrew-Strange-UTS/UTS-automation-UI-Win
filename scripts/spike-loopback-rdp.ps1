<#
    spike-loopback-rdp.ps1   (EPEA-TBD-17 AC1)

    Answers one question before any production code is written: can the
    scheduler service, running as SYSTEM in Session 0, open an RDP session from
    this VM to itself as the automation account, and drive a desktop in it?

    Run it from an elevated PowerShell on the VM:

        powershell -ExecutionPolicy Bypass -File scripts\spike-loopback-rdp.ps1

    It registers a one-off scheduled task that runs this same script as SYSTEM,
    because that is the context the service runs in and the only one whose
    result means anything. It waits for that task, prints the report, and
    removes the task.

    What the SYSTEM half does, in order, recording every step:
      1. Records the machine: OS, RDP enabled, NLA, Remote Desktop Services
         licensing, the console session, and who is signed in.
      2. Reads the account's password from the autologon LSA secret, which is
         where it is today. It is held in memory only.
      3. Temporarily lets the account log on over RDP (removes it from "Deny
         log on through Remote Desktop Services" and adds it to Remote Desktop
         Users), because that is what loopback RDP needs.
      4. Pauses autologon (AutoAdminLogon 0) and logs off the account's
         existing session. Without the pause, Winlogon signs the account
         straight back in on the console, and the spike would measure that
         instead of RDP. Autologon is put back at the end.
      5. Starts the RDP client against 127.0.0.2 as the account, with no
         visible window. The password goes in as a DPAPI-encrypted blob in a
         SYSTEM-only .rdp file that is deleted as soon as the session exists.
      6. Waits for the session, and records whether it is an RDP session and
         whether it is the console session (it must not be).
      7. Runs Marvin's own session probe against it.
      8. Runs Marvin's real desktop driver inside it: opens Notepad, types a
         marker, takes a screenshot, OCRs it, and checks the marker came back.
         Also checks the screenshot is not blank.
      9. Logs the session off, closes the client, and checks the session is
         gone.
     10. Puts the RDP logon rights back the way they were (unless -KeepRdpRight).

    Afterwards the account is no longer signed in, so scheduled desktop runs on
    the current (autologon) build will fail until the VM is rebooted. Reboot
    when the spike is done, or leave it if the migration is next anyway.

    Nothing here prints, logs or saves the password.

      -Account       automation account (default marvin-auto)
      -AppDir        Marvin's install directory (default C:\Program Files\Marvin)
      -DataDir       Marvin's data directory (default C:\ProgramData\uts-automation)
      -Client        mstsc (default) or freerdp
      -FreeRdpPath   path to wfreerdp.exe, for -Client freerdp
      -KeepRdpRight  leave the RDP logon right granted afterwards
#>

[CmdletBinding()]
param(
    [string]$Account = "marvin-auto",
    [string]$AppDir = "C:\Program Files\Marvin",
    [string]$DataDir = "C:\ProgramData\uts-automation",
    [ValidateSet("mstsc", "freerdp")]
    [string]$Client = "mstsc",
    [string]$FreeRdpPath,
    [switch]$KeepRdpRight,
    [int]$SessionWaitSeconds = 90,

    # Internal: set when this script is re-run as SYSTEM by the scheduled task.
    [switch]$AsSystem,
    [string]$ReportPath
)

$ErrorActionPreference = "Stop"
$TaskName = "Marvin loopback RDP spike"

# ═══════════════════════════════════════════════════════════════════════════
#  Outer half: runs as the admin who launched it
# ═══════════════════════════════════════════════════════════════════════════

if (-not $AsSystem) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this from an elevated PowerShell. It registers a task that runs as SYSTEM."
    }

    $spikeDir = Join-Path $DataDir "tmp\spike"
    New-Item -Path $spikeDir -ItemType Directory -Force | Out-Null
    $report = Join-Path $spikeDir ("report-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")

    $argList = @(
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"",
        "-AsSystem", "-ReportPath", "`"$report`"",
        "-Account", $Account,
        "-AppDir", "`"$AppDir`"",
        "-DataDir", "`"$DataDir`"",
        "-Client", $Client,
        "-SessionWaitSeconds", $SessionWaitSeconds
    )
    if ($FreeRdpPath) { $argList += @("-FreeRdpPath", "`"$FreeRdpPath`"") }
    if ($KeepRdpRight) { $argList += "-KeepRdpRight" }

    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($argList -join " ")
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

    # schtasks.exe writes to stderr when the task is missing. Under
    # ErrorActionPreference Stop, PowerShell 5.1 turns that into a terminating
    # error, so it runs here with Continue and the output comes back as text.
    function Invoke-Schtasks {
        $ErrorActionPreference = "Continue"
        $out = & schtasks.exe @args 2>&1 | ForEach-Object { "$_" }
        [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
    }

    [void](Invoke-Schtasks /Delete /TN $TaskName /F)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings | Out-Null

    # The task is watched through schtasks.exe and the report file, not the
    # ScheduledTasks cmdlets: those ride on a CIM session that can drop part
    # way through ("Call was canceled by the message filter"), which used to
    # abort the wait while the SYSTEM half was still running.
    try {
        Write-Host "Running the spike as SYSTEM. This takes a minute or two..."
        $run = Invoke-Schtasks /Run /TN $TaskName
        if ($run.Code -ne 0) { throw "schtasks /Run failed ($($run.Code)): $($run.Output -join ' ')" }
        $deadline = (Get-Date).AddMinutes(15)
        Start-Sleep -Seconds 3
        while ((Get-Date) -lt $deadline) {
            if (Test-Path $report) {
                $query = Invoke-Schtasks /Query /TN $TaskName /FO CSV /NH
                if (($query.Output -join "") -notmatch '"Running"') { break }
            }
            Start-Sleep -Seconds 2
        }
        if (-not (Test-Path $report)) {
            $detail = ((Invoke-Schtasks /Query /TN $TaskName /V /FO LIST).Output | Select-String "Last Result|Status") -join "; "
            throw "The SYSTEM task did not write a report within 15 minutes. $detail"
        }
        Get-Content $report -Raw
        Write-Host ""
        Write-Host "Report saved to $report"
        Write-Host "Send that file back. It contains no password."
    }
    finally {
        if ((Invoke-Schtasks /Delete /TN $TaskName /F).Code -ne 0) {
            Write-Warning "Could not remove the task '$TaskName'. Remove it with: schtasks /Delete /TN `"$TaskName`" /F"
        }
    }
    exit 0
}

# ═══════════════════════════════════════════════════════════════════════════
#  Inner half: runs as SYSTEM in Session 0, like the scheduler service
# ═══════════════════════════════════════════════════════════════════════════

$steps = New-Object System.Collections.ArrayList
$facts = [ordered]@{}
$verdict = [ordered]@{}

function Step {
    param([string]$Name, [bool]$Ok, $Detail = $null)
    [void]$steps.Add([ordered]@{ step = $Name; ok = $Ok; detail = $Detail; at = (Get-Date).ToString("HH:mm:ss") })
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SpikeNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WTS_SESSION_INFO { public int SessionId; [MarshalAs(UnmanagedType.LPWStr)] public string pWinStationName; public int State; }

    [DllImport("advapi32.dll")] public static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, uint DesiredAccess, out IntPtr PolicyHandle);
    [DllImport("advapi32.dll")] public static extern uint LsaRetrievePrivateData(IntPtr PolicyHandle, ref LSA_UNICODE_STRING KeyName, out IntPtr PrivateData);
    [DllImport("advapi32.dll")] public static extern uint LsaFreeMemory(IntPtr Buffer);
    [DllImport("advapi32.dll")] public static extern uint LsaClose(IntPtr PolicyHandle);
    [DllImport("advapi32.dll")] public static extern int LsaNtStatusToWinError(uint Status);

    [DllImport("wtsapi32.dll", SetLastError=true)] public static extern int WTSEnumerateSessionsW(IntPtr hServer, int Reserved, int Version, ref IntPtr ppSessionInfo, ref int pCount);
    [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr pMemory);
    [DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSQuerySessionInformationW(IntPtr hServer, int sessionId, int wtsInfoClass, out IntPtr ppBuffer, out int pBytesReturned);
    [DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSLogoffSession(IntPtr hServer, int SessionId, bool bWait);
    [DllImport("kernel32.dll")] public static extern int WTSGetActiveConsoleSessionId();

    public static LSA_UNICODE_STRING Str(string value) {
        LSA_UNICODE_STRING s = new LSA_UNICODE_STRING();
        s.Buffer = Marshal.StringToHGlobalUni(value);
        s.Length = (ushort)(value.Length * 2);
        s.MaximumLength = (ushort)((value.Length + 1) * 2);
        return s;
    }
}
"@

$WTSActive = 0
$WTSDisconnected = 4

function Get-Sessions {
    $p = [IntPtr]::Zero; $count = 0
    if ([SpikeNative]::WTSEnumerateSessionsW([IntPtr]::Zero, 0, 1, [ref]$p, [ref]$count) -eq 0) { return @() }
    try {
        $size = [Runtime.InteropServices.Marshal]::SizeOf([type][SpikeNative+WTS_SESSION_INFO])
        $out = @()
        for ($i = 0; $i -lt $count; $i++) {
            $info = [Runtime.InteropServices.Marshal]::PtrToStructure([IntPtr]($p.ToInt64() + $i * $size), [type][SpikeNative+WTS_SESSION_INFO])
            $buf = [IntPtr]::Zero; $bytes = 0; $name = $null
            if ([SpikeNative]::WTSQuerySessionInformationW([IntPtr]::Zero, $info.SessionId, 5, [ref]$buf, [ref]$bytes)) {
                $name = [Runtime.InteropServices.Marshal]::PtrToStringUni($buf)
                [SpikeNative]::WTSFreeMemory($buf)
            }
            $out += [pscustomobject]@{ id = $info.SessionId; station = $info.pWinStationName; state = $info.State; user = $name }
        }
        return $out
    }
    finally { [SpikeNative]::WTSFreeMemory($p) }
}

function Get-AccountSessions {
    @(Get-Sessions | Where-Object { $_.id -ne 0 -and $_.user -and ($_.user -ieq $Account) })
}

# The password Winlogon uses for autologon today. SYSTEM can read it; nothing
# else on the box can. It stays in this process and is never written anywhere.
function Read-LsaSecret {
    param([string]$KeyName)
    $attrs = New-Object SpikeNative+LSA_OBJECT_ATTRIBUTES
    $attrs.Length = [Runtime.InteropServices.Marshal]::SizeOf($attrs)
    $policy = [IntPtr]::Zero
    $POLICY_GET_PRIVATE_INFORMATION = 0x00000004
    $status = [SpikeNative]::LsaOpenPolicy([IntPtr]::Zero, [ref]$attrs, $POLICY_GET_PRIVATE_INFORMATION, [ref]$policy)
    if ($status -ne 0) { throw "LsaOpenPolicy failed: Win32 error $([SpikeNative]::LsaNtStatusToWinError($status))" }
    try {
        $key = [SpikeNative]::Str($KeyName)
        $data = [IntPtr]::Zero
        $status = [SpikeNative]::LsaRetrievePrivateData($policy, [ref]$key, [ref]$data)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($key.Buffer)
        if ($status -ne 0) { throw "LsaRetrievePrivateData($KeyName) failed: Win32 error $([SpikeNative]::LsaNtStatusToWinError($status))" }
        try {
            $s = [Runtime.InteropServices.Marshal]::PtrToStructure($data, [type][SpikeNative+LSA_UNICODE_STRING])
            return [Runtime.InteropServices.Marshal]::PtrToStringUni($s.Buffer, $s.Length / 2)
        }
        finally { [void][SpikeNative]::LsaFreeMemory($data) }
    }
    finally { [void][SpikeNative]::LsaClose($policy) }
}

function Get-DenyRdpValue {
    $export = Join-Path $env:TEMP "spike-secpol-export.inf"
    & secedit.exe /export /cfg $export /areas USER_RIGHTS /quiet | Out-Null
    $line = Select-String -Path $export -Pattern "^SeDenyRemoteInteractiveLogonRight\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
    Remove-Item $export -ErrorAction SilentlyContinue
    if ($line) { return ($line.Line -split "=", 2)[1].Trim() }
    return ""
}

function Set-DenyRdpValue {
    param([string]$Value)
    $import = Join-Path $env:TEMP "spike-secpol-import.inf"
    $lines = @("[Unicode]", "Unicode=yes", "[Version]", 'signature="$CHICAGO$"', "Revision=1", "[Privilege Rights]", "SeDenyRemoteInteractiveLogonRight = $Value")
    Set-Content -Path $import -Value $lines -Encoding Unicode
    & secedit.exe /configure /db (Join-Path $env:TEMP "spike-secpol.sdb") /cfg $import /areas USER_RIGHTS /quiet | Out-Null
    Remove-Item $import -ErrorAction SilentlyContinue
}

$password = $null
$rdpDir = $null
$clientProc = $null
$originalDeny = $null
$addedToRdpUsers = $false
$autologonPaused = $false
$sid = $null

try {
    # ─── 1. The machine ───
    $os = Get-CimInstance Win32_OperatingSystem
    $facts.os = "$($os.Caption) $($os.Version)"
    $facts.runningAs = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $facts.ourSessionId = (Get-Process -Id $PID).SessionId
    $ts = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server"
    $facts.rdpEnabled = ((Get-ItemProperty $ts -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections -eq 0)
    $facts.singleSessionPerUser = (Get-ItemProperty $ts -Name fSingleSessionPerUser -ErrorAction SilentlyContinue).fSingleSessionPerUser
    $facts.nlaRequired = (Get-ItemProperty "$ts\WinStations\RDP-Tcp" -Name UserAuthentication -ErrorAction SilentlyContinue).UserAuthentication
    $facts.rdpPort = (Get-ItemProperty "$ts\WinStations\RDP-Tcp" -Name PortNumber -ErrorAction SilentlyContinue).PortNumber
    try {
        $rds = Get-WindowsFeature RDS-RD-Server -ErrorAction Stop
        $facts.rdSessionHostInstalled = [bool]$rds.Installed
    } catch { $facts.rdSessionHostInstalled = "unknown" }
    try {
        $lic = Get-CimInstance -Namespace root\cimv2\TerminalServices -ClassName Win32_TerminalServiceSetting -ErrorAction Stop
        $facts.licensingType = $lic.LicensingType
        $facts.licensingName = $lic.LicensingName
    } catch { $facts.licensingType = "unknown" }
    $facts.consoleSessionId = [SpikeNative]::WTSGetActiveConsoleSessionId()
    $facts.sessionsBefore = @(Get-Sessions | Where-Object { $_.id -ne 0 } | ForEach-Object { "$($_.id) $($_.station) state=$($_.state) user=$($_.user)" })
    $facts.autologonEnabled = ((Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon -eq "1")
    Step "machine recorded" $true

    if (-not $facts.rdpEnabled) { throw "RDP is disabled on this VM (fDenyTSConnections). Loopback RDP needs it on." }

    $sid = (New-Object Security.Principal.NTAccount("$env:COMPUTERNAME\$Account")).Translate([Security.Principal.SecurityIdentifier]).Value

    # ─── 2. The password ───
    $password = Read-LsaSecret -KeyName "DefaultPassword"
    if (-not $password) { throw "The DefaultPassword LSA secret is empty, so there is no password to log on with. Re-run setup-automation-account.ps1 first." }
    Step "password read from LSA" $true "length only: $($password.Length)"

    # ─── 3. RDP logon rights, temporarily ───
    $originalDeny = Get-DenyRdpValue
    if ($originalDeny -match [regex]::Escape("*$sid")) {
        $without = (($originalDeny -split ",") | Where-Object { $_.Trim() -and $_.Trim() -ne "*$sid" }) -join ","
        Set-DenyRdpValue -Value $without
        Step "removed deny RDP logon right" $true
    } else {
        $originalDeny = $null   # nothing to restore
        Step "deny RDP logon right was not set" $true
    }
    # ADSI, not Get-LocalGroupMember, which throws on orphaned SIDs.
    $rdpGroupName = (New-Object Security.Principal.SecurityIdentifier("S-1-5-32-555")).Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
    $rdpGroup = [ADSI]"WinNT://$env:COMPUTERNAME/$rdpGroupName,group"
    $isMember = $false
    foreach ($member in @($rdpGroup.psbase.Invoke("Members"))) {
        $bytes = $member.GetType().InvokeMember("objectSid", "GetProperty", $null, $member, $null)
        if ($bytes -and (New-Object Security.Principal.SecurityIdentifier($bytes, 0)).Value -eq $sid) { $isMember = $true }
    }
    if (-not $isMember) {
        $rdpGroup.Add("WinNT://$env:COMPUTERNAME/$Account,user")
        $addedToRdpUsers = $true
        Step "added to Remote Desktop Users" $true
    }

    # ─── 4. Pause autologon, then clear the existing session ───
    # With AutoAdminLogon 1, Winlogon signs the account back in on the console
    # the moment it is logged off. The first run of this spike measured that
    # console session, not RDP. The flag goes back in the finally block.
    $winlogonKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    if ((Get-ItemProperty $winlogonKey -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon -eq "1") {
        Set-ItemProperty $winlogonKey -Name AutoAdminLogon -Value "0"
        $autologonPaused = $true
        Step "autologon paused" $true
    }

    foreach ($s in Get-AccountSessions) {
        $ok = [SpikeNative]::WTSLogoffSession([IntPtr]::Zero, $s.id, $true)
        Step "logged off existing session $($s.id) ($($s.station))" $ok
    }
    # Logoff took over two minutes on the first run, and a session that comes
    # back is the autologon problem again. Require 15 quiet seconds in a row.
    $quietSince = $null
    $clearDeadline = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $clearDeadline) {
        if ((Get-AccountSessions).Count -gt 0) { $quietSince = $null }
        elseif (-not $quietSince) { $quietSince = Get-Date }
        elseif (((Get-Date) - $quietSince).TotalSeconds -ge 15) { break }
        Start-Sleep -Seconds 1
    }
    $stillThere = @(Get-AccountSessions)
    if ($stillThere.Count -gt 0) {
        throw "The account still has a session after logoff ($(@($stillThere | ForEach-Object { "$($_.id) $($_.station)" }) -join '; ')), so the spike cannot tell a new RDP session from an old one."
    }
    Step "no session for the account" $true

    # ─── 5. Start the client ───
    $rdpDir = Join-Path $env:SystemRoot ("Temp\marvin-spike-" + [guid]::NewGuid().ToString("N"))
    New-Item -Path $rdpDir -ItemType Directory -Force | Out-Null
    & icacls.exe $rdpDir /inheritance:r /grant "*S-1-5-18:(OI)(CI)F" /Q | Out-Null

    $startedAt = Get-Date
    if ($Client -eq "mstsc") {
        # DPAPI, CurrentUser scope, which is SYSTEM here: only this account on
        # this machine can decrypt it. mstsc reads exactly this hex format.
        $secure = ConvertTo-SecureString $password -AsPlainText -Force
        $blob = ConvertFrom-SecureString $secure
        $rdpFile = Join-Path $rdpDir "loopback.rdp"
        @(
            "full address:s:127.0.0.2",
            "username:s:$env:COMPUTERNAME\$Account",
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
        $blob = $null; $secure = $null
        $clientProc = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\mstsc.exe") -ArgumentList "`"$rdpFile`"" -PassThru
        Step "mstsc started" $true "pid $($clientProc.Id)"
    } else {
        if (-not $FreeRdpPath -or -not (Test-Path $FreeRdpPath)) { throw "-Client freerdp needs -FreeRdpPath pointing at wfreerdp.exe." }
        # /from-stdin keeps the password off the command line.
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $FreeRdpPath
        $psi.Arguments = "/v:127.0.0.2 /u:$Account /d:$env:COMPUTERNAME /from-stdin /cert:ignore /size:1920x1080 /bpp:32 -clipboard /log-level:WARN"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $clientProc = [Diagnostics.Process]::Start($psi)
        $clientProc.StandardInput.WriteLine($password)
        $clientProc.StandardInput.Close()
        Step "freerdp started" $true "pid $($clientProc.Id)"
    }

    # ─── 6. Wait for the session ───
    # Only an RDP session counts. A console session for the account means
    # something else signed it in (autologon), which is recorded and ignored.
    $session = $null
    $deadline = (Get-Date).AddSeconds($SessionWaitSeconds)
    while ((Get-Date) -lt $deadline) {
        $active = @(Get-AccountSessions | Where-Object { $_.state -eq $WTSActive })
        $session = $active | Where-Object { $_.station -like "RDP-Tcp#*" } | Select-Object -First 1
        foreach ($c in @($active | Where-Object { $_.station -notlike "RDP-Tcp#*" })) {
            if (-not $facts.unexpectedSessions) { $facts.unexpectedSessions = @() }
            if ($facts.unexpectedSessions -notcontains "$($c.id) $($c.station)") { $facts.unexpectedSessions += "$($c.id) $($c.station)" }
        }
        if ($session) { break }
        if ($clientProc.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    # The .rdp file has done its job the moment a session exists, or failed to.
    if ($rdpDir) { Remove-Item $rdpDir -Recurse -Force -ErrorAction SilentlyContinue; $rdpDir = $null }

    if (-not $session) {
        $exit = if ($clientProc.HasExited) { "client exited with code $($clientProc.ExitCode)" } else { "client still running" }
        $seen = @(Get-AccountSessions | ForEach-Object { "$($_.id) $($_.station) state=$($_.state)" })
        throw "No active session for $Account within $SessionWaitSeconds s ($exit; account sessions seen: $($seen -join '; ')). Check Event Viewer > Microsoft-Windows-TerminalServices-RemoteConnectionManager and Security log 4625."
    }

    $consoleNow = [SpikeNative]::WTSGetActiveConsoleSessionId()
    $verdict.sessionId = $session.id
    $verdict.winStation = $session.station
    $verdict.secondsToSession = [int]((Get-Date) - $startedAt).TotalSeconds
    $verdict.consoleSessionId = $consoleNow
    $verdict.isRdpSession = ($session.station -like "RDP-Tcp#*")
    $verdict.isConsoleSession = ($session.id -eq $consoleNow)
    Step "session created" ($verdict.isRdpSession -and -not $verdict.isConsoleSession) "session $($session.id) on $($session.station), console is $consoleNow"

    # Let Explorer finish starting before driving anything.
    Start-Sleep -Seconds 15

    # ─── 7. Marvin's own probe ───
    $launcher = Join-Path $AppDir "resources\app\server\runners\launch-in-session.ps1"
    if (-not (Test-Path $launcher)) { $launcher = Join-Path $PSScriptRoot "..\server\runners\launch-in-session.ps1" }
    $probeOut = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -Mode probe -User $Account -DataDir $DataDir 2>&1 | Out-String
    $probeJson = $null
    try { $probeJson = ($probeOut.Trim() -split "`r?`n")[-1] | ConvertFrom-Json } catch {}
    $verdict.probe = if ($probeJson) { $probeJson.reason } else { $probeOut.Trim() }
    Step "Marvin probe" ($probeJson -and $probeJson.ok) $verdict.probe

    # ─── 8. The real desktop driver ───
    $driverPath = Join-Path $AppDir "resources\app\server\runners\desktop-runner.js"
    $nodeModules = Join-Path $AppDir "resources\app\server\node_modules"
    $nodeExe = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*scheduler-service.js*" -and $_.Name -like "node*" } | Select-Object -First 1).ExecutablePath
    if (-not $nodeExe) { $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
    $facts.nodeExe = $nodeExe

    if (-not $nodeExe -or -not (Test-Path $driverPath)) {
        Step "desktop driver" $false "node ($nodeExe) or $driverPath not found, so the driver test was skipped"
    } else {
        $work = Join-Path $DataDir ("tmp\spike\run-" + (Get-Date -Format "HHmmss"))
        New-Item -Path $work -ItemType Directory -Force | Out-Null
        $shot = Join-Path $work "screen.png"
        $driverResult = Join-Path $work "driver.json"
        $marker = "MARVIN SPIKE " + (Get-Random -Minimum 1000 -Maximum 9999)

        $js = @"
const fs = require('fs');
const { createDesktopDriver } = require($(ConvertTo-Json $driverPath));
(async () => {
  const r = { marker: $(ConvertTo-Json $marker) };
  const d = createDesktopDriver();
  try {
    await d.launch('notepad.exe');
    await d.pause(3000);
    await d.focusWindow('Notepad');
    await d.pause(500);
    await d.type(r.marker);
    await d.pause(1000);
    r.title = await d.getWindowTitle();
    r.screenshot = await d.screenshot($(ConvertTo-Json $shot));
    const ocr = await d.readText(null, { engine: 'windows' });
    r.ocrText = ocr && ocr.text;
    r.ocrFound = !!(r.ocrText && r.ocrText.replace(/\s+/g, ' ').toUpperCase().includes(r.marker.split(' ').pop()));
  } catch (e) {
    r.error = (e && e.stack) || String(e);
  }
  try { await d.quit(); } catch {}
  fs.writeFileSync($(ConvertTo-Json $driverResult), JSON.stringify(r, null, 2));
  process.exit(0);
})();
"@
        Set-Content -Path (Join-Path $work "spike-driver.js") -Value $js -Encoding ASCII
        $cmd = Join-Path $work "run.cmd"
        Set-Content -Path $cmd -Encoding ASCII -Value @(
            "@echo off",
            "set `"NODE_PATH=$nodeModules`"",
            "`"$nodeExe`" `"$work\spike-driver.js`" > `"$work\driver.log`" 2>&1"
        )
        $cmdExe = Join-Path $env:SystemRoot "System32\cmd.exe"
        # Unquoted on purpose. Windows PowerShell 5.1 does not escape embedded
        # quotes when it passes an argument to a native program, so a quoted
        # command line arrives split. The data directory has no spaces.
        if ($cmd -match " ") { throw "The spike's run directory has a space in it ($cmd). Pass a -DataDir without spaces." }
        $launchOut = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -Mode launch -User $Account `
            -ApplicationName $cmdExe -CommandLine "cmd.exe /c $cmd" -WorkingDirectory $work -Wait -TimeoutSeconds 180 -DataDir $DataDir 2>&1 | Out-String

        if (Test-Path $driverResult) {
            $dr = Get-Content $driverResult -Raw | ConvertFrom-Json
            $verdict.driverError = $dr.error
            $verdict.ocrFoundMarker = [bool]$dr.ocrFound
            $verdict.ocrText = $dr.ocrText
            $verdict.windowTitle = $dr.title
        } else {
            $verdict.driverError = "no driver result. launcher: $($launchOut.Trim()) log: $((Get-Content (Join-Path $work 'driver.log') -Raw -ErrorAction SilentlyContinue))"
        }

        # Blank check: a session with no visible client window can stop
        # rendering, and the capture then comes back one flat colour.
        if (Test-Path $shot) {
            Add-Type -AssemblyName System.Drawing
            $bmp = [System.Drawing.Bitmap]::FromFile($shot)
            try {
                $colours = New-Object 'System.Collections.Generic.HashSet[int]'
                for ($x = 0; $x -lt $bmp.Width; $x += 37) {
                    for ($y = 0; $y -lt $bmp.Height; $y += 37) { [void]$colours.Add($bmp.GetPixel($x, $y).ToArgb()) }
                }
                $verdict.screenshotSize = "$($bmp.Width)x$($bmp.Height)"
                $verdict.screenshotDistinctColours = $colours.Count
                $verdict.screenshotBlank = ($colours.Count -le 2)
            } finally { $bmp.Dispose() }
            $verdict.screenshotPath = $shot
        }
        Step "desktop driver" ((-not $verdict.driverError) -and $verdict.ocrFoundMarker -and -not $verdict.screenshotBlank) "ocrFound=$($verdict.ocrFoundMarker) blank=$($verdict.screenshotBlank)"
    }

    $verdict.clientStillRunning = -not $clientProc.HasExited
}
catch {
    Step "FAILED" $false $_.Exception.Message
}
finally {
    $password = $null
    [gc]::Collect()
    if ($rdpDir) { Remove-Item $rdpDir -Recurse -Force -ErrorAction SilentlyContinue }

    # ─── 9. Log off ───
    try {
        foreach ($s in Get-AccountSessions) {
            [void][SpikeNative]::WTSLogoffSession([IntPtr]::Zero, $s.id, $true)
        }
        if ($clientProc -and -not $clientProc.HasExited) {
            Start-Sleep -Seconds 3
            if (-not $clientProc.HasExited) { $clientProc.Kill() }
        }
        # Logoff can take minutes on this VM. Wait for it rather than guess.
        $goneDeadline = (Get-Date).AddSeconds(240)
        while ((Get-Date) -lt $goneDeadline -and @(Get-AccountSessions).Count -gt 0) { Start-Sleep -Seconds 2 }
        $left = @(Get-AccountSessions)
        $verdict.sessionGoneAfterLogoff = ($left.Count -eq 0)
        Step "logged off" ($left.Count -eq 0) (@($left | ForEach-Object { "$($_.id) $($_.station) state=$($_.state)" }) -join "; ")
    } catch { Step "logoff" $false $_.Exception.Message }

    # ─── 10. Put autologon and the rights back ───
    # Restoring the flag does not sign the account in again until the next
    # reboot, which is why the current build needs one after the spike.
    if ($autologonPaused) {
        try {
            Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name AutoAdminLogon -Value "1"
            Step "autologon restored" $true
        } catch { Step "restore autologon" $false $_.Exception.Message }
    }

    if (-not $KeepRdpRight) {
        try {
            if ($null -ne $originalDeny) { Set-DenyRdpValue -Value $originalDeny; Step "restored deny RDP logon right" $true }
            if ($addedToRdpUsers) { $rdpGroup.Remove("WinNT://$env:COMPUTERNAME/$Account,user"); Step "removed from Remote Desktop Users" $true }
        } catch { Step "restore rights" $false $_.Exception.Message }
    }

    $verdict.passed = [bool](
        $verdict.isRdpSession -and -not $verdict.isConsoleSession -and
        $verdict.probe -eq "ok" -and $verdict.ocrFoundMarker -and
        -not $verdict.screenshotBlank -and $verdict.sessionGoneAfterLogoff
    )

    $out = [ordered]@{ client = $Client; verdict = $verdict; facts = $facts; steps = $steps }
    $json = $out | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($ReportPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}
