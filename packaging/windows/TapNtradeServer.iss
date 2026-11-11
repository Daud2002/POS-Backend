; Inno Setup script for TapNtradeServerSetup.exe — the store server for a
; shop's cashier PC. Built by packaging/windows/build.ps1, which stages
; everything under packaging\windows\stage first.
;
; An upgrade is the same installer run again: it stops the server, replaces
; the program files and runs setup.ps1, which keeps the database, keys and
; config in C:\ProgramData\TapNtrade untouched.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6D7C2F51-3C1B-4C47-9A0E-2B7E9F3A1D10}
AppName=TapNtrade Server
AppVersion={#AppVersion}
AppPublisher=TapNtrade
AppPublisherURL=https://tapntrade.store
DefaultDirName={autopf}\TapNtrade Server
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputBaseFilename=TapNtradeServerSetup
OutputDir=out
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0
WizardStyle=modern
UninstallDisplayName=TapNtrade Server
SetupLogging=yes

[Tasks]
Name: "privatenet"; Description: "Set this PC's network to Private (needed for phones and tablets to connect)"; Flags: checkedonce

[Files]
Source: "stage\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
Source: "stage\pgsql\*"; DestDir: "{app}\pgsql"; Flags: recursesubdirs ignoreversion
Source: "stage\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion
Source: "stage\web\*"; DestDir: "{app}\web"; Flags: recursesubdirs ignoreversion
Source: "stage\winsw\*"; DestDir: "{app}\winsw"; Flags: ignoreversion
Source: "stage\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "stage\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\TapNtrade"; Filename: "https://localhost"
Name: "{autoprograms}\TapNtrade Server setup"; Filename: "http://localhost/setup"
Name: "{autodesktop}\TapNtrade"; Filename: "https://localhost"

[Run]
Filename: "http://localhost/setup"; Description: "Open the TapNtrade Server setup page"; Flags: postinstall shellexec nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -InstallDir ""{app}"""; Flags: waituntilterminated runhidden; RunOnceId: "TapNtradeUninstall"

[Code]
function PrivateNetFlag(Param: String): String;
begin
  if WizardIsTaskSelected('privatenet') then Result := '-MakeNetworkPrivate' else Result := '';
end;

{ The runtime, then setup.ps1, run here rather than in [Run] so a failed
  setup is reported instead of the wizard saying it finished. setup.ps1
  exits non-zero on any failure and logs every step to setup.log. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Args: String;
begin
  if CurStep <> ssPostInstall then Exit;

  WizardForm.StatusLabel.Caption := 'Installing Visual C++ runtime...';
  { 0 = installed, 1638 = a newer one is already there, 3010 = needs a restart: all fine. }
  Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'), '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, Code);

  WizardForm.StatusLabel.Caption := 'Setting up the database and server (this takes a minute)...';
  Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\setup.ps1') +
    '" -InstallDir "' + ExpandConstant('{app}') + '" ' + PrivateNetFlag('');
  if (not Exec('powershell.exe', Args, '', SW_HIDE, ewWaitUntilTerminated, Code)) or (Code <> 0) then
    MsgBox('TapNtrade Server was copied to this PC, but its setup did not finish (code ' + IntToStr(Code) + ').' + #13#10#13#10 +
      'The details are in C:\ProgramData\TapNtrade\logs\setup.log.' + #13#10 +
      'Send that file to TapNtrade support.', mbError, MB_OK);
end;

{ Stop the running server before its files are replaced on an upgrade. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  if FileExists(ExpandConstant('{app}\winsw\TapNtradeServer.exe')) then
  begin
    Exec(ExpandConstant('{app}\winsw\TapNtradeServer.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
    { A backup before the new version's migrations run. }
    Exec('powershell.exe', ExpandConstant('-NoProfile -ExecutionPolicy Bypass -File "{app}\scripts\backup.ps1" -Force'), '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
  Result := '';
end;
