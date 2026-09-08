# iPhone icon refresh — September 7, 2026

The iPhone system icon catalog still contained the old close-up crawfish face.
The approved baby-in-a-claw mascot was already in the app's header artwork.
Build 56 now uses that same mascot for every existing iPhone icon size and its
1024-pixel App Store/TestFlight icon.

**Released:** build 56 is `VALID` and `IN_BETA_TESTING` in ClawDad Internal.
Apple's processed marketing icon was downloaded through the build-icons API
and visually confirmed to show the updated baby-in-a-claw artwork. Install the
update from TestFlight to replace the iPhone's installed system icons.

**Physical follow-up:** the user confirmed the Home Screen shows the updated
icon, but fresh notifications still show the old one. The packaged artwork is
verified; notification-icon acceptance remains open pending the iPhone restart
and retest described below.

## Artwork and scope

Source: `apps/ios/ClawDadMobile/Resources/Assets.xcassets/ClawDadMascot.imageset/clawdad-mascot.png`.
The original remains unchanged. The conversion trims transparent padding,
retains the entire visible mascot and claw, fits it within the square, and
uses the app's dark red launch background. All resulting icons are opaque sRGB
PNGs with the exact dimensions specified by the asset catalog.

`swift bin/clawdad-app-icons.swift` regenerates the nine iPhone renditions and
four shared web/app icon assets from this source. The source note documents the
command and artwork. No new artwork or image service was used.

This release targets the private iPhone app and ClawDad Internal TestFlight.
The existing Mac 70 and notification relay repair remain active. Shared web
icon files are aligned in source for subsequent embedded-runtime releases.

## Verification and release

- Visually inspected the master icon and the compiled 120-pixel icon extracted
  from the signed archive; both show the baby held in the claw.
- Checked all nine asset-catalog PNG dimensions and absence of alpha.
- The signed iOS archive succeeded with bundle `earth.frg.clawdad.ios`, app
  version `0.7.0`, build `56`, and the `AppIcon` primary icon declaration.
- The compiled asset catalog contains the notification, Settings, Home Screen,
  and marketing icon renditions. Deep code-signature verification passed.
- All 541 runtime tests passed after updating the release fixtures; no behavior
  code changed in this icon release. `git diff --check` passed.
- Distribution upload succeeded at `2026-09-08T01:09:40Z`. Apple's processing
  completed successfully. Build `14171bd9-2a7a-419e-9dd7-9e92cd27c313` was
  verified `VALID` and `IN_BETA_TESTING`, assigned to ClawDad Internal, with
  release notes matching source at `01:14:39Z`.
- The unmasked icon returned by Apple's build-icons API downloaded with HTTP
  200 and visually matches the new artwork. Xcode's distribution pipeline
  preserved `aps-environment=production` and `get-task-allow=0`.
- The existing vendor WebRTC dSYM warning did not block archive or upload.
  External testing remains `READY_FOR_BETA_SUBMISSION`; no external beta or
  App Store review was submitted.

Artifacts and logs: `apps/ios/ClawDadMobile/build/`, using build-56-specific
archive/export paths and `icon-56-*` evidence names. The initial full runtime
check found four release-fixture references to build 55; those fixtures were
updated alongside the release catalog to build 56.

## Related notification acceptance

The user confirmed physical iPhone receipt after the relay repair. All four
previously queued events, including the original test, received APNs HTTP 200;
the queue was empty at the final check. See
`reports/response-notifications-2026-09-07.md` for the repair and delivery proof.

## Notification icon follow-up — September 8 UTC

After confirming successful push receipt, the user reported that the Home
Screen has the new icon while the notification header retains the old icon.
App Store Connect still reports build 56 `VALID` and `IN_BETA_TESTING`.

A fresh `actool` compilation in an isolated artifact directory was compared
against build 56's archived `Assets.car`. All ten compiled icon renditions
match by digest, including the 40-pixel and 60-pixel notification renditions.
The app uses the generated primary `AppIcon` declaration; there are no alternate
icon overrides or custom notification-header icons in the application code.
This rules out stale notification-sized assets in the shipped archive.

The remaining behavior matches an [Apple-acknowledged notification icon cache
issue](https://developer.apple.com/forums/thread/775787). Apple's engineer
recommends a device restart and an Apple bug report if the mismatch persists.
There is no verified application-side cache refresh workaround in that thread;
later reports still describe the issue. Renaming the icon catalog or uploading
another build has not been established as a remedy, so neither was presented
as a complete fix. No notification history, pairing, or credentials were reset.

The user was asked to restart the iPhone once, reopen ClawDad, and retest a fresh
notification. That physical result is pending. If it persists, collect the
iOS version and Home Screen appearance mode and prepare the minimal Apple
reproduction described in the linked thread; any support submission or device
diagnostic upload is a separate action.

Evidence: `apps/ios/ClawDadMobile/build/icon-notification-audit/` contains the
fresh asset compilation, generated icon plist, and
`shipped-icon-comparison.json`. No new native build was cut for this audit.

## Worktree handoff

The nine pre-existing dirty groups listed in the notification report remain
preserved for their existing review and artifact-retention actions. This patch
contains only the icon files/converter, iPhone build number, release metadata and
fixtures, and the two release reports. Physical Home Screen and notification
icon appearance can be confirmed after installing build 56.
