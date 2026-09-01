import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const nativeSource = fs.readFileSync(
  new URL("../native/macos/Sources/ClawDad/main.swift", import.meta.url),
  "utf8",
);
const managerSource = fs.readFileSync(
  new URL("../native/macos/Sources/ClawDad/MacRemoteComputerManager.swift", import.meta.url),
  "utf8",
);
const clientSource = fs.readFileSync(
  new URL("../native/macos/Sources/ClawDad/MacRemoteAssistClient.swift", import.meta.url),
  "utf8",
);
const viewerSource = fs.readFileSync(
  new URL("../native/macos/Sources/ClawDad/MacRemoteAssistWindowController.swift", import.meta.url),
  "utf8",
);

test("Mac app pairs remote computers with a separate signed controller identity", () => {
  assert.match(nativeSource, /"remoteComputers": true/u);
  assert.match(nativeSource, /case "pairRemoteComputer"/u);
  assert.match(nativeSource, /case "openRemoteComputer"/u);
  assert.match(managerSource, /MacControllerIdentity/u);
  assert.match(managerSource, /type: "pair\.request"/u);
  assert.match(managerSource, /verifyHostEnvelope\(envelope, profile: profile\)/u);
  assert.match(managerSource, /saveRelayAccessToken/u);
});

test("Mac Remote Assist viewer carries input clipboard commands and display selection", () => {
  assert.match(clientSource, /RemoteInputCodec\.encode/u);
  assert.match(clientSource, /RemoteClipboardCodec\.encode/u);
  assert.match(clientSource, /RemoteDisplayCodec\.encode/u);
  assert.match(clientSource, /remote\.assist\.answer/u);
  assert.match(viewerSource, /RTCMTLNSVideoView/u);
  assert.match(viewerSource, /Command-Tab/u);
  assert.match(viewerSource, /Command-T/u);
  assert.match(viewerSource, /window\?\.performClose/u);
});

test("desktop settings explain explicit two-way Mac pairing", () => {
  assert.match(indexSource, /id="settingsRemoteComputersSection"/u);
  assert.match(indexSource, /Repeat in the opposite direction/u);
  assert.match(indexSource, /id="settingsCopyPairingCodeButton"/u);
  assert.match(appSource, /JSON\.stringify\(payload\.pairing\)/u);
  assert.match(appSource, /nativeBridge\.pairRemoteComputer\(code\)/u);
  assert.match(appSource, /nativeBridge\.openRemoteComputer\(computerId\)/u);
});
