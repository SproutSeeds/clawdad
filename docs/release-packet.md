# ClawDad 0.7 Native Beta 12 Release Packet

Prepared: 2026-09-01

## Release Identity

- Embedded runtime: `0.7.0-beta.12`
- Mac app: `0.7.0 (34)`
- iPhone app: `0.7.0 (33)`
- Managed Node runtime: `24.20.0`
- Distribution mode: public signed Mac downloads plus private internal iPhone
  TestFlight

The Mac download page is `https://clawdad.earth/`. Its architecture buttons
resolve to the signed assets on the public `v0.7.0-beta.12` GitHub release. The
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
| Apple-silicon DMG | `native/macos/dist/releases/0.7.0-beta.12-macos-34/ClawDad-0.7.0-beta.12-mac.dmg` | `e4ff8e6d7f96d626778a43ae478cbb7aade27c9f322ea471f5f5a8a169fc2ba0` |
| Apple-silicon ZIP | `native/macos/dist/releases/0.7.0-beta.12-macos-34/appcast/ClawDad-0.7.0-beta.12-mac.zip` | `a20a25c39501874aeae1d4fb5ca9cc0d82357f77f7db7333d16de573a153e0eb` |
| Intel DMG | `native/macos/dist/releases/0.7.0-beta.12-macos-34-intel/ClawDad-0.7.0-beta.12-mac-intel.dmg` | `7ad449116777ec6b6055827b390c3b0b8b1daf8a87ec835879a6c59ebefa9a08` |
| Intel ZIP | `native/macos/dist/releases/0.7.0-beta.12-macos-34-intel/appcast/ClawDad-0.7.0-beta.12-mac-intel.zip` | `a9645aa7a80bd793bde8fdf348064876e936bab74a967c3b0aada4cd34240cea` |
| Intel signed appcast | `native/macos/dist/releases/0.7.0-beta.12-macos-34-intel/appcast/appcast.xml` | `3bb8421f1f2c25a297691ec73720baf95380251e9411981541f36b81cc156fd1` |

Public assets:

- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.12/ClawDad-0.7.0-beta.12-mac.dmg`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.12/ClawDad-0.7.0-beta.12-mac-intel.dmg`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.12/ClawDad-0.7.0-beta.12-mac-intel.zip`

The Apple-silicon DMG is `64,216,527` bytes and the Intel DMG is
`67,581,876` bytes. The managed runtime makes these larger than the previous
thin installers, so clawdad.earth links to release storage instead of embedding
the binaries in the website deployment.

## Verification Completed

- Node application/runtime suite: 464 tests passed.
- iPhone Swift suite: 46 tests passed.
- Shared Remote Assist protocol suite: 28 tests passed.
- Mac Swift suite: 63 tests passed.
- Marketing site lint completed with zero errors and 14 existing image
  optimization warnings; its production build completed with the home, About,
  Privacy, Release Notes, and Support routes.
- Both architecture-specific apps and DMGs are Developer ID signed, notarized,
  stapled, and accepted by Gatekeeper.
- Mounted-DMG inspection reports `arm64` for the Apple-silicon app and Node and
  `x86_64` for the Intel app and Node. Both report app build 34.
- The embedded Node executable runs after final hardened signing. The arm64
  build carries the required JIT entitlement; the Intel build also carries the
  unsigned-executable-memory entitlement required by V8 on Intel Macs.
- A stripped-environment smoke test starts the packaged server with the bundled
  Node and ORP runtime, without a system Node dependency.
- TestFlight build 33 is `VALID`, export-compliance metadata is complete, and
  the build is assigned only to `ClawDad Internal`.

## Physical Device Gates

- Open the installed Studio build 34 and complete the new setup assistant as a
  combined controller and host.
- Download the matching build 34 architecture from clawdad.earth on the Mac
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
