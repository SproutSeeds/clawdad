# ClawDad for Windows

This is the private native Windows companion for the ClawDad iPhone app. It runs the same bundled local ClawDad workspace as the macOS app, advertises a distinct Windows computer identity to the secure relay, and provides Windows screen, input, clipboard, display, shortcut, and Windows Terminal-tab controls to Remote Assist.

## User flow

1. Install and open `ClawDad.Windows.exe` on Windows 10 version 2004 or newer, or Windows 11.
2. Sign in to the Codex CLI on that Windows account and keep the ClawDad companion running.
3. In ClawDad Settings on Windows, create a Pair iPhone code.
4. On iPhone, open the computer selector, choose **Add Computer**, and scan the code.
5. Switch between the saved Mac and Windows entries from the selector. Projects, threads, and Remote Assist follow the active computer.

On first launch, the Windows companion creates its own private computer identity and relay workspace under `%USERPROFILE%\.clawdad`. Do not copy the Mac's `cloud.json` onto Windows; each computer keeps a distinct identity and the iPhone saves both pairings.

Remote Assist controls standard-integrity Windows apps. Windows blocks `SendInput` from crossing into an elevated administrator app; when an elevated app is focused, ClawDad reports that boundary instead of silently claiming success. Run ClawDad at the same elevation level only when that session requires it.

Windows Terminal is used for opening and selecting Codex CLI tabs. The WebView2 evergreen runtime is included with current Windows releases and can also be installed through Microsoft Edge WebView2 Runtime.

## Build on Windows

Prerequisites:

- .NET 8 SDK
- Node.js and npm
- Windows Terminal
- Visual Studio Build Tools with the Windows 10/11 SDK

From PowerShell at the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File native\windows\build.ps1 -Architecture x64
```

The self-contained folder and ZIP are written to `native\windows\dist\win-x64`. Run `install.ps1` from the extracted folder to install it for the current Windows account and create a Start Menu shortcut.

The native iPhone/macOS release and this Windows package remain private release lanes. This build script does not publish the npm CLI.
