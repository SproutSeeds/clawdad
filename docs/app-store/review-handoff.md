# App Store Review Handoff

## Listing

- Storefront name: `ClawDad Mobile`
- In-app brand: `ClawDad`
- Bundle ID: `earth.frg.clawdad.ios`
- Public version: `1.0`
- Paid-beta TestFlight build: `0.7.0 (30)`
- Support: `https://clawdad-cloud.frg.earth/support`
- Privacy: `https://clawdad-cloud.frg.earth/privacy`

## Reviewer Notes

ClawDad lets an iPhone continue Codex projects running on a paired Mac. The Mac
remains the execution authority. OpenAI Codex must be installed and signed in
separately on that Mac.

To review:

1. Install the supplied ClawDad Mac app on the review Mac.
2. Open Mac Settings in ClawDad, choose a project folder, and generate a fresh
   Pair iPhone QR.
3. On iPhone, purchase or restore either ClawDad Pro plan, scan the QR, choose a
   project and thread, and send a Direct message.
4. Send a Queue message during active work; it should begin after the active
   turn finishes.
5. Remote Assist is optional. Enable it in Mac Settings, grant Screen Recording
   and Accessibility, then tap the desktop icon on iPhone and approve Face ID.

Monthly and annual plans unlock the same app access. Annual billing is a
duration discount. Both plans include a 14-day introductory free trial. Codex
or ChatGPT access is purchased separately from OpenAI.

## Prepared Subscription State

The subscription group, monthly plan, and annual plan each have one
version-based App Review draft in `PREPARE_FOR_SUBMISSION`. Every draft captured
the intended `en-US` localization. Both products also have United States
availability, their intended price, the 14-day trial, review notes, and a
processed review screenshot.

App Store Connect still returns `MISSING_METADATA` on each legacy parent
subscription resource. That field is retained in diagnostics as
`legacyParentState`; the authoritative review state is the related
`subscriptionVersion`, per
[Apple's current version-based submission workflow](https://developer.apple.com/documentation/appstoreconnectapi/migrating-in-app-purchase-metadata-to-v2).
Run `node bin/clawdad-app-store status --json` to verify both layers.

After the remaining human gates are complete, assemble one App Review
submission containing App Store version 1.0, subscription-group version 1, and
version 1 of both subscriptions. Submitting that review is the release action;
the prepared drafts themselves do not publish or charge customers.

## External TestFlight Lane

`ClawDad Founding Customers` is a live external TestFlight group with feedback
enabled and its public link disabled. It currently has no build, testers, or
Beta App Review submission. Build 30 is assigned only to `ClawDad Internal`
while physical certification is pending.

App Store Connect requires a complete Beta App Review contact record whenever
that record is updated. Supply the monitored phone number at runtime with
`APP_STORE_CONNECT_REVIEW_PHONE`, then run
`node bin/clawdad-app-store release-configure --apply --json`. The number is
sent to Apple and is not written to the repository or the release-status
record.

After the physical matrix passes, run:

```sh
node bin/clawdad-app-store external-beta-submit \
  --apply \
  --confirm-physical-certification \
  --json
```

This command fails closed unless the private group, valid build, localized beta
metadata, complete review contact, and reviewer notes are ready. It assigns the
build to the external group, creates the separate Beta App Review submission,
and safely resumes if Apple accepted only the first action. It never enables a
public TestFlight link or invites testers.

## Prepared Screenshots

The current 6.9-inch iPhone screenshots are:

- `docs/app-store/screenshots/iphone-6.9/01-workspace.png`
- `docs/app-store/screenshots/iphone-6.9/02-conversation.png`

Both are opaque `1290x2796` captures from the real SwiftUI surfaces, matching
Apple's 6.9-inch screenshot requirements. They use a DEBUG-only, in-memory
fixture with synthetic `/Users/demo/...` projects and perform no pairing,
network requests, or writes to the user's saved workspace. The fixture is
unavailable in Release and TestFlight builds.

Regenerate and dimension-check the complete set with:

```sh
zsh ./bin/clawdad-app-store-screenshots
```

Preview the guarded App Store Connect upload with:

```sh
npm run appstore:release-screenshots -- --json
```

The exact reviewed files were uploaded on 2026-07-30 to the draft
`APP_IPHONE_67` set and both assets reached `COMPLETE`. The command is
checksum-idempotent and refuses to replace a populated 6.9-inch set unless
`--replace-existing-screenshots` is supplied.

The 2026-07-30 visual review found no clipped labels, overlapping controls,
debug chrome, credentials, customer data, or real project paths. The workspace
capture shows project/thread selection, Direct compose, voice, model effort, and
project-scoped recent threads. The conversation capture shows chronological,
formatted Codex history and per-message copy controls.

## Human Submission Gates

- Supply the direct, monitored Beta App Review phone number.
- Confirm the Paid Applications Agreement, tax, and banking state.
- Complete the app privacy questionnaire from the evidence worksheet.
- Attach both first subscriptions to App Store version 1.0 in the same review
  submission.
- Provide Apple a durable, least-privilege reviewer Mac and pairing path. A
  normal one-time QR expires and should not be pasted into review notes.
- Upload a public 1.0 build after paid-beta certification. Do not attach the
  `0.7.0` beta build to the public version.
