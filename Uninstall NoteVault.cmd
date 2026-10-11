@echo off
rem Removes NoteVault and its shortcuts. Your notes in %LOCALAPPDATA%\NoteVault are kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
exit /b
