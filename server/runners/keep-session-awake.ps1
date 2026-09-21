<#
    keep-session-awake.ps1

    Keeps the automation account's session from locking, on a VM whose policy
    sets "Interactive logon: Machine inactivity limit".

    Input cannot be sent to a locked desktop, so a machine-wide inactivity limit
    ends every scheduled desktop run once it fires. The session cannot be
    unlocked again either: the account's password is written to the LSA secret
    at setup and discarded, so nothing holds a credential to unlock with. Only a
    reboot recovers it, through autologon.

    So this runs inside that session and injects a **zero-distance** mouse move
    on an interval. Windows counts it as input and resets the idle timer, but
    the cursor does not move, so it cannot disturb a test that is driving the
    mouse at that moment. A 1-pixel jiggle would.

    It writes a heartbeat file so the health check can report whether this is
    actually alive, rather than trusting that a scheduled task exists.

    This weakens an inactivity control for one session. Agree it with whoever
    owns the policy; exempting the VM is the cleaner answer.
#>

[CmdletBinding()]
param(
    # Comfortably under a 900-second (15 minute) limit, the common setting.
    [int]$IntervalSeconds = 240,
    [string]$DataDir = "C:\ProgramData\uts-automation"
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class MarvinKeepAwake {
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // Only the mouse member of the INPUT union is needed, and MOUSEINPUT is its
    // largest member, so the marshalled size matches what SendInput expects.
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public MOUSEINPUT mi;
    }

    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
}
"@

$INPUT_MOUSE = 0
$MOUSEEVENTF_MOVE = 0x0001
$size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarvinKeepAwake+INPUT])

$heartbeat = Join-Path $DataDir "tmp\keep-awake.heartbeat"
$heartbeatDir = Split-Path $heartbeat -Parent
if (-not (Test-Path $heartbeatDir)) {
    New-Item -Path $heartbeatDir -ItemType Directory -Force | Out-Null
}

Write-Output "[keep-awake] Running as $env:USERNAME in session $((Get-Process -Id $PID).SessionId), every $IntervalSeconds s"

while ($true) {
    # dx/dy of zero: input for the purposes of the idle timer, no cursor movement.
    # PowerShell returns a COPY of a nested struct, so `$evt.mi.dwFlags = ...`
    # would set a field on a temporary and be silently lost, leaving dwFlags at
    # zero and the injected event doing nothing. Build the inner struct first
    # and assign it whole.
    $mi = New-Object MarvinKeepAwake+MOUSEINPUT
    $mi.dx = 0
    $mi.dy = 0
    $mi.mouseData = 0
    $mi.dwFlags = $MOUSEEVENTF_MOVE
    $mi.time = 0
    $mi.dwExtraInfo = [IntPtr]::Zero

    $evt = New-Object MarvinKeepAwake+INPUT
    $evt.type = $INPUT_MOUSE
    $evt.mi = $mi

    $sent = [MarvinKeepAwake]::SendInput(1, @($evt), $size)
    if ($sent -ne 1) {
        # Blocked input usually means the secure desktop has it, i.e. the
        # session locked anyway. Say so; a silent no-op here is how this would
        # look fine while doing nothing.
        Write-Output "[keep-awake] SendInput was rejected (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error())). The session may be locked."
    } else {
        try {
            Set-Content -Path $heartbeat -Value (Get-Date).ToString("o") -Encoding ASCII
        } catch {
            Write-Output "[keep-awake] Could not write the heartbeat: $($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds $IntervalSeconds
}
