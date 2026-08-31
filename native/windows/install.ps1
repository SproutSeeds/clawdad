param(
  [switch]$DesktopShortcut
)

$ErrorActionPreference = "Stop"
$SourceDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDirectory = Join-Path $env:LOCALAPPDATA "Programs\ClawDad"
$StartMenuDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$ShortcutPath = Join-Path $StartMenuDirectory "ClawDad.lnk"

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
Get-ChildItem -Force $SourceDirectory | Where-Object { $_.Name -ne "install.ps1" } | ForEach-Object {
  Copy-Item -Recurse -Force $_.FullName $InstallDirectory
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = Join-Path $InstallDirectory "ClawDad.Windows.exe"
$Shortcut.WorkingDirectory = $InstallDirectory
$Shortcut.Description = "ClawDad desktop companion"
$Shortcut.Save()

if ($DesktopShortcut) {
  $DesktopPath = [Environment]::GetFolderPath("Desktop")
  Copy-Item -Force $ShortcutPath (Join-Path $DesktopPath "ClawDad.lnk")
}

Start-Process (Join-Path $InstallDirectory "ClawDad.Windows.exe")
Write-Host "ClawDad installed for this Windows account at $InstallDirectory"
