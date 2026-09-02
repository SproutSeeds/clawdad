# ClawDad 0.7 Native Beta 14 Release Packet

Prepared: 2026-09-02

## Release Identity

- Embedded runtime: `0.7.0-beta.14`
- Mac app: `0.7.0 (36)`
- iPhone app: `0.7.0 (33)`
- Managed Node runtime: `24.20.0`
- Source checkpoint: `f18e491dd98d6d4c639f874f9b1817f4beda13b4`
- Website source checkpoint: `2c0ed1afdcd3b2b67f58f7674688db9dfb451929`
- Distribution mode: public signed Mac downloads plus private internal iPhone
  TestFlight

The Mac download page is `https://clawdad.earth/`. Its architecture buttons
resolve to the signed assets on the public `v0.7.0-beta.14` GitHub prerelease.
The iPhone companion remains assigned only to `ClawDad Internal`. The public
npm package, primary Apple-silicon cloud Sparkle appcast, external TestFlight
group, Beta App Review, and App Store submission remain unchanged. Intel Macs
receive the signed build 36 update manifest from
`https://clawdad.earth/downloads/appcast-intel.xml`.

## Included Scope

- The setup assistant reports the installed Codex version, ChatGPT sign-in
  state, and latest official Codex release as separate readiness facts.
- A newer official Codex release produces a clear **Update available** action.
  Updating remains an explicit customer choice and uses OpenAI's standalone
  installer while preserving the shared `~/.codex` account and thread history.
- Successful release checks are cached briefly, and **Check again** performs a
  fresh verification after installation or a transient failure.
- When the release service is temporarily unavailable, an installed and
  authenticated Codex remains usable while ClawDad marks currentness unknown.
- Controller-only Macs skip the Codex release request because local Codex is
  optional for that role.
- Node 24.20.0 and ORP remain embedded inside the signed app. Customers do not
  need a system Node installation to start ClawDad.
- ClawDad and Terminal share `~/.codex`, so a thread created or continued from
  the phone remains available through the Codex CLI on that computer.
- The native control plane opens before Codex finishes starting. Setup,
  diagnostics, and recovery remain available when Codex is missing, logged out,
  slow, or temporarily unhealthy.
- The iPhone computer selector retains separate project, thread, model,
  reasoning, directory-creation, and Remote Assist state for every paired host.
- Each Mac keeps separate signed host and controller identities in Keychain.
  Mac-to-Mac pairing remains directional and can be configured both ways.
- Native Remote Assist carries forward display selection, Terminal tab
  selection, pointer and keyboard input, clipboard exchange, Read Aloud, local
  speech-to-text, and bounded special commands.

## Release Artifacts

| Artifact | Local path | SHA-256 |
| --- | --- | --- |
| Apple-silicon DMG | `native/macos/dist/releases/0.7.0-beta.14-macos-36/ClawDad-0.7.0-beta.14-mac.dmg` | `58246d568be0cf45205d338bdd43ee7daeea1750f839df5cba03b70c9b222f18` |
| Apple-silicon ZIP | `native/macos/dist/releases/0.7.0-beta.14-macos-36/appcast/ClawDad-0.7.0-beta.14-mac.zip` | `15ea55817eac705ad6fc66709ab2a82e9eee9552cf2c48d0d02244b866610dd4` |
| Intel DMG | `native/macos/dist/releases/0.7.0-beta.14-macos-36-intel/ClawDad-0.7.0-beta.14-mac-intel.dmg` | `5393a065942b6eec1bb18a1cdc1ff2a8738cc9b013558cf08840c24183b372c4` |
| Intel ZIP | `native/macos/dist/releases/0.7.0-beta.14-macos-36-intel/appcast/ClawDad-0.7.0-beta.14-mac-intel.zip` | `161bbdfc86574dfd8bb087323478c2850a7029af65d50faa8e163bb8d7ad5607` |
| Intel signed appcast | `native/macos/dist/releases/0.7.0-beta.14-macos-36-intel/appcast/appcast.xml` | `01c675070b7dd3d9938fe36dc3cfc2c29e518102e513adc13966a0af1552b793` |

Public assets:

- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.14/ClawDad-0.7.0-beta.14-mac.dmg`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.14/ClawDad-0.7.0-beta.14-mac.zip`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.14/ClawDad-0.7.0-beta.14-mac-intel.dmg`
- `https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.14/ClawDad-0.7.0-beta.14-mac-intel.zip`

The Apple-silicon DMG is `64,336,270` bytes and the Intel DMG is
`67,579,125` bytes. Clawdad.earth links to GitHub release storage instead of
embedding these binaries in the website deployment.

## Verification Completed

- Node application/runtime suite: 463 tests passed from the clean release
  checkout.
- iPhone Swift compatibility suite: 46 tests passed.
- Shared Remote Assist protocol suite: 28 tests passed.
- Mac Swift suite: 66 tests passed.
- Marketing site lint completed with zero errors and 14 existing image
  optimization warnings; the production build completed for Home, About,
  Privacy, Release Notes, and Support.
- Sites production version 15 was saved from website commit `2c0ed1a`, deployed
  successfully, and routed through the existing `clawdad.earth` custom domain.
- Both architecture-specific apps and DMGs are Developer ID signed, notarized,
  stapled, and accepted by Gatekeeper.
- Mounted-DMG and ZIP inspection reports `arm64` throughout the Apple-silicon
  app, Node, WebRTC, and Sparkle binaries and `x86_64` throughout the Intel
  package. Both report app build 36 and runtime `0.7.0-beta.14`.
- Both packaged executables contain the official Codex release-channel URL,
  and their runtime package manifests report beta 14.
- GitHub reports SHA-256 asset digests that exactly match the local release
  artifacts.
- Live outside-in checks found beta 14/build 36 on the home and release-notes
  pages, valid 200 responses for both DMGs with the expected byte lengths, and
  a signed Intel appcast naming build 36 and the matching Intel ZIP.
- The exact public Apple-silicon package is installed at
  `/Applications/ClawDad.app`; the prior build is preserved at
  `/Applications/ClawDad-beta13-build35-backup.app`.
- The installed Studio app passed deep signature and Gatekeeper checks, started
  exactly one local server and one relay worker as direct children, listened on
  port 4487, reported runtime beta 14 with the shared Codex app-server ready,
  and established an outbound relay connection.
- The privacy-safe certification snapshot reports the beta 14 runtime, release
  source, local Mac build 36, cloud service, and internal TestFlight build as
  ready. The connected iPhone is still on build 32, so device-build readiness
  and physical certification correctly remain pending until build 33 is
  installed from TestFlight.
- Apple accepted notarization submissions
  `726f5d96-cf23-4b68-85f5-f5e07e308b89` and
  `1be4be18-cbf9-4619-b334-5cb144edbc0c` for the Apple-silicon ZIP and DMG,
  and `7ac6d2bf-7aee-43a4-badf-496c33d3d2d6` and
  `7a7f84f3-92a6-4cc9-98cb-5750bbd313e6` for the Intel ZIP and DMG.

## Physical Device Gates

- Download and install the Intel build 36 from clawdad.earth on the Mac laptop.
- On that older-Codex host, confirm **Update available**, approve the update,
  choose **Check again**, and confirm **Up to date**.
- Temporarily disconnect the laptop from the network and confirm the installed,
  authenticated Codex stays usable while currentness is marked unavailable.
- Confirm controller-only setup completes without installing or checking Codex.
- Pair laptop to Studio and Studio to laptop with separate fresh codes. Confirm
  native Remote Assist, display selection, Terminal tabs, pointer alignment,
  typing, clipboard, Command-Tab, and Command-T in both directions.
- Update the connected iPhone from build 32 to TestFlight build 33, pair both
  Macs, and confirm each host restores its own project and thread before Direct,
  Queue, directory creation, Read Aloud, and Remote Assist actions.
- Repeat connection recovery from Wi-Fi to cellular and on a restrictive
  network.

## Preserved Outside This Release

- The public npm package and its authentication flow
- The private iPhone build and all external iPhone distribution channels
- The primary Apple-silicon cloud Sparkle appcast
- Unrelated working-tree changes and `assets/wordmark-explorations/`
- Credentials, pairing tickets, relay tokens, logs, project contents, and
  customer data
