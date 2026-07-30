# ClawDad Founding Paid Beta Runbook

## Release Order

1. Run the automated verification in `docs/release-packet.md`.
2. Archive and upload iPhone build 19.
3. Wait for Apple to report the build `VALID`, then assign it to
   `ClawDad Internal`.
4. Build, sign, notarize, staple, and checksum the Mac release.
5. Publish the npm beta, Git tag, GitHub prerelease, Mac ZIP, DMG, and appcast.
6. Install the published package and Mac app on the host and verify local and
   public health.
7. Install build 19 from TestFlight on the iPhone.
8. Run `npm run certify:snapshot` and confirm `deviceBuildReady` is `true`
   before testing app behavior.
9. Generate a fresh pairing QR from Mac Settings and pair the phone.
10. Verify the device appears in Mac Settings and revocation blocks it.
11. Re-pair and finish the physical matrix in
    `docs/reliability-certification.md`.
12. Run `npm run certify:snapshot` again and retain the two mode-`0600`
    artifacts as the release evidence boundary.
13. Add the monitored Beta App Review phone number without persisting it in
    the repo, then finish the review detail:

    ```sh
    APP_STORE_CONNECT_REVIEW_PHONE="+1 ..." \
      node bin/clawdad-app-store release-configure --apply --json
    ```

14. Confirm `externalTesting.metadataReady` is `true`, then assign the
    certified build to `ClawDad Founding Customers` and start Beta App Review:

    ```sh
    node bin/clawdad-app-store external-beta-submit \
      --apply \
      --confirm-physical-certification \
      --json
    ```

15. Wait for `externalTesting.reviewState` to become `APPROVED`, then invite
    named founding customers. The external group has no public link.
16. Enable production relay enforcement only after the new credential path
    passes.

## Customer Onboarding

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

Disable the public appcast entry for a defective Mac build, keep the notarized
artifact and checksum for support, and issue a higher build number. Revoke an
affected iPhone from Mac Settings. A TestFlight build cannot be replaced in
place; upload a higher build and remove the older build from testing.
