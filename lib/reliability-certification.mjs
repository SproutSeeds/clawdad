export const CLAWDAD_IOS_BUNDLE_ID = "earth.frg.clawdad.ios";

export const physicalCertificationChecks = Object.freeze([
  "freshTestFlightInstall",
  "purchaseMonthly",
  "restorePurchase",
  "cancelRenewal",
  "freshQrPairing",
  "revokeAndRepair",
  "directDuringActiveWork",
  "queueDuringActiveWork",
  "longTurn",
  "appRelaunch",
  "macLockAndUnlock",
  "macSleepAndWake",
  "voice",
  "image",
  "remoteAssist",
  "wifiToCellular",
  "restrictiveNetwork",
]);

export function sanitizeConnectedDevice(device = {}) {
  return {
    model: String(device.hardwareProperties?.marketingName || ""),
    productType: String(device.hardwareProperties?.productType || ""),
    platform: String(device.hardwareProperties?.platform || ""),
    reality: String(device.hardwareProperties?.reality || ""),
    osVersion: String(device.deviceProperties?.osVersionNumber || ""),
    pairingState: String(device.connectionProperties?.pairingState || ""),
    tunnelState: String(device.connectionProperties?.tunnelState || ""),
    transportType: String(device.connectionProperties?.transportType || ""),
    developerMode: String(device.deviceProperties?.developerModeStatus || ""),
  };
}

export function findInstalledApp(apps = [], bundleIdentifier = CLAWDAD_IOS_BUNDLE_ID) {
  const app = apps.find(
    (candidate) => candidate?.bundleIdentifier === bundleIdentifier,
  );
  if (!app) {
    return null;
  }
  return {
    name: String(app.name || ""),
    bundleIdentifier: String(app.bundleIdentifier || ""),
    version: String(app.version || ""),
    build: String(app.bundleVersion || ""),
  };
}

export function sanitizeServiceHealth(payload = {}) {
  return {
    ok: payload?.ok === true,
    service: String(payload?.service || ""),
    version: String(payload?.version || ""),
    protocolVersion: String(payload?.protocolVersion || ""),
    authMode: String(payload?.authMode || ""),
  };
}

export function summarizeCertificationSnapshot(snapshot = {}) {
  const target = snapshot?.iphone?.targetDevice;
  const installed = target?.installedApp;
  const expectedVersion = String(snapshot?.release?.expectedVersion || "");
  const expectedBuild = String(snapshot?.release?.expectedIosBuild || "");
  const registryReady = snapshot?.release?.npm?.betaTag === expectedVersion;
  const localReady = snapshot?.mac?.localHealth?.ok === true;
  const cloudReady = snapshot?.cloud?.health?.ok === true;
  const testFlightReady =
    snapshot?.appStore?.release?.beta?.processingState === "VALID";
  const deviceBuildReady =
    installed?.version === snapshot?.release?.expectedIosVersion &&
    installed?.build === expectedBuild;

  return {
    registryReady,
    localReady,
    cloudReady,
    testFlightReady,
    deviceConnected: Boolean(target),
    deviceBuildReady,
    readyForPhysicalCertification:
      registryReady &&
      localReady &&
      cloudReady &&
      testFlightReady &&
      Boolean(target) &&
      deviceBuildReady,
  };
}
