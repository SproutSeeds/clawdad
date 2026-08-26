import assert from "node:assert/strict";
import test from "node:test";
import {
  findInstalledApp,
  installedIosBuildMatchesRelease,
  installedMacBuildMatchesRelease,
  normalizePhysicalCertification,
  physicalCertificationChecks,
  sanitizeConnectedDevice,
  sanitizeServiceHealth,
  summarizeCertificationSnapshot,
  summarizePhysicalCertification,
  updatePhysicalCertification,
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
      bundleVersion: "24",
      builtByDeveloper: false,
      url: "file:///private/secret/path",
    },
  ]);

  assert.deepEqual(app, {
    name: "ClawDad",
    bundleIdentifier: "earth.frg.clawdad.ios",
    version: "0.7.0",
    build: "24",
    builtByDeveloper: false,
  });
  assert.equal(JSON.stringify(app).includes("private/secret"), false);
});

test("service health snapshots omit project paths and unexpected fields", () => {
  const health = sanitizeServiceHealth({
    ok: true,
    service: "clawdad",
    version: "0.7.0-beta.2",
    protocolVersion: "1",
    authMode: "hybrid",
    defaultProject: "/Volumes/Code_2TB/code/private-client",
    token: "must-not-leak",
  });

  assert.deepEqual(health, {
    ok: true,
    service: "clawdad",
    version: "0.7.0-beta.2",
    protocolVersion: "1",
    authMode: "hybrid",
  });
  assert.equal(JSON.stringify(health).includes("/Volumes/"), false);
  assert.equal(JSON.stringify(health).includes("must-not-leak"), false);
});

test("physical evidence requires the exact paired iPhone and Mac release", () => {
  const release = {
    expectedIosVersion: "0.7.0",
    expectedIosBuild: "30",
    expectedMacVersion: "0.7.0",
    expectedMacBuild: "25",
  };
  assert.equal(installedIosBuildMatchesRelease({
    version: "0.7.0",
    build: "30",
    builtByDeveloper: true,
  }, release), true);
  assert.equal(installedIosBuildMatchesRelease({
    version: "0.7.0",
    build: "22",
    builtByDeveloper: false,
  }, release), false);
  assert.equal(installedIosBuildMatchesRelease({
    version: "0.6.9",
    build: "28",
    builtByDeveloper: false,
  }, release), false);
  assert.equal(installedMacBuildMatchesRelease({
    installed: true,
    version: "0.7.0",
    build: "25",
  }, release), true);
  assert.equal(installedMacBuildMatchesRelease({
    installed: true,
    version: "0.7.0",
    build: "21",
  }, release), false);
});

test("certification readiness requires the exact published iPhone and Mac builds", () => {
  const snapshot = {
    release: {
      expectedVersion: "0.7.0-beta.8",
      expectedIosVersion: "0.7.0",
      expectedIosBuild: "30",
      expectedMacVersion: "0.7.0",
      expectedMacBuild: "25",
      npm: { betaTag: "0.7.0-beta.8" },
    },
    mac: {
      localHealth: { ok: true },
      installedApp: {
        installed: true,
        version: "0.7.0",
        build: "25",
      },
    },
    cloud: {
      health: { ok: true },
    },
    appStore: {
      release: {
        beta: {
          processingState: "VALID",
          buildNumber: "30",
        },
      },
    },
    iphone: {
      targetDevice: {
        installedApp: {
          version: "0.7.0",
          build: "30",
          builtByDeveloper: true,
        },
      },
    },
  };

  assert.deepEqual(summarizeCertificationSnapshot(snapshot), {
    registryReady: true,
    localReady: true,
    macBuildReady: true,
    cloudReady: true,
    testFlightReady: true,
    deviceConnected: true,
    deviceBuildReady: true,
    passed: 0,
    total: 22,
    foundingBetaPassed: 0,
    foundingBetaTotal: 21,
    foundingBetaPhysicalReady: false,
    physicalCertificationComplete: false,
    readyForPhysicalCertification: true,
  });

  snapshot.appStore.release.beta.buildNumber = "22";
  assert.equal(
    summarizeCertificationSnapshot(snapshot).readyForPhysicalCertification,
    false,
  );
  assert.equal(summarizeCertificationSnapshot(snapshot).testFlightReady, false);
  snapshot.appStore.release.beta.buildNumber = "30";

  snapshot.mac.installedApp.build = "21";
  assert.equal(
    summarizeCertificationSnapshot(snapshot).readyForPhysicalCertification,
    false,
  );
  assert.equal(summarizeCertificationSnapshot(snapshot).macBuildReady, false);
  snapshot.mac.installedApp.build = "25";

  snapshot.iphone.targetDevice.installedApp.build = "15";
  assert.equal(
    summarizeCertificationSnapshot(snapshot).readyForPhysicalCertification,
    false,
  );
});

test("physical certification records evidence and reports completion", () => {
  let checks = normalizePhysicalCertification();
  assert.equal(Object.keys(checks).length, physicalCertificationChecks.length);
  assert.equal(checks.freshTestFlightInstall.state, "pending");
  assert.equal(checks.createProjectDirectory.state, "pending");
  assert.equal(checks.readSentMessageAloud.state, "pending");
  assert.equal(checks.readCodexResponseAloud.state, "pending");
  assert.equal(checks.macOnlyReadAloud.state, "pending");
  assert.equal(checks.umbraReadAloudFallback.state, "pending");

  for (const check of physicalCertificationChecks) {
    checks = updatePhysicalCertification(checks, {
      check,
      state: "pass",
      evidence: `Verified ${check} on build 30.`,
      recordedAt: "2026-07-30T14:00:00.000Z",
    });
  }

  assert.deepEqual(summarizePhysicalCertification(checks), {
    passed: 22,
    total: 22,
    foundingBetaPassed: 21,
    foundingBetaTotal: 21,
    foundingBetaPhysicalReady: true,
    physicalCertificationComplete: true,
  });
  assert.throws(
    () => updatePhysicalCertification(checks, {
      check: "voice",
      state: "fail",
      evidence: "",
    }),
    /Evidence is required/u,
  );
  assert.throws(
    () => updatePhysicalCertification(checks, {
      check: "unknown",
      state: "pass",
      evidence: "Nope",
    }),
    /Unknown physical certification check/u,
  );
});
