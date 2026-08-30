# ClawDad Founding Paid Beta Runbook

## Release Order

1. Run the automated verification in `docs/release-packet.md`.
2. Archive and upload iPhone build 32.
3. Wait for Apple to report the build `VALID`, then assign it to
   `ClawDad Internal`.
4. Build, sign, notarize, staple, and checksum the Mac release.
5. Keep this release on the private native lane: retain the signed Mac artifacts
   locally and leave npm, public GitHub assets, and the public appcast unchanged.
6. Install Mac build 29 on the paired host and verify the bundled runtime, native
   cloud connector, and cloud health.
7. Remove any development-signed ClawDad build from the iPhone, install
   TestFlight from the App Store when needed, then install build 32 from
   `ClawDad Internal`.
8. Run `npm run certify:snapshot` and confirm `deviceBuildReady` is `true`
   before testing app behavior.
9. Generate a fresh pairing QR from Mac Settings and pair the phone.
10. Verify the device appears in Mac Settings and revocation blocks it.
11. Re-pair and finish the physical matrix in
    `docs/reliability-certification.md`.
12. Run `npm run certify:snapshot` again and retain the two mode-`0600`
    artifacts as the release evidence boundary.

The private native beta 10 release stops here. Build 32 remains assigned only to
`ClawDad Internal`; the external group, public TestFlight link, Beta App Review,
App Store submission, npm package, public GitHub assets, and public appcast stay
unchanged.

## Deferred External Customer Release

These steps require separate release authorization after the physical matrix
passes:

1. Add the monitored Beta App Review phone number without persisting it in the
   repo, then finish the review detail:

    ```sh
    APP_STORE_CONNECT_REVIEW_PHONE="+1 ..." \
      node bin/clawdad-app-store release-configure --apply --json
    ```

2. Confirm `externalTesting.metadataReady` is `true`, then assign the certified
   build to `ClawDad Founding Customers` and start Beta App Review:

    ```sh
    node bin/clawdad-app-store external-beta-submit \
      --apply \
      --confirm-physical-certification \
      --json
    ```

3. Wait for `externalTesting.reviewState` to become `APPROVED`, then invite
   named founding customers. The external group has no public link.
4. Enable production relay enforcement only after the new credential path
   passes.

## Deferred Customer Onboarding

1. Invite the customer by email to the private `ClawDad Founding Customers`
   TestFlight group and send the notarized DMG.
2. Confirm their Mac meets the current macOS requirement and their iPhone runs
   iOS 18 or later.
3. Confirm Codex is installed and signed in on the Mac. OpenAI access is a
   separate purchase.
4. Install ClawDad on the Mac, choose project folders, and grant requested
   permissions.
5. Install ClawDad from TestFlight, choose Monthly or Annual, and complete or
   restore the purchase.
6. Pair with a fresh QR. Never send a QR, relay token, or diagnostic bundle in
   a public channel.
7. Send one Direct message and one Queue message before enabling Remote Assist.
8. Enable Remote Assist only when needed and grant Screen Recording and
   Accessibility on the Mac.

## Support Intake

Collect:

- Mac and iPhone ClawDad version/build
- local service health and cloud host state
- project and thread names, without prompt contents unless the customer opts in
- approximate incident time and network type
- whether the Mac was awake, locked, or asleep
- the visible error text

Use **Copy Diagnostics** in Mac Settings. Redact paths, tokens, customer
messages, Apple transaction data, and credentials before attaching diagnostics.

## Rollback

Keep a defective notarized Mac artifact and its checksum as release evidence,
restore the previous signed and notarized app on the paired Mac, and issue a
higher build number. The public appcast is unchanged in this private lane and
requires no rollback. Revoke an affected iPhone from Mac Settings. A TestFlight
build cannot be replaced in place; upload a higher build and remove the older
build from testing.
