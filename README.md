# Hex Drop: iPhone test build (b35)

Play it: **https://wowthisworkshuh.github.io/hexdrop-test/**

On an iPhone, open that link in **Safari**, then put it on the Home Screen
(the game shows the steps itself): tap **···** next to the address, then
**Share**, then **Add to Home Screen**, leave **Open as Web App** on, and tap **Add**.
It then opens full screen like an app and works with no signal.

When a newer build is uploaded here, a running copy offers to update, and a
fresh launch picks it up by itself.

Returning players see a short patch notes popup once after loading a new build.
Reopen it from Settings → Options → Patch notes. Notes ship inside the game and
work offline; new players keep the existing introduction. This build also adds
rapid-tap page zoom protection and reduces spark allocation and cleanup work.

For each release, update `BUILD` and `PATCH_NOTES` in `index.html`, the build and
summary in `version.json`, and the cache version in `sw.js`. Keep the Android
bundle synchronized. Notes describe the loaded build, independently of a newer
version being offered by the server.

Ads are grey stand-ins ("simulated placeholder") at the times real ads would
show: there is no ad network on the web. The Android app is built separately.

Fonts: Lexend, Chakra Petch, Nunito, Space Grotesk, Rajdhani and Orbitron,
under the SIL Open Font License 1.1, built into index.html.

## Public test safety

Online leaderboards, joining, and score uploads are enabled in b31. Rankings
accept client-reported scores for this public test; they are not verified and
can be manipulated. Input validation and service-wide limits reduce abuse but
do not prove that a game was played. Local bests work when the service is unavailable.
Settings lets participants delete their nickname and scores; deletion is complete
only after service confirmation. Deploy the matching updated private feedback
service using a new version of the existing Apps Script deployment.

The Today, This month and All time tabs continue to work offline, displaying
the corresponding personal bests stored on this device. All time also includes
older personal bests saved before per-period tracking was introduced.
Zen, Hard and Time Attack selectors remain available for those personal scores.
Incomplete board responses and invalid cached results are ignored so they cannot
break the controls or prevent the leaderboard from reopening.

Activity reports are approximate, opt-out counts, not verified players or
installations. Each daily report has a random event ID for duplicate suppression
and retries; it is not a stable player/device ID. Reports are sent only when the
service advertises the new event-ID protocol. Global Privacy Control disables them.

To move the service without a new web build, set `feedback` in `version.json` to
the new HTTPS URL and increment `serviceRevision`. Set `feedback` to `false` to
disable all service requests. Pending deletion stays local until a service is
enabled again; an explicit deletion request targets the service that owns the
old identity, without sending its credential to a replacement service. Board reads also keep
credentials with their owning service; cached and delayed results are scoped to
the service, membership revision, and score period. Queued
feedback stays attached to its original destination and is held locally after
endpoint rotation; it is not automatically resent to a new service. Ambiguous
feedback deliveries retain their original IDs with backoff and do not block
other messages. A lower revision cannot undo newer configuration.
Do not place credentials in this public repository or in the service URL.

Run local regression checks with `node --test tests/*.test.cjs`.

Gameplay reuses bounded tile and font-metric caches instead of rebuilding each
ordinary tile every frame. Changing appearance, layout, or loaded fonts refreshes
the cached graphics. Charged glows and merge scaling still render live, and
merge banners use their existing transform animation without animating font size.
Optional real Chromium checks are available as `node tests/browser-smoke.cjs`
and `node tests/browser-online.cjs` (mocked online joining, score uploads, board
reads, and deletion); set `PLAYWRIGHT_MODULE` and `CHROMIUM_MODULE` to installed package paths if needed.
`node tests/browser-rendering.cjs` compares the cached and live tile painter at
retina resolution. Use `BROWSER_ENGINE=webkit` and optionally
`BROWSER_EXECUTABLE_PATH` to check with a locally installed WebKit runtime;
the same options work for the gameplay and online checks.
`node tests/browser-merge.cjs` checks a real touch merge, saved score, and Continue.
`node tests/browser-patch-notes.cjs` checks update notes, dismissal, Settings access,
and first-visit and gameplay deferral.
These browser tests
require Playwright and a compatible browser runtime. Tests use local fixtures
and never write to the deployed service.
