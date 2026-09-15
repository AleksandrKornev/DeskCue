[CmdletBinding()]
param(
  [Parameter()]
  [string]$Version,

  [Parameter()]
  [string]$PayloadDir,

  [Parameter()]
  [string]$OutputDir,

  [Parameter()]
  [string]$IsccPath,

  [Parameter()]
  [switch]$FailureInjection
)

$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..\..')).Path
$expectedIsccVersion = '7.1.0'
$installerScriptSource = Join-Path $scriptRoot 'DeskCue.iss'
$installerIconSource = Join-Path $repositoryRoot 'apps\tray\DeskCue.Tray\Assets\deskcue.ico'
$privateSnapshotAccessScript = Join-Path $scriptRoot 'private-snapshot-access.ps1'

. $privateSnapshotAccessScript

if (-not $Version) {
  $Version = (Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json).version
}
if (-not $PayloadDir) {
  $PayloadDir = Join-Path $scriptRoot 'dist\payload'
}
if (-not $OutputDir) {
  $OutputDir = Join-Path $scriptRoot 'dist\installer'
}

$resolvedPayloadDir = (Resolve-Path -LiteralPath $PayloadDir).Path
$manifestPath = Join-Path $resolvedPayloadDir 'payload-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Payload manifest is missing: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.appVersion -ne $Version) {
  throw "Payload version '$($manifest.appVersion)' does not match installer version '$Version'."
}
if ($manifest.architecture -ne 'x64' -or $manifest.node.version -ne '24.14.0') {
  throw "Payload must target Windows x64 with bundled Node 24.14.0."
}
if ($manifest.dotnet.runtimeVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "Payload must record the exact .NET runtime-pack version."
}
$requiredRuntimePacks = @(
  'Microsoft.NETCore.App.Runtime.win-x64',
  'Microsoft.WindowsDesktop.App.Runtime.win-x64'
)
foreach ($runtimePack in $requiredRuntimePacks) {
  if ($manifest.dotnet.runtimePacks -notcontains $runtimePack) {
    throw "Payload does not record required .NET runtime pack '$runtimePack'."
  }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'node.exe is required to verify the complete payload before compiling the installer.'
}

if (-not $IsccPath) {
  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) {
    $IsccPath = $command.Source
  } else {
    $candidates = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe'),
      (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
      (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    )
    $IsccPath = $candidates |
      Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
      Select-Object -First 1
  }
}

$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
  throw "ISCC.exe was not found. Install Inno Setup $expectedIsccVersion, then rerun this script."
}

$actualIsccVersion = (& $IsccPath --version | Select-Object -First 1).Trim()
if ($actualIsccVersion -ne $expectedIsccVersion) {
  throw "ISCC.exe version '$actualIsccVersion' does not match required version '$expectedIsccVersion'."
}

function Get-FileBinding {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $item = Get-Item -LiteralPath $Path
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Compiler input cannot be a reparse point: $($item.FullName)"
  }

  [ordered]@{
    path = $item.FullName
    size = $item.Length
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Assert-FileBinding {
  param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [System.Collections.IDictionary]$Expected
  )

  $actual = Get-FileBinding -Path $Path
  if (($actual.size -ne $Expected.size) -or ($actual.sha256 -ne $Expected.sha256)) {
    throw "Compiler input changed after it was snapshotted: $Path"
  }
}

function Remove-ValidatedStagingDirectory {
  param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [string]$ExpectedParent
  )

  $resolvedParent = [System.IO.Path]::GetFullPath($ExpectedParent).TrimEnd('\')
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolvedPath.StartsWith("$resolvedParent\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an unexpected compiler staging directory: $resolvedPath"
  }
  if (Test-Path -LiteralPath $resolvedPath) {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
  }
}

$snapshotTool = Join-Path $scriptRoot 'compile-snapshot.mjs'
$verifyPayloadScript = Join-Path $scriptRoot 'verify-payload.mjs'
$snapshotParent = Join-Path $scriptRoot 'dist\compile-snapshots'
$compilerStagingParent = Join-Path $scriptRoot 'dist\installer-staging'
$buildId = [Guid]::NewGuid().ToString('N')
$sessionDir = Join-Path $snapshotParent "session-$buildId"
$snapshotDir = Join-Path $sessionDir 'payload'
$compilerInputDir = Join-Path $sessionDir 'compiler'
$compilerStagingDir = Join-Path $compilerStagingParent $buildId
$resolvedSessionDir = [System.IO.Path]::GetFullPath($sessionDir)
$resolvedSnapshotDir = [System.IO.Path]::GetFullPath($snapshotDir)
$resolvedCompilerInputDir = [System.IO.Path]::GetFullPath($compilerInputDir)
$resolvedCompilerStagingDir = [System.IO.Path]::GetFullPath($compilerStagingDir)
$snapshotInstallerScript = Join-Path $resolvedCompilerInputDir 'DeskCue.iss'
$snapshotInstallerIcon = Join-Path $resolvedCompilerInputDir 'deskcue.ico'

New-Item -ItemType Directory -Path $snapshotParent -Force | Out-Null
New-Item -ItemType Directory -Path $resolvedCompilerInputDir | Out-Null
New-Item -ItemType Directory -Path $resolvedCompilerStagingDir -Force | Out-Null

try {
  $installerScriptSourceBinding = Get-FileBinding -Path $installerScriptSource
  $installerIconSourceBinding = Get-FileBinding -Path $installerIconSource
  $isccBinding = Get-FileBinding -Path $IsccPath
  Copy-Item -LiteralPath $installerScriptSource -Destination $snapshotInstallerScript
  Copy-Item -LiteralPath $installerIconSource -Destination $snapshotInstallerIcon
  $installerScriptSnapshotBinding = Get-FileBinding -Path $snapshotInstallerScript
  $installerIconSnapshotBinding = Get-FileBinding -Path $snapshotInstallerIcon
  if (($installerScriptSourceBinding.sha256 -ne $installerScriptSnapshotBinding.sha256) -or
    ($installerIconSourceBinding.sha256 -ne $installerIconSnapshotBinding.sha256)) {
    throw 'Private compiler-input snapshot does not match its source inputs.'
  }

  & $nodeCommand.Source $snapshotTool create $resolvedPayloadDir $resolvedSnapshotDir $repositoryRoot $Version
  if ($LASTEXITCODE -ne 0) {
    throw "Private payload snapshot creation failed with exit code $LASTEXITCODE."
  }
  Set-PrivateSnapshotAccess -Path $resolvedSessionDir -Mode ReadOnly
  Assert-PrivateSnapshotAccess -Path $resolvedSnapshotDir `
    -ProbeDirectories @($resolvedSnapshotDir, (Join-Path $resolvedSnapshotDir 'app\node_modules')) `
    -ProbeFiles @((Join-Path $resolvedSnapshotDir 'payload-manifest.json'))
  Assert-PrivateSnapshotAccess -Path $resolvedCompilerInputDir `
    -ProbeDirectories @($resolvedCompilerInputDir) `
    -ProbeFiles @($snapshotInstallerScript, $snapshotInstallerIcon)
  Assert-PrivateSnapshotChildDeletionDenied -ProtectedFile $snapshotInstallerScript

  & $nodeCommand.Source $verifyPayloadScript $resolvedSnapshotDir
  if ($LASTEXITCODE -ne 0) {
    throw "Full exact compile snapshot verification failed with exit code $LASTEXITCODE."
  }

  Assert-FileBinding -Path $snapshotInstallerScript -Expected $installerScriptSnapshotBinding
  Assert-FileBinding -Path $snapshotInstallerIcon -Expected $installerIconSnapshotBinding
  Assert-FileBinding -Path $IsccPath -Expected $isccBinding

  $arguments = @(
    "/DAppVersion=$Version",
    "/DPayloadDir=$resolvedSnapshotDir",
    "/DOutputDir=$resolvedCompilerStagingDir",
    "/DDeskCueIconFile=$snapshotInstallerIcon",
    $snapshotInstallerScript
  )
  if ($FailureInjection) {
    $arguments = @('/DFailureInjection=1') + $arguments
  }
  & $IsccPath @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "ISCC.exe failed with exit code $LASTEXITCODE."
  }

  & $nodeCommand.Source $verifyPayloadScript $resolvedSnapshotDir
  if ($LASTEXITCODE -ne 0) {
    throw "Full exact compile snapshot post-compile verification failed with exit code $LASTEXITCODE."
  }
  Assert-FileBinding -Path $snapshotInstallerScript -Expected $installerScriptSnapshotBinding
  Assert-FileBinding -Path $snapshotInstallerIcon -Expected $installerIconSnapshotBinding

  $stagedInstallerPath = Join-Path $resolvedCompilerStagingDir "DeskCueSetup-$Version-win-x64.exe"
  if (-not (Test-Path -LiteralPath $stagedInstallerPath -PathType Leaf)) {
    throw "Inno Setup did not produce the expected staged installer: $stagedInstallerPath"
  }

  $installerPath = Join-Path $resolvedOutputDir "DeskCueSetup-$Version-win-x64.exe"
  Move-Item -LiteralPath $stagedInstallerPath -Destination $installerPath -Force
  $installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $installerName = [System.IO.Path]::GetFileName($installerPath)
  Set-Content -LiteralPath "$installerPath.sha256" -Value "$installerHash  $installerName" -Encoding utf8NoBOM
  $buildManifest = [ordered]@{
    schemaVersion = 1
    appVersion = $Version
    architecture = 'x64'
    setup = Get-FileBinding -Path $installerPath
    payloadManifest = Get-FileBinding -Path (Join-Path $resolvedSnapshotDir 'payload-manifest.json')
    compiler = [ordered]@{
      path = $isccBinding.path
      version = $actualIsccVersion
      sha256 = $isccBinding.sha256
      size = $isccBinding.size
    }
    inputs = [ordered]@{
      installerScriptSource = $installerScriptSourceBinding
      installerScriptSnapshot = $installerScriptSnapshotBinding
      iconSource = $installerIconSourceBinding
      iconSnapshot = $installerIconSnapshotBinding
    }
    privateSnapshot = [ordered]@{
      recursivelyRestrictedAndWriteProbed = $true
      protectedChildDeletionProbed = $true
      payloadVerifiedBeforeAndAfterCompilation = $true
      compilerInputsVerifiedBeforeAndAfterCompilation = $true
    }
  }
  $buildManifest | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath "$installerPath.build-manifest.json" -Encoding utf8NoBOM
  Write-Output $installerPath
} finally {
  if (Test-Path -LiteralPath $resolvedSessionDir) {
    Set-PrivateSnapshotAccess -Path $resolvedSessionDir -Mode Cleanup
  }
  if (Test-Path -LiteralPath $resolvedSnapshotDir) {
    & $nodeCommand.Source $snapshotTool cleanup '-' $resolvedSnapshotDir $repositoryRoot
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Private compile snapshot cleanup failed with exit code $LASTEXITCODE`: $resolvedSnapshotDir"
    }
  }
  Remove-ValidatedStagingDirectory -Path $resolvedSessionDir -ExpectedParent $snapshotParent
  Remove-ValidatedStagingDirectory -Path $resolvedCompilerStagingDir -ExpectedParent $compilerStagingParent
}
