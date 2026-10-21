!include "${__FILEDIR__}\orca-installer-hooks.nsh"

!ifndef BUILD_UNINSTALLER
Var /GLOBAL OrcaTest2SavedProfile

!macro customInit
  StrCpy $OrcaTest2SavedProfile ""
  Push $0
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 == ""
    StrCpy $0 "$INSTDIR"
  ${endif}
  ${if} ${FileExists} "$0\orca-test2-profile.json"
    InitPluginsDir
    ClearErrors
    CopyFiles /SILENT "$0\orca-test2-profile.json" "$PLUGINSDIR\orca-test2-profile.json"
    ${if} ${Errors}
      SetErrorLevel 2
      Quit
    ${endif}
    StrCpy $OrcaTest2SavedProfile "$PLUGINSDIR\orca-test2-profile.json"
  ${elseIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
    ; An established install with a missing pointer must never adopt new defaults.
    SetErrorLevel 2
    Quit
  ${endif}
  Pop $0
!macroend

!macro orcaRestoreTest2Profile
  ${if} $OrcaTest2SavedProfile != ""
    ClearErrors
    CopyFiles /SILENT "$OrcaTest2SavedProfile" "$INSTDIR\orca-test2-profile.json"
    ${if} ${Errors}
      SetErrorLevel 2
      Quit
    ${endif}
  ${endif}
!macroend
!endif
