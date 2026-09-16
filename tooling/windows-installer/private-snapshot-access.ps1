function New-PrivateSnapshotSecurity {
  param(
    [Parameter(Mandatory)]
    [System.Security.Principal.SecurityIdentifier]$CurrentSid,

    [Parameter(Mandatory)]
    [ValidateSet('ReadOnly', 'Cleanup')]
    [string]$Mode,

    [Parameter(Mandatory)]
    [bool]$IsDirectory
  )

  $rights = if ($Mode -eq 'ReadOnly') {
    [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
  } else {
    [System.Security.AccessControl.FileSystemRights]::FullControl
  }
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  if ($IsDirectory) {
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $CurrentSid,
        $rights,
        $inheritance,
        $propagation,
        [System.Security.AccessControl.AccessControlType]::Allow
      ))
    if ($CurrentSid -ne $systemSid) {
      $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
          $systemSid,
          [System.Security.AccessControl.FileSystemRights]::FullControl,
          $inheritance,
          $propagation,
          [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
  } else {
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $CurrentSid,
        $rights,
        [System.Security.AccessControl.AccessControlType]::Allow
      ))
    if ($CurrentSid -ne $systemSid) {
      $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
          $systemSid,
          [System.Security.AccessControl.FileSystemRights]::FullControl,
          [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
  }
  $security.SetAccessRuleProtection($true, $false)
  return $security
}

function Set-PrivateSnapshotItemAccess {
  param(
    [Parameter(Mandatory)]
    [System.IO.FileSystemInfo]$Item,

    [Parameter(Mandatory)]
    [System.Security.Principal.SecurityIdentifier]$CurrentSid,

    [Parameter(Mandatory)]
    [ValidateSet('ReadOnly', 'Cleanup')]
    [string]$Mode
  )

  $isDirectory = $Item -is [System.IO.DirectoryInfo]
  $security = New-PrivateSnapshotSecurity -CurrentSid $CurrentSid -Mode $Mode -IsDirectory $isDirectory
  if ($isDirectory) {
    [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]$Item, $security)
  } else {
    [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.FileInfo]$Item, $security)
  }
}

function Set-PrivateSnapshotAccess {
  param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [ValidateSet('ReadOnly', 'Cleanup')]
    [string]$Mode
  )

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $root = Get-Item -LiteralPath $Path -Force
  $descendants = @(Get-ChildItem -LiteralPath $root.FullName -Force -Recurse)
  $items = if ($Mode -eq 'ReadOnly') {
    @($root) + $descendants
  } else {
    $descendants + @($root)
  }
  foreach ($item in $items) {
    Set-PrivateSnapshotItemAccess -Item $item -CurrentSid $currentSid -Mode $Mode
  }
}

function Assert-PrivateSnapshotAccess {
  param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [string[]]$ProbeDirectories,

    [Parameter()]
    [string[]]$ProbeFiles = @()
  )

  $longPath = '\\?\' + [System.IO.Path]::GetFullPath($Path)
  & icacls.exe $longPath '/verify' '/T' '/C' '/Q' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Private compile snapshot ACL verification failed.'
  }

  foreach ($probeDirectory in $ProbeDirectories) {
    $probePath = Join-Path $probeDirectory '.deskcue-write-probe'
    try {
      [System.IO.File]::WriteAllText($probePath, 'write access must be denied')
      Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
      throw "Private compile snapshot directory remained writable: $probeDirectory"
    } catch [System.UnauthorizedAccessException] {
      if (Test-Path -LiteralPath $probePath) {
        throw "Private compile snapshot write probe left a file behind: $probePath"
      }
    }
  }

  foreach ($probeFile in $ProbeFiles) {
    try {
      $stream = [System.IO.File]::Open($probeFile, 'Open', 'Write', 'None')
      $stream.Dispose()
      throw "Private compile snapshot file remained writable: $probeFile"
    } catch [System.UnauthorizedAccessException] {
      continue
    }
  }
}

function Test-IsAccessDeniedException {
  param(
    [Parameter(Mandatory)]
    [System.Exception]$Exception
  )

  $current = $Exception
  while ($null -ne $current) {
    if (($current -is [System.UnauthorizedAccessException]) -or ($current.HResult -eq -2147024891)) {
      return $true
    }
    $current = $current.InnerException
  }
  return $false
}

function Assert-PrivateSnapshotChildDeletionDenied {
  param(
    [Parameter(Mandatory)]
    [string]$ProtectedFile
  )

  try {
    [System.IO.File]::Delete($ProtectedFile)
  } catch {
    $denied = Test-IsAccessDeniedException -Exception $_.Exception
    if ($denied -and (Test-Path -LiteralPath $ProtectedFile -PathType Leaf)) {
      return
    }
    throw
  }
  throw "Private compile session allowed deletion of a protected child: $ProtectedFile"
}
