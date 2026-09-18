# Native app-server integration acceptance

Mac 0.7.0 build 167 is installed, signed and notarized. Assistant, manual Codex requests, research reviews, project summaries, delegate plans and run summaries use the selected ChatGPT-authenticated app server in the native Mac runtime. Account verification precedes model dispatch, inherited API-key routing is removed, and failed or uncertain delivery is retained without automatic replay.

Settings → Agent access now persists file/command scope, automatic review or Ask me, native tools and computer/Terminal control. Initial defaults are full computer access, automatic review and both tool switches enabled. Accepted turns keep their captured settings; subsequent requests use the latest saved revision. Original user authorization remains separate from generated dispatch attachments and model instructions. Operating-system permissions and connected-tool sign-ins still apply.

The native tool bridge is available to Assistant and manual conversations. Each call is bound to its current accepted user request, thread and turn. Existing Terminal launches remain independently owned. Summary and structured review helpers keep their read-only roles and participate in account admission/work tracking. Existing model selections, conversation identity and history remain intact.

## Verified

| Check | Result |
| --- | --- |
| Full JavaScript suite | 1,033 passed; zero failures/skips |
| Installed Assistant | Original conversation; actual file write/read and native display enumeration completed |
| Installed manual request | Fresh conversation; actual file write/read, display enumeration and native screenshot completed |
| Native tool configuration | All 71 tools loaded in an actual no-model fixture; missing configuration blocks model dispatch |
| Continued native conversation | Two actual subscription turns reused the same thread and tool context; display/capture receipts completed |
| Structured research review | Actual subscription-backed synthetic evidence review returned a validated structured decision |
| Authentication | Live account/read and rate-limit verification matched selected ChatGPT account and authorization home |
| Settings | Broad policy saved through desktop UI; revision 1 persisted across upgrade; controls loaded; Escape returned to main UI |
| Native OS permissions | Screen Recording and Control Access shown as allowed |
| Original data | All 1,245 baseline Assistant messages and 2,312 jobs retained with matching hashes; original session/conversation/destination preserved |
| Account and Terminal | Selected account and epoch unchanged; all six monitored original Terminal process identities preserved |
| Runtime | Health HTTP 200; all 107 bundled lib/web files matched source and installed runtime copy |
| Mac distribution | App and DMG accepted as Notarized Developer ID; bundle/runtime fingerprint matched |
| iPhone distribution | Build 104 VALID and IN_BETA_TESTING in ClawDad Internal; release notes read back correctly |
| Repository | Scoped release files; unrelated work preserved and classified; no destructive Git cleanup |

Final checks caught and repaired missing Settings module routes, invalid nested forms, account-profile transcript lookup, first-message dispatch before Codex writes its first transcript, and stale native MCP configuration on resumed manual threads. The module graph is now exercised through HTTP. Idle ClawDad clients release only their own subscription before applying updated configuration; actual tool availability is checked before turn/start. The version-specific resume behavior was verified against [OpenAI Codex rust-v0.154.0 source](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/thread_processor.rs) and an actual shared-server fixture.

## Remaining acceptance boundaries

On September 18, 2026, the owner explicitly approved completing the Mac release with Windows verification and the physical iPhone check deferred. Both checks remain pending and do not block this Mac release.

- Physical iPhone UI/reconnect acceptance for build 104 remains pending. Mirroring last reported iPhone Not Found. Simulator/build/distribution checks do not replace a physical check.
- Windows Umbra was unreachable over SSH. Windows native control and Linux support are not certified by this Mac release.
- Live native checks exercised display inspection/capture. Destructive computer input and Terminal mutations were covered with targeted receipt/ownership tests, not performed against the user's active work.
- Restart/uncertain-delivery recovery preserves receipts and marks work for attention. This release does not claim automatic resumption of every interrupted turn.
- Existing native app installation and internal TestFlight are the release destinations. No public npm, public update feed, external TestFlight or App Store release was performed.

Mac Wi-Fi was returned to its original Off state after the unavailable Mirroring check. Signed artifacts and verified rollback copies remain in the ignored native release directory. Private prompts, account identifiers, native credentials and screenshots remain in local application storage; acceptance.json contains only summarized results.
