param([Parameter(Mandatory = $true)][string]$Version)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-UninstallEntries {
  $uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (-not (Test-Path -LiteralPath $uninstallRoot -ErrorAction Stop)) { return @() }

  return @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction Stop |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop } |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -ceq 'DeskCue' })
}

function Get-DeskCuePathSegmentCount([string]$CliDirectory) {
  $pathValue = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ([string]::IsNullOrEmpty($pathValue)) { return 0 }

  return @(($pathValue -split ';') | Where-Object {
    $_.Trim().TrimEnd('\') -ieq $CliDirectory.TrimEnd('\')
  }).Count
}

function Get-AutostartValue {
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (-not (Test-Path -LiteralPath $runKey -ErrorAction Stop)) { return $null }

  $entry = Get-ItemProperty -LiteralPath $runKey -ErrorAction Stop
  if (-not $entry.PSObject.Properties['DeskCue']) { return $null }

  return $entry.DeskCue
}

function Invoke-CliJson([string]$CliPath, [string[]]$Arguments) {
  $output = @(& $CliPath @Arguments)
  Assert-True ($LASTEXITCODE -eq 0) "DeskCue CLI $($Arguments[0]) failed."
  return ([string]::Join("`n", $output) | ConvertFrom-Json -ErrorAction Stop)
}

function Wait-ForProcessExit([int]$ProcessId) {
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Seconds 1
  }

  throw "Installed process $ProcessId did not exit after uninstall."
}

Assert-True ($Version -match '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') 'Version must be stable SemVer.'
Assert-True (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) 'Runner temp directory is unavailable.'
Assert-True ($IsWindows -and [Environment]::Is64BitOperatingSystem) 'This smoke requires Windows x64.'
$downloadRoot = Join-Path $env:RUNNER_TEMP 'deskcue-windows-release-smoke'
$installerName = "DeskCueSetup-$Version-win-x64.exe"
$installerPath = Join-Path $downloadRoot $installerName
$sidecarPath = "$installerPath.sha256"
Assert-True (Test-Path -LiteralPath $installerPath -PathType Leaf) 'Verified installer is missing.'
Assert-True (Test-Path -LiteralPath $sidecarPath -PathType Leaf) 'Installer SHA-256 sidecar is missing.'
$installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
Assert-True ([IO.File]::ReadAllText($sidecarPath).Trim() -ceq "$installerHash  $installerName") 'Installer changed between workflow steps.'

$programRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\DeskCue'))
$dataRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'DeskCue\data'))
$cliDirectory = Join-Path $programRoot 'bin'
$cliPath = Join-Path $cliDirectory 'deskcue.cmd'
$trayPath = Join-Path $programRoot 'DeskCue.Tray.exe'
$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DeskCue\DeskCue.lnk'
Assert-True (-not (Test-Path -LiteralPath $programRoot)) 'The Windows runner already has DeskCue program files.'
Assert-True (-not (Test-Path -LiteralPath $dataRoot)) 'The Windows runner already has DeskCue data.'
Assert-True (@(Get-UninstallEntries).Count -eq 0) 'The Windows runner already has a DeskCue uninstall entry.'
Assert-True ((Get-DeskCuePathSegmentCount $cliDirectory) -eq 0) 'The Windows runner already has a DeskCue PATH entry.'
Assert-True ([string]::IsNullOrEmpty((Get-AutostartValue))) 'The Windows runner already has DeskCue autostart.'

$installed = Start-Process -FilePath $installerPath `
  -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=autostart') `
  -WindowStyle Hidden -Wait -PassThru
Assert-True ($installed.ExitCode -eq 0) "Installer exited $($installed.ExitCode)."
Assert-True (Test-Path -LiteralPath $programRoot -PathType Container) 'Installer did not create the program directory.'
Assert-True (Test-Path -LiteralPath $cliPath -PathType Leaf) 'Installer did not create the CLI.'
Assert-True (Test-Path -LiteralPath $trayPath -PathType Leaf) 'Installer did not create the tray.'
Assert-True (Test-Path -LiteralPath $shortcutPath -PathType Leaf) 'Installer did not create the Start-menu shortcut.'

$entries = @(Get-UninstallEntries)
Assert-True ($entries.Count -eq 1) 'Installer did not create exactly one uninstall entry.'
Assert-True ($entries[0].DisplayVersion -ceq $Version) 'Installed version differs from the draft release.'
Assert-True ($entries[0].InstallLocation.TrimEnd('\') -ieq $programRoot) 'Uninstall entry points outside the DeskCue program directory.'
Assert-True ((Get-DeskCuePathSegmentCount $cliDirectory) -eq 1) 'Installer did not add exactly one user PATH entry.'
Assert-True ((Get-AutostartValue) -ceq ('"' + $trayPath + '" --autostart')) 'Installer autostart does not target the installed tray.'

$manifestPath = Join-Path $programRoot 'payload-manifest.json'
Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) 'Installed payload manifest is missing.'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
Assert-True ($manifest.appVersion -ceq $Version -and $manifest.architecture -ceq 'x64') 'Installed payload identity differs.'
Assert-True (@($manifest.files).Count -gt 0) 'Installed payload manifest has no files.'
foreach ($item in $manifest.files) {
  $payloadPath = [IO.Path]::GetFullPath((Join-Path $programRoot $item.path))
  Assert-True ($payloadPath.StartsWith($programRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) 'Payload manifest escaped the program directory.'
  Assert-True (Test-Path -LiteralPath $payloadPath -PathType Leaf) "Installed payload file is missing: $($item.path)."
  $payloadFile = Get-Item -LiteralPath $payloadPath
  Assert-True ($payloadFile.Length -eq $item.size) "Installed payload size differs: $($item.path)."
  $payloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $payloadPath).Hash.ToLowerInvariant()
  Assert-True ($payloadHash -ceq $item.sha256) "Installed payload SHA-256 differs: $($item.path)."
}

$cliVersion = @(& $cliPath version)
Assert-True ($LASTEXITCODE -eq 0 -and $cliVersion.Count -eq 1 -and $cliVersion[0] -ceq $Version) 'Installed CLI version differs.'
$started = Invoke-CliJson $cliPath @('start', '--json')
Assert-True ($started.ok -eq $true) 'Installed Host could not start the daemon.'
$status = Invoke-CliJson $cliPath @('status', '--json')
Assert-True ($status.ok -eq $true) 'Installed runtime status is not healthy.'
Assert-True ($status.data.status.host.version -ceq $Version) 'Installed Host version differs.'
Assert-True ($status.data.status.daemon.version -ceq $Version) 'Installed daemon version differs.'
Assert-True ($status.data.status.daemon.state -ceq 'running') 'Installed daemon is not running.'
Assert-True ($status.data.status.autostart.enabled -eq $true) 'Fresh-install autostart is not enabled.'
$doctor = Invoke-CliJson $cliPath @('doctor', '--json')
Assert-True ($doctor.ok -eq $true -and $doctor.data.health.summary.status -ceq 'healthy') 'Installed doctor is not healthy.'
Assert-True ($doctor.data.health.summary.failed -eq 0) 'Installed doctor has failing checks.'

$dashboardUrl = @(& $cliPath open --print)
Assert-True ($LASTEXITCODE -eq 0 -and $dashboardUrl.Count -eq 1) 'Installed CLI did not print one dashboard URL.'
$dashboardUri = [Uri]$dashboardUrl[0]
Assert-True ($dashboardUri.Scheme -ceq 'http' -and $dashboardUri.Host -ceq '127.0.0.1') 'Dashboard URL is not loopback HTTP.'
$dashboard = Invoke-WebRequest -Uri $dashboardUri -TimeoutSec 10 -ErrorAction Stop
Assert-True ($dashboard.StatusCode -eq 200 -and $dashboard.Content -match 'DeskCue') 'Installed dashboard did not load.'

$tray = @(Get-Process -Name 'DeskCue.Tray' -ErrorAction SilentlyContinue)
if ($tray.Count -eq 0) {
  $launchedTray = Start-Process -FilePath $trayPath -ArgumentList '--autostart' -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 3
  $tray = @(Get-Process -Name 'DeskCue.Tray' -ErrorAction SilentlyContinue)
}
Assert-True ($tray.Count -eq 1 -and $tray[0].Path -ieq $trayPath) 'Installed tray did not remain running.'

Assert-True (Test-Path -LiteralPath $dataRoot -PathType Container) 'Installed runtime did not create its data directory.'
$databasePath = Join-Path $dataRoot 'service\deskcue.sqlite'
Assert-True (Test-Path -LiteralPath $databasePath -PathType Leaf) 'Installed runtime did not create its database.'
$markerPath = Join-Path $dataRoot 'release-smoke-preserve.txt'
$markerText = "DeskCue release smoke $Version"
[IO.File]::WriteAllText($markerPath, $markerText)

$stopped = Invoke-CliJson $cliPath @('stop', '--json')
Assert-True ($stopped.ok -eq $true) 'Installed CLI could not stop the daemon.'
$databaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $databasePath).Hash
$uninstallerPath = Join-Path $programRoot 'unins000.exe'
Assert-True (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) 'Installed uninstaller is missing.'
$hostPid = [int]$status.data.status.host.pid
$daemonPid = [int]$status.data.status.daemon.pid
$trayPid = [int]$tray[0].Id
$uninstalled = Start-Process -FilePath $uninstallerPath `
  -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') `
  -WindowStyle Hidden -Wait -PassThru
Assert-True ($uninstalled.ExitCode -eq 0) "Uninstaller exited $($uninstalled.ExitCode)."
Wait-ForProcessExit $hostPid
Wait-ForProcessExit $daemonPid
Wait-ForProcessExit $trayPid
Assert-True (-not (Test-Path -LiteralPath $programRoot)) 'Uninstaller left DeskCue program files.'
Assert-True (-not (Test-Path -LiteralPath $shortcutPath)) 'Uninstaller left the Start-menu shortcut.'
Assert-True (@(Get-UninstallEntries).Count -eq 0) 'Uninstaller left a DeskCue uninstall entry.'
Assert-True ((Get-DeskCuePathSegmentCount $cliDirectory) -eq 0) 'Uninstaller left the owned PATH segment.'
Assert-True ([string]::IsNullOrEmpty((Get-AutostartValue))) 'Uninstaller left DeskCue autostart.'
Assert-True (Test-Path -LiteralPath $dataRoot -PathType Container) 'Uninstaller removed user data.'
Assert-True ([IO.File]::ReadAllText($markerPath) -ceq $markerText) 'Uninstaller changed the user-data marker.'
Assert-True ((Get-FileHash -Algorithm SHA256 -LiteralPath $databasePath).Hash -ceq $databaseHash) 'Uninstaller changed the stopped database.'

Write-Host "Windows x64 v$Version clean silent install, payload, CLI/Host/daemon, tray, autostart, dashboard and data-preserving uninstall passed."
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_STEP_SUMMARY)) {
  @(
    '### Windows x64 release installer smoke'
    "- [x] Exact draft v$Version installer and SHA-256 verified before execution"
    '- [x] Fresh Windows runner had no DeskCue program, data, PATH or autostart'
    '- [x] Silent per-user install, installed payload hashes, CLI, Host, daemon, tray, autostart and dashboard passed'
    '- [x] Uninstall removed owned integration and preserved the stopped database and test data'
    '- [ ] Interactive installer wizard, SmartScreen and consumer Windows desktop remain manual checks'
  ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
