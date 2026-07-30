# App Store Review Handoff

## Listing

- Storefront name: `ClawDad Mobile`
- In-app brand: `ClawDad`
- Bundle ID: `earth.frg.clawdad.ios`
- Public version: `1.0`
- Paid-beta TestFlight build: `0.7.0 (19)`
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

## Human Submission Gates

- Add the account holder’s name, direct phone, and monitored email.
- Confirm the Paid Applications Agreement, tax, and banking state.
- Complete the app privacy questionnaire from the evidence worksheet.
- Attach final App Store screenshots after representative physical-device
  review.
- Attach both first subscriptions to App Store version 1.0 in the same review
  submission.
- Provide Apple a durable, least-privilege reviewer Mac and pairing path. A
  normal one-time QR expires and should not be pasted into review notes.
- Upload a public 1.0 build after paid-beta certification. Do not attach the
  `0.7.0` beta build to the public version.
