# ClawDad 0.7 Native Beta 13 Release Packet

Prepared: 2026-09-01

## Release Identity

- Embedded runtime: `0.7.0-beta.13`
- Mac app: `0.7.0 (35)`
- iPhone app: `0.7.0 (33)`
- Managed Node runtime: `24.20.0`
- Distribution mode: public signed Mac downloads plus private internal iPhone
  TestFlight

The Mac download page is `https://clawdad.earth/`. Its architecture buttons
resolve to the signed assets on the public `v0.7.0-beta.13` GitHub release. The
iPhone companion is assigned only to `ClawDad Internal`. The public npm package,
primary cloud Sparkle appcast, external TestFlight group, Beta App Review, and
App Store submission remain unchanged. Intel updates use the small signed
manifest at `https://clawdad.earth/downloads/appcast-intel.xml`; the manifest
downloads its signed ZIP from the same GitHub release.

## Included Scope

- A four-step Mac setup assistant chooses controller, host, or combined mode;
  verifies the managed runtime; installs the official standalone Codex CLI only
  after explicit consent; guides ChatGPT sign-in; selects the default project
  home; and finishes pairing and Remote Assist guidance.
- Node 24.20.0 and ORP are embedded inside the signed app. Customers do not need
  a system Node installation to start ClawDad.
- ClawDad and Terminal share `~/.codex`, so a thread created or continued from
  the phone remains available through the Codex CLI on that computer.
- The native control plane opens before Codex finishes starting. Setup,
  diagnostics, and recovery remain available when Codex is missing, logged out,
  slow, or temporarily unhealthy.
- The setup assistant obtains the customer's workspace selection before loading
  the project catalog. Managed Node processes stay direct children of the
  signed ClawDad app so macOS attributes removable-volume access to ClawDad.
- Native startup defers saved queue and delegate scans until setup is complete,
  preventing an external workspace from blocking the first window.
- The iPhone computer selector owns a separate project, thread, model,
  reasoning setting, directory-creation destination, and Remote Assist target
  for every paired host.
- Each Mac keeps separate signed host and controller identities in Keychain.
  Mac-to-Mac pairing remains directional and can be configured both ways.
- Native Remote Assist includes display selection, Terminal tab selection,
  pointer and keyboard input, clipboard exchange, and bounded special commands.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Apple-silicon DMG | `native/macos/dist/releases/0.7.0-beta.13-macos-35/ClawDad-0.7.0-beta.13-mac.dmg` | `4f8499336cddea08e4fbd643c4ba5ded172b8d536ab477e5f49c26298adcc48f` |
| Apple-silicon ZIP | `native/macos/dist/releases/0.7.0-beta.13-macos-35/appcast/ClawDad-0.7.0-beta.13-mac.zip` | `71cd9c518bf8da947e2d81821a8e07a28400240b80001676232cf7e18c463dcd` |
| Intel DMG | `native/macos/dist/releases/0.7.0-beta.13-macos-35-intel/ClawDad-0.7.0-beta.13-mac-intel.dmg` | `cd65cdfd606fe449274e6dad4b91eb94cf3feb7a2cbdda74256e76f68371a0f2` |
| Intel ZIP | `native/macos/dist/releases/0.7.0-beta.13-macos-35-intel/appcast/ClawDad-0.7.0-beta.13-mac-intel.zip` | `ddc4346adb0fca94cf3c2979eb0b042f8f91f73592d9ceb7c175e99d6811b1b3` |
| Intel signed appcast | `native/macos/dist/releases/0.7.0-beta.13-macos-35-intel/appcast/appcast.xml` | `14c2b5368415dd0bd78d93a27fbf5c1050c11d8d78cfa60c70ffe1917365d368` |

Public assets:

- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.13/ClawDad-0.7.0-beta.13-mac.dmg`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.13/ClawDad-0.7.0-beta.13-mac-intel.dmg`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.13/ClawDad-0.7.0-beta.13-mac-intel.zip`

The Apple-silicon DMG is `64,212,062` bytes and the Intel DMG is
`67,537,457` bytes. The managed runtime makes these larger than the previous
thin installers, so clawdad.earth links to release storage instead of embedding
the binaries in the website deployment.

## Verification Completed

- Node application/runtime suite: 462 tests passed from the clean release
  checkpoint; ten repeated app-server process-exit regressions also passed.
- iPhone Swift suite: 46 tests passed.
- Shared Remote Assist protocol suite: 28 tests passed.
- Mac Swift suite: 63 tests passed.
- Marketing site lint completed with zero errors and 14 existing image
  optimization warnings; its production build completed with the home, About,
  Privacy, Release Notes, and Support routes.
- Both architecture-specific apps and DMGs are Developer ID signed, notarized,
  stapled, and accepted by Gatekeeper.
- Mounted-DMG inspection reports `arm64` for the Apple-silicon app and Node and
  `x86_64` for the Intel app and Node. Both report app build 35 and embedded
  runtime `0.7.0-beta.13`.
- The signed app carries Automation and microphone entitlements plus explicit
  removable-volume and protected-folder usage descriptions. The managed Node
  carries the architecture-appropriate V8 entitlements.
- The embedded Node executable runs after final hardened signing. The arm64
  build carries the required JIT entitlement; the Intel build also carries the
  unsigned-executable-memory entitlement required by V8 on Intel Macs.
- A stripped-environment smoke test starts the packaged server with the bundled
  Node and ORP runtime, without a system Node dependency.
- TestFlight build 33 is `VALID`, export-compliance metadata is complete, and
  the build is assigned only to `ClawDad Internal`.
- Apple accepted notarization submissions `e6ac46e7-c950-4c7f-929d-f26e9c3bd574`
  and `74899da5-b707-4f74-847b-6cc5b1d067e2` for the Apple-silicon ZIP and DMG,
  and `15c6c550-5ecd-4acc-be82-6087891cee5b` and
  `272ba8fc-478b-457f-b4e5-34bcd6789c95` for the Intel ZIP and DMG.

## Physical Device Gates

- Open the installed Studio build 35 and complete the new setup assistant as a
  combined controller and host.
- Download the matching build 35 architecture from clawdad.earth on the Mac
  laptop, install it, and complete setup.
- Pair laptop to Studio and Studio to laptop with separate fresh codes. Confirm
  native Remote Assist, display selection, Terminal tabs, pointer alignment,
  typing, clipboard, Command-Tab, and Command-T in both directions.
- Install TestFlight build 33 on the iPhone, pair both Macs, and confirm each
  host restores its own project and thread before Direct, Queue, directory
  creation, Read Aloud, and Remote Assist actions.
- Repeat connection recovery from Wi-Fi to cellular and on a restrictive
  network.

## Preserved Outside This Release

- The public npm package and its authentication flow
- The primary Apple-silicon cloud Sparkle appcast
- External TestFlight, Beta App Review, and App Store submission state
- Unrelated working-tree changes and `assets/wordmark-explorations/`
- Credentials, pairing tickets, relay tokens, logs, project contents, and
  customer data
