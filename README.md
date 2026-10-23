# Hex Drop: iPhone test build (b30)

Play it: **https://wowthisworkshuh.github.io/hexdrop-test/**

On an iPhone, open that link in **Safari**, then put it on the Home Screen
(the game shows the steps itself): tap **···** next to the address, then
**Share**, then **Add to Home Screen**, leave **Open as Web App** on, and tap **Add**.
It then opens full screen like an app and works with no signal.

When a newer build is uploaded here, a running copy offers to update, and a
fresh launch picks it up by itself.

Ads are grey stand-ins ("simulated placeholder") at the times real ads would
show: there is no ad network on the web. The Android app is built separately.

Fonts: Lexend, Chakra Petch, Nunito, Space Grotesk, Rajdhani and Orbitron,
under the SIL Open Font License 1.1, built into index.html.

## Public test safety

Online leaderboards and score uploads are paused in b30. Best scores stay on
the device. Settings still lets an existing participant request deletion of
previous leaderboard data; deletion is complete only after service confirmation.
Deploy the updated private feedback service before distributing b30.

The Today, This month and All time tabs continue to work offline, displaying
the corresponding personal bests stored on this device. All time also includes
older personal bests saved before per-period tracking was introduced.

Activity reports are approximate, opt-out counts, not verified players or
installations. Each daily report has a random event ID for duplicate suppression
and retries; it is not a stable player/device ID. Reports are sent only when the
service advertises the new event-ID protocol. Global Privacy Control disables them.

To move the service without a new web build, set `feedback` in `version.json` to
the new HTTPS URL and increment `serviceRevision`. Set `feedback` to `false` to
disable all service requests. Pending deletion stays local until a service is
enabled again; an explicit deletion request targets the service that owns the
old identity, without sending its credential to a replacement service. Queued
feedback stays attached to its original destination and is held locally after
endpoint rotation; it is not automatically resent to a new service. Ambiguous
feedback deliveries retain their original IDs with backoff and do not block
other messages. A lower revision cannot undo newer configuration.
Do not place credentials in this public repository or in the service URL.

Run local regression checks with `node --test tests/security.test.cjs`.
An optional real Chromium check is available as `node tests/browser-smoke.cjs`;
set `PLAYWRIGHT_MODULE` and `CHROMIUM_MODULE` to installed package paths if needed.
Tests use local fixtures and never write to the deployed service.
