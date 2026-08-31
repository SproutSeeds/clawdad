import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Windows companion is a self-contained WinUI 3 WebView2 shell", async () => {
  const [project, window, runtime, bridge] = await Promise.all([
    source("native/windows/ClawDad.Windows/ClawDad.Windows.csproj"),
    source("native/windows/ClawDad.Windows/MainWindow.xaml.cs"),
    source("native/windows/ClawDad.Windows/RuntimeHost.cs"),
    source("native/windows/ClawDad.Windows/NativeBridge.cs"),
  ]);

  assert.match(project, /<UseWinUI>true<\/UseWinUI>/u);
  assert.match(project, /Microsoft\.WindowsAppSDK/u);
  assert.match(project, /<WindowsAppSDKSelfContained>true<\/WindowsAppSDKSelfContained>/u);
  assert.match(window, /CoreWebView2Environment\.CreateWithOptionsAsync/u);
  assert.match(window, /NavigateAuthenticated\(baseUri, _runtime\.Token\)/u);
  assert.match(runtime, /"serve",\s*"--host", LocalHost/u);
  assert.match(runtime, /"cloud-host"/u);
  assert.match(runtime, /"--host-platform", "windows"/u);
  assert.match(runtime, /EnsureInitialCloudConfiguration\(\)/u);
  assert.match(runtime, /https:\/\/clawdad-cloud\.frg\.earth/u);
  assert.match(runtime, /FileMode\.CreateNew/u);
  assert.match(runtime, /hostPlatform = "windows"/u);
  assert.match(runtime, /_job\.Add\(process\)/u);
  assert.match(bridge, /\["platform"\] = "windows"/u);
  assert.match(bridge, /case "chooseFolder"/u);
});

test("Windows companion preserves local credentials and child ownership", async () => {
  const [credentialStore, processJob, app] = await Promise.all([
    source("native/windows/ClawDad.Windows/CredentialStore.cs"),
    source("native/windows/ClawDad.Windows/ProcessJob.cs"),
    source("native/windows/ClawDad.Windows/App.xaml.cs"),
  ]);

  assert.match(credentialStore, /CredReadW/u);
  assert.match(credentialStore, /CredWriteW/u);
  assert.match(credentialStore, /CredentialPersistence\.LocalMachine/u);
  assert.match(processJob, /JobObjectLimitKillOnJobClose/u);
  assert.match(processJob, /AssignProcessToJobObject/u);
  assert.match(app, /Local\\earth\.frg\.ClawDad\.Windows/u);
});

test("Windows Remote Assist implements the iPhone control protocols", async () => {
  const [host, router, input, capture, terminal, peerPage] = await Promise.all([
    source("native/windows/ClawDad.Windows/RemoteAssist/RemoteAssistHost.cs"),
    source("native/windows/ClawDad.Windows/RemoteAssist/RemoteControlRouter.cs"),
    source("native/windows/ClawDad.Windows/RemoteAssist/WindowsInputController.cs"),
    source("native/windows/ClawDad.Windows/RemoteAssist/WindowsScreenCapture.cs"),
    source("native/windows/ClawDad.Windows/RemoteAssist/WindowsTerminalTabs.cs"),
    source("native/windows/ClawDad.Windows/RemoteAssist/remote-assist.html"),
  ]);

  for (const type of [
    "remote.assist.request",
    "remote.assist.answer",
    "remote.assist.ice",
    "remote.assist.stop",
    "remote.assist.offer",
  ]) {
    assert.match(host, new RegExp(type.replaceAll(".", "\\."), "u"));
  }
  for (const type of [
    "pointer",
    "scroll",
    "input",
    "clipboard",
    "display.select",
    "terminal.tabs.request",
    "terminal.tab.focus",
  ]) {
    assert.match(router, new RegExp(`"${type.replaceAll(".", "\\.")}"`, "u"));
  }
  assert.match(input, /"command_t" => SendChord\(\[VirtualControl\], VirtualT\)/u);
  assert.match(input, /"command_tab" => SendChord\(\[VirtualMenu\], VirtualTab\)/u);
  assert.match(input, /SendInput/u);
  assert.match(capture, /EnumDisplayMonitors/u);
  assert.match(capture, /StretchBlt/u);
  assert.match(terminal, /System\.Windows\.Automation/u);
  assert.match(terminal, /ControlType\.TabItem/u);
  assert.match(peerPage, /canvas\.captureStream\(12\)/u);
  assert.match(peerPage, /createDataChannel\("clawdad-control"/u);
});

test("Windows packaging remains private and reproducible", async () => {
  const [build, packageRuntime, readme, packageJson] = await Promise.all([
    source("native/windows/build.ps1"),
    source("native/windows/package-runtime.mjs"),
    source("native/windows/README.md"),
    source("package.json"),
  ]);

  assert.match(build, /dotnet[^\n]*publish|& \$DotNet\.Source publish/u);
  assert.match(build, /--self-contained true/u);
  assert.match(build, /Compress-Archive/u);
  assert.match(packageRuntime, /\["ci", "--omit=dev", "--force"/u);
  assert.doesNotMatch(`${build}\n${packageRuntime}`, /npm(?:\.cmd)?\s+publish/iu);
  assert.match(readme, /private native Windows companion/iu);
  assert.equal(JSON.parse(packageJson).scripts["windows:build"].includes("native/windows/build.ps1"), true);
});

test("iPhone profiles route threads and Remote Assist by selected computer", async () => {
  const [profile, client, content, remoteAssist] = await Promise.all([
    source("apps/ios/ClawDadMobile/Sources/ClawDadMobile/PairedComputer.swift"),
    source("apps/ios/ClawDadMobile/Sources/ClawDadMobile/CloudClient.swift"),
    source("apps/ios/ClawDadMobile/Sources/ClawDadMobile/ContentView.swift"),
    source("apps/ios/ClawDadMobile/Sources/ClawDadMobile/RemoteAssist.swift"),
  ]);

  assert.match(profile, /struct PairedComputerProfile/u);
  assert.match(profile, /var supportsRemoteAssist: Bool/u);
  assert.match(client, /func switchComputer\(to computerId: String\)/u);
  assert.match(client, /activeComputerSupportsRemoteAssist/u);
  assert.match(client, /pendingPairingEnvelopeId = UUID\(\)\.uuidString\.lowercased\(\)/u);
  assert.match(client, /acceptedPairingEnvelopeId == pendingPairingEnvelopeId/u);
  assert.match(client, /verifyHostEnvelope\([\s\S]*publicKeyPem: pendingPairingHostPublicKeyPem/u);
  assert.match(client, /acceptedHostKey\.isEmpty \|\| hostPublicKeysMatch/u);
  assert.match(content, /Text\(session\.paired \? session\.activeComputerName : "Add a computer"\)/u);
  assert.match(remoteAssist, /cloudSession\.activeComputerSupportsRemoteAssist/u);
  assert.match(remoteAssist, /isWindows \? "⌃T" : "⌘T"/u);
  assert.match(remoteAssist, /isWindows \? "alt⇥" : "⌘⇥"/u);
});

test("shared desktop web UI supports both WKWebView and WebView2 bridges", async () => {
  const web = await source("web/app.js");

  assert.match(web, /window\.webkit\?\.messageHandlers\?\.clawdadNative/u);
  assert.match(web, /window\.chrome\?\.webview/u);
  assert.match(web, /clawdad-native-response/u);
  assert.match(web, /Logs opened in File Explorer\./u);
  assert.match(web, /C:\\\\Users\\\\you\\\\Projects/u);
});

test("Windows opens Codex CLI threads in Windows Terminal", async () => {
  const server = await source("lib/server.mjs");

  assert.match(server, /async function launchWindowsTerminal/u);
  assert.match(server, /runExec\("wt\.exe", args/u);
  assert.match(server, /os\.platform\(\) === "win32"/u);
});
