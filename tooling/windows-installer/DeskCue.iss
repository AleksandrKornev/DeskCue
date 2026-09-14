#define DeskCueAppName "DeskCue"
#define DeskCuePublisher "DeskCue"
#define DeskCueUrl "https://deskcue.io"
#ifndef DeskCueIconFile
  #define DeskCueIconFile AddBackslash(SourcePath) + "..\..\apps\tray\DeskCue.Tray\Assets\deskcue.ico"
#endif

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef PayloadDir
  #define PayloadDir AddBackslash(SourcePath) + "dist\payload"
#endif
#ifndef OutputDir
  #define OutputDir AddBackslash(SourcePath) + "dist\installer"
#endif

[Setup]
AppId={{D6E1431C-5D1D-44C5-8F2F-72490AA78D5D}
AppName={#DeskCueAppName}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}.0
AppPublisher={#DeskCuePublisher}
AppPublisherURL={#DeskCueUrl}
AppSupportURL={#DeskCueUrl}
AppUpdatesURL={#DeskCueUrl}
DefaultDirName={localappdata}\Programs\DeskCue
DefaultGroupName=DeskCue
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=DeskCueSetup-{#AppVersion}-win-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
ChangesEnvironment=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\DeskCue.Tray.exe
UninstallDisplayName=DeskCue
SetupIconFile={#DeskCueIconFile}

[Messages]
ConfirmUninstall=Remove DeskCue application files, DeskCue-owned command-line PATH entry, shortcuts, and autostart entry? Your data will be kept at {localappdata}\DeskCue. To remove DeskCue completely, delete that folder manually after uninstalling.
UninstalledAll=DeskCue was removed. Your data remains at {localappdata}\DeskCue. Delete that folder manually if you also want to remove all DeskCue data.

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Excludes: "payload-manifest.json"; \
  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\payload-manifest.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\LICENSE"; DestDir: "{app}"; DestName: ".deskcue-path-owned"; \
  Flags: ignoreversion; Check: ShouldAddDeskCueToUserPath
Source: "{#PayloadDir}\payload-manifest.json"; DestDir: "{app}"; \
  DestName: ".deskcue-update-committed"; Flags: ignoreversion; Check: ShouldWritePayloadCommitMarker

[Icons]
Name: "{group}\DeskCue"; Filename: "{app}\DeskCue.Tray.exe"

[Tasks]
Name: "autostart"; Description: "Start DeskCue when I sign in"; \
  GroupDescription: "Startup:"; Flags: checkedonce

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
  ValueData: "{code:UpdatedUserPath}"; Flags: preservestringtype; Check: ShouldAddDeskCueToUserPath
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "DeskCue"; ValueData: """{app}\DeskCue.Tray.exe"" --autostart"; \
  Tasks: autostart; Check: ShouldInitializeAutostart
#ifdef FailureInjection
Root: HKLM; Subkey: "Software\DeskCueInstallerFailureProbe"; ValueType: dword; ValueName: "Fail"; \
  ValueData: "1"; Check: ShouldInjectPostCopyFailure
#endif
Root: HKCU; Subkey: "Software\DeskCue\InstallerState"; ValueType: dword; \
  ValueName: "PayloadCommitted"; ValueData: "1"; Check: ShouldWritePayloadCommitMarker

[Run]
Filename: "{app}\DeskCue.Tray.exe"; Description: "Launch DeskCue"; Flags: nowait postinstall skipifsilent
Filename: "{app}\DeskCue.Tray.exe"; Parameters: "--autostart"; Flags: nowait runhidden; \
  Check: ShouldStartTrayAfterSilentUpdate

[Code]
const
  ErrorSuccess = 0;
  ErrorFileNotFound = 2;
  ErrorPathNotFound = 3;
  ErrorAccessDenied = 5;
  KeyQueryValue = $0001;
  KeyWow6464Key = $0100;
  RegTypeString = 1;
  RegTypeExpandString = 2;
  RegistryValueMissing = 0;
  RegistryValueStringPresent = 1;
  RegistryValueWrongType = 2;
  RegistryValueReadError = 3;
  WindowsHkeyCurrentUser = $80000001;
  PayloadBackupDirectoryName = '.deskcue-update-backup';
  PayloadDiscardDirectoryName = '.deskcue-update-discard';
  PayloadCommitMarkerName = '.deskcue-update-committed';
  PathOwnershipMarkerName = '.deskcue-path-owned';
  DeskCueAutostartKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  DeskCueAutostartValueName = 'DeskCue';
  DeskCueInstallerStateKey = 'Software\DeskCue\InstallerState';
  DeskCuePayloadCommittedValueName = 'PayloadCommitted';
  UserEnvironmentKey = 'Environment';
  UserPathValueName = 'Path';

var
  HadPreviousInstall: Boolean;
  InitialUserPath: String;
  InstallCompleted: Boolean;
  PathNeedsInstall: Boolean;
  PayloadBackupActive: Boolean;

function RegOpenKeyExW(
  Key: LongWord;
  SubKey: String;
  Options: LongWord;
  DesiredAccess: LongWord;
  var ResultKey: LongWord
): Longint;
  external 'RegOpenKeyExW@advapi32.dll stdcall';

function RegQueryValueExW(
  Key: LongWord;
  ValueName: String;
  Reserved: LongWord;
  var ValueType: LongWord;
  Data: LongWord;
  var DataSize: LongWord
): Longint;
  external 'RegQueryValueExW@advapi32.dll stdcall';

function RegCloseKey(Key: LongWord): Longint;
  external 'RegCloseKey@advapi32.dll stdcall';

function ReadCommandLineFlag(const FlagName: String): Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
  begin
    if CompareText(ParamStr(Index), FlagName) = 0 then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function ReadUserRegistryStringValue(
  const SubKey: String;
  const ValueName: String;
  AllowExpandString: Boolean;
  var Value: String
): Integer;
var
  CloseStatus: Longint;
  DataSize: LongWord;
  DataType: LongWord;
  KeyHandle: LongWord;
  OpenStatus: Longint;
  QueryStatus: Longint;
begin
  Value := '';
  KeyHandle := 0;
  OpenStatus := RegOpenKeyExW(
    WindowsHkeyCurrentUser,
    SubKey,
    0,
    KeyQueryValue or KeyWow6464Key,
    KeyHandle
  );
  if (OpenStatus = ErrorFileNotFound) or (OpenStatus = ErrorPathNotFound) then
  begin
    Result := RegistryValueMissing;
    Exit;
  end;
  if OpenStatus <> ErrorSuccess then
  begin
    Log(Format('Registry key open failed with status %d for HKCU\%s.', [OpenStatus, SubKey]));
    Result := RegistryValueReadError;
    Exit;
  end;

#ifdef FailureInjection
  if ReadCommandLineFlag('/TESTFAILREGISTRYACCESSDENIED') then
  begin
    RegCloseKey(KeyHandle);
    Log(Format('Injected registry query status %d for HKCU\%s\%s.', [ErrorAccessDenied, SubKey, ValueName]));
    Result := RegistryValueReadError;
    Exit;
  end;
#endif

  DataSize := 0;
  DataType := 0;
  QueryStatus := RegQueryValueExW(KeyHandle, ValueName, 0, DataType, 0, DataSize);
  CloseStatus := RegCloseKey(KeyHandle);
  if CloseStatus <> ErrorSuccess then
  begin
    Log(Format('Registry key close failed with status %d for HKCU\%s.', [CloseStatus, SubKey]));
    Result := RegistryValueReadError;
    Exit;
  end;
  if QueryStatus = ErrorFileNotFound then
  begin
    Result := RegistryValueMissing;
    Exit;
  end;
  if QueryStatus <> ErrorSuccess then
  begin
    Log(Format('Registry value query failed with status %d for HKCU\%s\%s.', [QueryStatus, SubKey, ValueName]));
    Result := RegistryValueReadError;
    Exit;
  end;
  if (DataType <> RegTypeString) and (not AllowExpandString or (DataType <> RegTypeExpandString)) then
  begin
    Log(Format('Registry value has unsupported type %d for HKCU\%s\%s.', [DataType, SubKey, ValueName]));
    Result := RegistryValueWrongType;
    Exit;
  end;
  if not RegQueryStringValue(HKCU, SubKey, ValueName, Value) then
  begin
    Log(Format('Registry string read failed after a successful type query for HKCU\%s\%s.', [SubKey, ValueName]));
    Result := RegistryValueReadError;
    Exit;
  end;

  Result := RegistryValueStringPresent;
end;

function NormalizePathEntry(Value: String): String;
begin
  Value := Trim(Value);
  if (Length(Value) >= 2) and (Value[1] = '"') and (Value[Length(Value)] = '"') then
    Value := Copy(Value, 2, Length(Value) - 2);
  while (Length(Value) > 3) and ((Value[Length(Value)] = '\') or (Value[Length(Value)] = '/')) do
    Delete(Value, Length(Value), 1);
  Result := Lowercase(Value);
end;

function ConsumePathEntry(var RemainingPath: String): String;
var
  SeparatorIndex: Integer;
begin
  SeparatorIndex := Pos(';', RemainingPath);
  if SeparatorIndex = 0 then
  begin
    Result := RemainingPath;
    RemainingPath := '';
  end
  else
  begin
    Result := Copy(RemainingPath, 1, SeparatorIndex - 1);
    Delete(RemainingPath, 1, SeparatorIndex);
  end;
end;

function PathContainsEntry(const PathValue: String; const Entry: String): Boolean;
var
  CurrentEntry: String;
  NormalizedEntry: String;
  RemainingPath: String;
begin
  Result := False;
  NormalizedEntry := NormalizePathEntry(Entry);
  RemainingPath := PathValue;
  while RemainingPath <> '' do
  begin
    CurrentEntry := ConsumePathEntry(RemainingPath);
    if NormalizePathEntry(CurrentEntry) = NormalizedEntry then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function RemoveDeskCueFromUserPath: Boolean;
var
  ExistingPath: String;
  DeskCueBinPath: String;
  CurrentEntry: String;
  RemainingPath: String;
  RegistryStatus: Integer;
  UpdatedPath: String;
  VerifiedPath: String;
begin
  Result := True;
  RegistryStatus := ReadUserRegistryStringValue(
    UserEnvironmentKey,
    UserPathValueName,
    True,
    ExistingPath
  );
  if RegistryStatus = RegistryValueMissing then
    Exit;
  if RegistryStatus <> RegistryValueStringPresent then
  begin
    Result := False;
    Exit;
  end;

  DeskCueBinPath := NormalizePathEntry(ExpandConstant('{app}\bin'));
  if not PathContainsEntry(ExistingPath, DeskCueBinPath) then
    Exit;
#ifdef FailureInjection
  if ReadCommandLineFlag('/TESTFAILREGISTRYCLEANUP') then
  begin
    Result := False;
    Exit;
  end;
#endif
  RemainingPath := ExistingPath;
  UpdatedPath := '';
  while RemainingPath <> '' do
  begin
    CurrentEntry := ConsumePathEntry(RemainingPath);
    if (Trim(CurrentEntry) <> '') and (NormalizePathEntry(CurrentEntry) <> DeskCueBinPath) then
    begin
      if UpdatedPath <> '' then
        UpdatedPath := UpdatedPath + ';';
      UpdatedPath := UpdatedPath + CurrentEntry;
    end;
  end;

  if UpdatedPath = ExistingPath then
    Exit;
  if UpdatedPath = '' then
  begin
    Result := RegDeleteValue(HKCU, UserEnvironmentKey, UserPathValueName) and
      not RegValueExists(HKCU, UserEnvironmentKey, UserPathValueName);
  end
  else
  begin
    Result := RegWriteExpandStringValue(HKCU, UserEnvironmentKey, UserPathValueName, UpdatedPath) and
      RegQueryStringValue(HKCU, UserEnvironmentKey, UserPathValueName, VerifiedPath) and
      (VerifiedPath = UpdatedPath);
  end;
end;

function PathOwnershipMarker: String;
begin
  Result := ExpandConstant('{app}\') + PathOwnershipMarkerName;
end;

function ShouldAddDeskCueToUserPath: Boolean;
begin
  PathNeedsInstall := not PathContainsEntry(InitialUserPath, ExpandConstant('{app}\bin'));
  Result := PathNeedsInstall;
end;

function UpdatedUserPath(Unused: String): String;
begin
  if InitialUserPath = '' then
    Result := ExpandConstant('{app}\bin')
  else if InitialUserPath[Length(InitialUserPath)] = ';' then
    Result := InitialUserPath + ExpandConstant('{app}\bin')
  else
    Result := InitialUserPath + ';' + ExpandConstant('{app}\bin');
end;

function RemoveOwnedDeskCueAutostart: Boolean;
var
  CurrentValue: String;
  ExpectedValue: String;
  RegistryStatus: Integer;
begin
  Result := True;
  ExpectedValue := '"' + ExpandConstant('{app}\DeskCue.Tray.exe') + '" --autostart';
  RegistryStatus := ReadUserRegistryStringValue(
    DeskCueAutostartKey,
    DeskCueAutostartValueName,
    False,
    CurrentValue
  );
  if RegistryStatus = RegistryValueMissing then
    Exit;
  if RegistryStatus <> RegistryValueStringPresent then
  begin
    Result := False;
    Exit;
  end;
  if CompareText(CurrentValue, ExpectedValue) <> 0 then
    Exit;
#ifdef FailureInjection
  if ReadCommandLineFlag('/TESTFAILREGISTRYCLEANUP') then
  begin
    Result := False;
    Exit;
  end;
#endif

  Result := RegDeleteValue(HKCU, DeskCueAutostartKey, DeskCueAutostartValueName) and
    not RegValueExists(HKCU, DeskCueAutostartKey, DeskCueAutostartValueName);
end;

function PathExists(const Path: String): Boolean;
begin
  Result := FileExists(Path) or DirExists(Path);
end;

function DeletePath(const Path: String): Boolean;
begin
  Result := True;
  if DirExists(Path) then
    Result := DelTree(Path, True, True, True)
  else if FileExists(Path) then
    Result := DeleteFile(Path);
end;

function PayloadBackupRoot: String;
begin
  Result := ExpandConstant('{app}\') + PayloadBackupDirectoryName;
end;

function PayloadDiscardRoot: String;
begin
  Result := ExpandConstant('{app}\') + PayloadDiscardDirectoryName;
end;

function PayloadCommitMarker: String;
begin
  Result := ExpandConstant('{app}\') + PayloadCommitMarkerName;
end;

function IsPayloadCommitRegistered: Boolean;
var
  Value: Cardinal;
begin
  Result := RegQueryDWordValue(
    HKCU,
    DeskCueInstallerStateKey,
    DeskCuePayloadCommittedValueName,
    Value
  ) and (Value = 1);
end;

function ClearPayloadCommitAuthority: Boolean;
begin
  Result := True;
  if not RegValueExists(HKCU, DeskCueInstallerStateKey, DeskCuePayloadCommittedValueName) and
    not FileExists(PayloadCommitMarker) then
    Exit;
#ifdef FailureInjection
  if ReadCommandLineFlag('/TESTFAILCOMMITCLEAR') then
  begin
    Result := False;
    Exit;
  end;
#endif
  if RegValueExists(HKCU, DeskCueInstallerStateKey, DeskCuePayloadCommittedValueName) then
    Result := RegDeleteValue(HKCU, DeskCueInstallerStateKey, DeskCuePayloadCommittedValueName) and
      not RegValueExists(HKCU, DeskCueInstallerStateKey, DeskCuePayloadCommittedValueName);
  if Result and FileExists(PayloadCommitMarker) then
    Result := DeleteFile(PayloadCommitMarker) and not FileExists(PayloadCommitMarker);
end;

function ShouldWritePayloadCommitMarker: Boolean;
begin
  Result := PayloadBackupActive;
end;

function ShouldInjectPostCopyFailure: Boolean;
begin
  Result := ReadCommandLineFlag('/TESTFAILPOSTCOPY');
end;

function MoveManagedPathToBackup(const RelativePath: String; var ErrorMessage: String): Boolean;
var
  BackupPath: String;
  SourcePath: String;
begin
  Result := True;
  SourcePath := ExpandConstant('{app}\') + RelativePath;
  if not PathExists(SourcePath) then
    Exit;

  BackupPath := PayloadBackupRoot + '\' + RelativePath;
  if not ForceDirectories(ExtractFileDir(BackupPath)) or not RenameFile(SourcePath, BackupPath) then
  begin
    ErrorMessage := 'DeskCue could not preserve the current installation before updating.';
    Result := False;
  end;
end;

function RestoreManagedPath(const RelativePath: String; var ErrorMessage: String): Boolean;
var
  BackupPath: String;
  DestinationPath: String;
begin
  Result := True;
  BackupPath := PayloadBackupRoot + '\' + RelativePath;
  if not PathExists(BackupPath) then
    Exit;

  DestinationPath := ExpandConstant('{app}\') + RelativePath;
  if not DeletePath(DestinationPath) or not ForceDirectories(ExtractFileDir(DestinationPath)) or
    not RenameFile(BackupPath, DestinationPath) then
  begin
    ErrorMessage := 'DeskCue could not restore the previous installation. Re-run the installer before starting DeskCue.';
    Result := False;
  end;
end;

function RestoreManagedPayload(var ErrorMessage: String): Boolean;
begin
  Result := RestoreManagedPath('app', ErrorMessage);
  if Result then Result := RestoreManagedPath('bin', ErrorMessage);
  if Result then Result := RestoreManagedPath('licenses', ErrorMessage);
  if Result then Result := RestoreManagedPath('runtime', ErrorMessage);
  if Result then Result := RestoreManagedPath('DeskCue.Tray.exe', ErrorMessage);
  if Result then Result := RestoreManagedPath('LICENSE', ErrorMessage);
  if Result then Result := RestoreManagedPath('THIRD-PARTY-NOTICES.json', ErrorMessage);
  if Result then Result := RestoreManagedPath('payload-manifest.json', ErrorMessage);
  if Result and DirExists(PayloadBackupRoot) then
    Result := DelTree(PayloadBackupRoot, True, True, True);
  if Result then
    PayloadBackupActive := False;
end;

function RecoverInterruptedUpdate(var ErrorMessage: String): Boolean;
var
  HasCommittedPayload: Boolean;
begin
  Result := True;
  if DirExists(PayloadDiscardRoot) and not DelTree(PayloadDiscardRoot, True, True, True) then
  begin
    ErrorMessage := 'DeskCue could not clean a finalized update backup.';
    Result := False;
    Exit;
  end;
  HasCommittedPayload := FileExists(PayloadCommitMarker) and IsPayloadCommitRegistered;
  if not DirExists(PayloadBackupRoot) then
  begin
    if not ClearPayloadCommitAuthority then
    begin
      ErrorMessage := 'DeskCue could not clear stale update recovery state.';
      Result := False;
    end;
    Exit;
  end;

  if HasCommittedPayload then
  begin
    if not DelTree(PayloadBackupRoot, True, True, True) then
    begin
      ErrorMessage := 'DeskCue could not clean a finalized update backup.';
      Result := False;
    end;
    if Result and DirExists(PayloadBackupRoot) then
    begin
      ErrorMessage := 'DeskCue could not confirm finalized update backup cleanup.';
      Result := False;
    end;
    if Result and not ClearPayloadCommitAuthority then
    begin
      ErrorMessage := 'DeskCue could not clear finalized update recovery state.';
      Result := False;
    end;
    Exit;
  end;

  PayloadBackupActive := True;
  Result := RestoreManagedPayload(ErrorMessage);
  if Result and not ClearPayloadCommitAuthority then
  begin
    ErrorMessage := 'DeskCue restored the previous payload but could not clear update recovery state.';
    Result := False;
  end;
end;

function BackupManagedPayload(var ErrorMessage: String): Boolean;
begin
  Result := ForceDirectories(PayloadBackupRoot);
  if not Result then
  begin
    ErrorMessage := 'DeskCue could not create an update rollback directory.';
    Exit;
  end;

  PayloadBackupActive := True;
  Result := MoveManagedPathToBackup('app', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('bin', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('licenses', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('runtime', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('DeskCue.Tray.exe', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('LICENSE', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('THIRD-PARTY-NOTICES.json', ErrorMessage);
  if Result then Result := MoveManagedPathToBackup('payload-manifest.json', ErrorMessage);
  if not Result then
    RestoreManagedPayload(ErrorMessage);
end;

procedure FinalizePayloadBackup;
begin
  if not PayloadBackupActive then
    Exit;
  PayloadBackupActive := False;
  if DelTree(PayloadBackupRoot, True, True, True) and not DirExists(PayloadBackupRoot) then
  begin
    if not ClearPayloadCommitAuthority then
      Log('DeskCue will retry cleanup of finalized update recovery state on the next maintenance operation.');
  end
  else
    Log('DeskCue will retry cleanup of the finalized update backup on the next maintenance operation.');
end;

function InitializeSetup: Boolean;
var
  RegistryStatus: Integer;
begin
  HadPreviousInstall := GetPreviousData('DeskCueInstalled', '') = '1';
  InitialUserPath := '';
  RegistryStatus := ReadUserRegistryStringValue(
    UserEnvironmentKey,
    UserPathValueName,
    True,
    InitialUserPath
  );
  if (RegistryStatus = RegistryValueReadError) or (RegistryStatus = RegistryValueWrongType) then
    RaiseException('DeskCue could not read the existing user PATH safely. Fix its registry value and retry.');
  InstallCompleted := False;
  PathNeedsInstall := False;
  PayloadBackupActive := False;
  Result := True;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'DeskCueInstalled', '1');
end;

function ShouldInitializeAutostart: Boolean;
begin
  Result := not HadPreviousInstall;
end;

function ShouldStartTrayAfterSilentUpdate: Boolean;
begin
  Result := WizardSilent and ReadCommandLineFlag('/UPDATE') and ReadCommandLineFlag('/STARTTRAY=1');
end;

function UpdateReadyMemo(
  Space: String;
  NewLine: String;
  MemoUserInfoInfo: String;
  MemoDirInfo: String;
  MemoTypeInfo: String;
  MemoComponentsInfo: String;
  MemoGroupInfo: String;
  MemoTasksInfo: String
): String;
begin
  Result := MemoDirInfo + NewLine + NewLine +
    'Command line:' + NewLine +
    Space + 'DeskCue adds ' + ExpandConstant('{app}\bin') + ' to your user PATH.' + NewLine +
    Space + 'Open a new terminal after setup before using the deskcue command.' + NewLine + NewLine +
    'Data:' + NewLine +
    Space + 'DeskCue stores user data at ' + ExpandConstant('{localappdata}\DeskCue') + '.' + NewLine +
    Space + 'Uninstalling the application keeps this data.';
  if MemoTasksInfo <> '' then
    Result := Result + NewLine + NewLine + MemoTasksInfo;
end;

function RunInstalledCommand(const Filename: String; const Parameters: String; var ErrorMessage: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not FileExists(Filename) then
    Exit;

  if not Exec(Filename, Parameters, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    ErrorMessage := 'Windows could not start a DeskCue shutdown helper.';
    Result := False;
    Exit;
  end;
  if ResultCode <> 0 then
  begin
    ErrorMessage := 'DeskCue did not stop cleanly. Close active DeskCue windows and try again.';
    Result := False;
  end;
end;

function QuiesceInstalledDeskCue(var ErrorMessage: String): Boolean;
var
  TrayPath: String;
  CliShimPath: String;
begin
  TrayPath := ExpandConstant('{app}\DeskCue.Tray.exe');
  CliShimPath := ExpandConstant('{app}\bin\deskcue.cmd');

  Result := RunInstalledCommand(TrayPath, '--shutdown-for-update', ErrorMessage);
  if not Result then
    Exit;
  if not FileExists(CliShimPath) then
    Exit;

  Result := RunInstalledCommand(
    ExpandConstant('{cmd}'),
    '/D /S /C ""' + CliShimPath + '" host shutdown --wait --timeout 15000"',
    ErrorMessage
  );
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ErrorMessage: String;
begin
  Result := '';
  if not HadPreviousInstall then
    Exit;
  if not RecoverInterruptedUpdate(ErrorMessage) then
  begin
    Result := ErrorMessage;
    Exit;
  end;
  if not ReadCommandLineFlag('/UPDATE') then
  begin
    Result := 'Automatic updates are not configured for this preview. Close DeskCue, uninstall it, then run ' +
      'this installer again. Uninstall keeps your data at ' + ExpandConstant('{localappdata}\DeskCue') + '. ' +
      'Use Check for updates or deskcue update after a release feed is configured.';
    Exit;
  end;
  if not QuiesceInstalledDeskCue(ErrorMessage) then
  begin
    Result := ErrorMessage;
    Exit;
  end;
  if not BackupManagedPayload(ErrorMessage) then
  begin
    Result := ErrorMessage;
    Exit;
  end;

#ifdef FailureInjection
  if ReadCommandLineFlag('/TESTFAILAFTERBACKUP') then
    RaiseException('Injected failure after payload backup.');
#endif
end;

function InitializeUninstall: Boolean;
var
  ErrorMessage: String;
begin
  Result := RecoverInterruptedUpdate(ErrorMessage);
  if Result then
    Result := QuiesceInstalledDeskCue(ErrorMessage);
  if not Result and not UninstallSilent then
    MsgBox(ErrorMessage, mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    FinalizePayloadBackup;
    InstallCompleted := True;
  end;
end;

procedure DeinitializeSetup;
var
  ErrorMessage: String;
begin
  if not InstallCompleted then
  begin
    if PathNeedsInstall then
    begin
      if not RemoveDeskCueFromUserPath then
        Log('DeskCue could not roll back its CLI PATH entry after setup failure.')
      else if FileExists(PathOwnershipMarker) and not DeleteFile(PathOwnershipMarker) then
        Log('DeskCue rolled back its CLI PATH entry but could not remove its ownership marker.');
    end;
    if PayloadBackupActive and not RestoreManagedPayload(ErrorMessage) then
      Log(ErrorMessage);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CleanupError: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    if not RemoveOwnedDeskCueAutostart then
      CleanupError := 'DeskCue could not remove its autostart registry value. The installation was kept for retry.';
    if FileExists(PathOwnershipMarker) then
    begin
      if (CleanupError = '') and not RemoveDeskCueFromUserPath then
        CleanupError := 'DeskCue could not remove its CLI PATH entry. The installation was kept for retry.';
      if (CleanupError = '') and not DeleteFile(PathOwnershipMarker) then
        CleanupError := 'DeskCue removed its CLI PATH entry but could not confirm ownership cleanup.';
    end;
    if CleanupError <> '' then
    begin
      Log(CleanupError);
      RaiseException(CleanupError);
    end;
  end;
end;
