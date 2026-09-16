param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$ReleaseId,
  [Parameter(Mandatory = $true)][string]$SourceCommit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-ReleaseAsset($Release, [string]$Name) {
  $matchingAssets = @($Release.assets | Where-Object { $_.name -ceq $Name })
  Assert-True ($matchingAssets.Count -eq 1) "Expected one release asset named $Name."
  Assert-True ($matchingAssets[0].state -eq 'uploaded') "Release asset $Name is not uploaded."
  Assert-True ($matchingAssets[0].id -is [ValueType] -and $matchingAssets[0].id -gt 0) "Release asset $Name has no valid ID."
  Assert-True ($matchingAssets[0].size -gt 0) "Release asset $Name is empty."
  Assert-True ($matchingAssets[0].digest -match '^sha256:[a-f0-9]{64}$') "Release asset $Name has no SHA-256 digest."

  return $matchingAssets[0]
}

Assert-True ($Version -match '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') 'Version must be stable SemVer.'
Assert-True ($ReleaseId -match '^[1-9][0-9]*$') 'Release ID must be numeric.'
Assert-True ($SourceCommit -match '^[a-f0-9]{40}$') 'Source commit must be a lowercase 40-character SHA.'
Assert-True ($env:GITHUB_REPOSITORY -match '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') 'GitHub repository is invalid.'
Assert-True (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) 'GitHub token is unavailable.'
Assert-True (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) 'Runner temp directory is unavailable.'

$repository = $env:GITHUB_REPOSITORY
$releaseUri = "https://api.github.com/repos/$repository/releases/$ReleaseId"
$headers = @{
  Authorization = "Bearer $env:GITHUB_TOKEN"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'DeskCue-Windows-release-smoke'
}
$release = Invoke-RestMethod -Method Get -Uri $releaseUri -Headers $headers
Assert-True ($release.draft -eq $true) 'The selected release is not a draft.'
Assert-True ($release.tag_name -ceq "v$Version") 'Draft release tag differs from the requested version.'
if ($release.target_commitish -match '^[a-f0-9]{40}$') {
  Assert-True ($release.target_commitish -ceq $SourceCommit) 'Draft release target commit differs from Distribution.'
}

$tagName = "refs/tags/v$Version"
$tagRefs = @(& git ls-remote "https://github.com/$repository.git" $tagName "$tagName^{}")
Assert-True ($LASTEXITCODE -eq 0) 'Could not resolve the remote release tag.'
$peeled = @($tagRefs | Where-Object { $_ -match '\^\{\}$' })
$direct = @($tagRefs | Where-Object { $_ -notmatch '\^\{\}$' })
$tagRef = if ($peeled.Count -eq 1) { $peeled[0] } elseif ($direct.Count -eq 1) { $direct[0] } else { $null }
Assert-True ($null -ne $tagRef) 'Release tag did not resolve uniquely.'
$tagCommit = ($tagRef -split '\s+')[0]
Assert-True ($tagCommit -ceq $SourceCommit) 'Remote tag no longer points to the Distribution source commit.'

$installerName = "DeskCueSetup-$Version-win-x64.exe"
$sidecarName = "$installerName.sha256"
$installerAsset = Get-ReleaseAsset $release $installerName
$sidecarAsset = Get-ReleaseAsset $release $sidecarName
$downloadRoot = Join-Path $env:RUNNER_TEMP 'deskcue-windows-release-smoke'
Assert-True (-not (Test-Path -LiteralPath $downloadRoot)) 'Download directory already exists on this runner.'
New-Item -ItemType Directory -Path $downloadRoot -ErrorAction Stop | Out-Null

foreach ($asset in @($installerAsset, $sidecarAsset)) {
  $assetUri = "https://api.github.com/repos/$repository/releases/assets/$($asset.id)"
  $destination = Join-Path $downloadRoot $asset.name
  $downloadHeaders = @{
    Authorization = "Bearer $env:GITHUB_TOKEN"
    Accept = 'application/octet-stream'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'DeskCue-Windows-release-smoke'
  }
  Invoke-WebRequest -Uri $assetUri -Headers $downloadHeaders -OutFile $destination -ErrorAction Stop | Out-Null
  $download = Get-Item -LiteralPath $destination
  Assert-True ($download.Length -eq $asset.size) "Downloaded asset size differs: $($asset.name)."
  $downloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
  Assert-True ("sha256:$downloadHash" -ceq $asset.digest) "Downloaded asset digest differs: $($asset.name)."
}

$installerPath = Join-Path $downloadRoot $installerName
$sidecarPath = Join-Path $downloadRoot $sidecarName
$installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
$sidecarText = [IO.File]::ReadAllText($sidecarPath).Trim()
Assert-True ($sidecarText -ceq "$installerHash  $installerName") 'Installer SHA-256 sidecar differs from its payload.'

# The installer runs in a later workflow step without this token in its environment.
Remove-Item Env:\GITHUB_TOKEN
Write-Host "Verified draft v$Version at $SourceCommit; installer, sidecar, size and SHA-256 agree."
Write-Host "Installer SHA-256: $installerHash"
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_STEP_SUMMARY)) {
  @(
    '### Verified draft installer identity'
    "- Release ID: $ReleaseId"
    "- Source commit: $SourceCommit"
    "- Installer asset ID: $($installerAsset.id)"
    "- Installer SHA-256: $installerHash"
    "- Sidecar asset ID: $($sidecarAsset.id)"
    "- Sidecar SHA-256: $($sidecarAsset.digest.Substring(7))"
    '- Before publishing, verify the draft still has these asset IDs and SHA-256; rerun smoke if either asset changed.'
  ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
