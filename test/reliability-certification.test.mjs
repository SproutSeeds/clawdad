import assert from "node:assert/strict";
import test from "node:test";
import {
  findInstalledApp,
  sanitizeConnectedDevice,
  summarizeCertificationSnapshot,
} from "../lib/reliability-certification.mjs";

test("connected device snapshots omit hardware secrets and retain readiness facts", () => {
  const snapshot = sanitizeConnectedDevice({
    identifier: "device-id",
    connectionProperties: {
      pairingState: "paired",
      tunnelState: "connected",
      transportType: "localNetwork",
    },
    deviceProperties: {
      name: "CodyVerse",
      osVersionNumber: "26.5.2",
      developerModeStatus: "enabled",
    },
    hardwareProperties: {
      marketingName: "iPhone 15 Pro Max",
      productType: "iPhone16,2",
      platform: "iOS",
      reality: "physical",
      serialNumber: "must-not-leak",
      udid: "must-not-leak",
    },
  });

  assert.deepEqual(snapshot, {
    model: "iPhone 15 Pro Max",
    productType: "iPhone16,2",
    platform: "iOS",
    reality: "physical",
    osVersion: "26.5.2",
    pairingState: "paired",
    tunnelState: "connected",
    transportType: "localNetwork",
    developerMode: "enabled",
  });
  assert.equal("serialNumber" in snapshot, false);
  assert.equal("udid" in snapshot, false);
  assert.equal("identifier" in snapshot, false);
  assert.equal("name" in snapshot, false);
});

test("installed app lookup retains only public app version fields", () => {
  const app = findInstalledApp([
    {
      name: "ClawDad",
      bundleIdentifier: "earth.frg.clawdad.ios",
      version: "0.7.0",
      bundleVersion: "19",
      url: "file:///private/secret/path",
    },
  ]);

  assert.deepEqual(app, {
    name: "ClawDad",
    bundleIdentifier: "earth.frg.clawdad.ios",
    version: "0.7.0",
    build: "19",
  });
  assert.equal(JSON.stringify(app).includes("private/secret"), false);
});

test("certification readiness requires the published release and physical build", () => {
  const snapshot = {
    release: {
      expectedVersion: "0.7.0-beta.2",
      expectedIosVersion: "0.7.0",
      expectedIosBuild: "19",
      npm: { betaTag: "0.7.0-beta.2" },
    },
    mac: {
      localHealth: { ok: true },
    },
    cloud: {
      health: { ok: true },
    },
    appStore: {
      release: {
        beta: {
          processingState: "VALID",
        },
      },
    },
    iphone: {
      targetDevice: {
        installedApp: {
          version: "0.7.0",
          build: "19",
        },
      },
    },
  };

  assert.deepEqual(summarizeCertificationSnapshot(snapshot), {
    registryReady: true,
    localReady: true,
    cloudReady: true,
    testFlightReady: true,
    deviceConnected: true,
    deviceBuildReady: true,
    readyForPhysicalCertification: true,
  });

  snapshot.iphone.targetDevice.installedApp.build = "15";
  assert.equal(
    summarizeCertificationSnapshot(snapshot).readyForPhysicalCertification,
    false,
  );
});
