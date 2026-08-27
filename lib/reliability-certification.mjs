export const CLAWDAD_IOS_BUNDLE_ID = "earth.frg.clawdad.ios";

export const physicalCertificationChecks = Object.freeze([
  "freshTestFlightInstall",
  "purchaseMonthly",
  "restorePurchase",
  "cancelRenewal",
  "freshQrPairing",
  "revokeAndRepair",
  "createProjectDirectory",
  "readSentMessageAloud",
  "readCodexResponseAloud",
  "macOnlyReadAloud",
  "umbraReadAloudFallback",
  "directDuringActiveWork",
  "queueDuringActiveWork",
  "longTurn",
  "appRelaunch",
  "macLockAndUnlock",
  "macSleepAndWake",
  "voice",
  "image",
  "remoteAssist",
  "multiDisplayRemoteAssist",
  "wifiToCellular",
  "restrictiveNetwork",
]);

export const physicalCertificationStates = Object.freeze([
  "pending",
  "pass",
  "fail",
  "blocked",
]);

export function normalizePhysicalCertification(checks = {}) {
  return Object.fromEntries(
    physicalCertificationChecks.map((check) => {
      const candidate = checks?.[check] || {};
      const state = physicalCertificationStates.includes(candidate.state)
        ? candidate.state
        : "pending";
      return [
        check,
        {
          state,
          evidence: String(candidate.evidence || ""),
          recordedAt: String(candidate.recordedAt || ""),
        },
      ];
    }),
  );
}

export function updatePhysicalCertification(
  checks,
  {
    check,
    state,
    evidence = "",
    recordedAt = new Date().toISOString(),
  },
) {
  if (!physicalCertificationChecks.includes(check)) {
    throw new Error(`Unknown physical certification check: ${check}`);
  }
  if (!physicalCertificationStates.includes(state)) {
    throw new Error(`Unknown physical certification state: ${state}`);
  }
  const normalizedEvidence = String(evidence || "").trim();
  if (state !== "pending" && !normalizedEvidence) {
    throw new Error(`Evidence is required when recording ${state}.`);
  }
  if (normalizedEvidence.length > 2_000) {
    throw new Error("Physical certification evidence is limited to 2000 characters.");
  }
  const normalized = normalizePhysicalCertification(checks);
  normalized[check] = {
    state,
    evidence: normalizedEvidence,
    recordedAt: state === "pending" ? "" : String(recordedAt || ""),
  };
  return normalized;
}

export function summarizePhysicalCertification(checks = {}) {
  const normalized = normalizePhysicalCertification(checks);
  const passed = physicalCertificationChecks.filter(
    (check) => normalized[check].state === "pass",
  );
  const foundingBetaChecks = physicalCertificationChecks.filter(
    (check) => check !== "restrictiveNetwork",
  );
  return {
    passed: passed.length,
    total: physicalCertificationChecks.length,
    foundingBetaPassed: foundingBetaChecks.filter(
      (check) => normalized[check].state === "pass",
    ).length,
    foundingBetaTotal: foundingBetaChecks.length,
    foundingBetaPhysicalReady: foundingBetaChecks.every(
      (check) => normalized[check].state === "pass",
    ),
    physicalCertificationComplete: physicalCertificationChecks.every(
      (check) => normalized[check].state === "pass",
    ),
  };
}

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
    builtByDeveloper: typeof app.builtByDeveloper === "boolean"
      ? app.builtByDeveloper
      : null,
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

export function installedMacBuildMatchesRelease(installedApp = {}, release = {}) {
  return (
    installedApp?.installed === true &&
    installedApp?.version === String(release?.expectedMacVersion || "") &&
    installedApp?.build === String(release?.expectedMacBuild || "")
  );
}

export function installedIosBuildMatchesRelease(installedApp = {}, release = {}) {
  return (
    installedApp?.version === String(release?.expectedIosVersion || "") &&
    installedApp?.build === String(release?.expectedIosBuild || "")
  );
}

export function summarizeCertificationSnapshot(snapshot = {}) {
  const target = snapshot?.iphone?.targetDevice;
  const installed = target?.installedApp;
  const installedMac = snapshot?.mac?.installedApp;
  const expectedVersion = String(snapshot?.release?.expectedVersion || "");
  const expectedRuntimeVersion = String(
    snapshot?.release?.expectedRuntimeVersion || expectedVersion,
  );
  const expectedBuild = String(snapshot?.release?.expectedIosBuild || "");
  const registryReady = snapshot?.release?.npm?.betaTag === expectedVersion;
  const runtimeReady =
    String(snapshot?.mac?.installedRuntimeVersion || "") ===
    expectedRuntimeVersion;
  const releaseSourceReady =
    snapshot?.release?.distributionMode === "native-private"
      ? runtimeReady
      : registryReady;
  const localReady = snapshot?.mac?.localHealth?.ok === true;
  const macBuildReady = installedMacBuildMatchesRelease(
    installedMac,
    snapshot?.release,
  );
  const cloudReady = snapshot?.cloud?.health?.ok === true;
  const testFlightReady =
    snapshot?.appStore?.release?.beta?.processingState === "VALID" &&
    String(snapshot?.appStore?.release?.beta?.buildNumber || "") === expectedBuild;
  const deviceBuildReady = installedIosBuildMatchesRelease(
    installed,
    snapshot?.release,
  );
  const physical = summarizePhysicalCertification(
    snapshot?.physicalCertification,
  );

  return {
    registryReady,
    runtimeReady,
    releaseSourceReady,
    localReady,
    macBuildReady,
    cloudReady,
    testFlightReady,
    deviceConnected: Boolean(target),
    deviceBuildReady,
    ...physical,
    readyForPhysicalCertification:
      releaseSourceReady &&
      localReady &&
      macBuildReady &&
      cloudReady &&
      testFlightReady &&
      Boolean(target) &&
      deviceBuildReady,
  };
}
