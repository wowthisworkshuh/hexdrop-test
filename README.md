# Hex Drop: iPhone test build (b38)

Play it: **https://wowthisworkshuh.github.io/hexdrop-test/**

On an iPhone, open that link in **Safari**, then put it on the Home Screen
(the game shows the steps itself): tap **···** next to the address, then
**Share**, then **Add to Home Screen**, leave **Open as Web App** on, and tap **Add**.
It then opens full screen like an app and works with no signal.

When a newer build is uploaded here, a running copy offers to update, and a
fresh launch picks it up by itself.

Returning players see a short patch notes popup once after loading a new build.
Reopen it from Settings → Options → Patch notes. Notes ship inside the game and
work offline; new players keep the existing introduction.

b38 changes how a move plays and looks, keeping scores in line with b37.
A dropped tile falls visibly (about 0.34 s down an empty column), the match it
makes merges at once as before, and each cascade step after it is shown: the
tiles that connected glow together, slide into one and merge. As before, a tap
only drops once the board has stopped, plus a 0.2 s double-tap guard. The FAST
streak counts only the player's own time (falls and merges don't use it up) with
a 2-second window, and in Time Attack the floor clock runs at 40% speed while
tiles move, so the slower animation costs no extra time. Bot games on the same
deals put every mode within about 6% of b37's scores, for quick and slower
players. Next pieces come from a shuffled bag per mode (the rising floor row and
the safety net near the top are unchanged; a saved run keeps its bag).

The HUD shows HOLD | NOW | NEXT as three named boxes. The floor countdown and,
with online leaderboards on, the player's rank today sit in real text under the
boxes, or over the board's top-right corner on short screens, so the board keeps
b37's size. The rank reads today's board when a run starts or resumes and then at
most every five minutes while playing, through the same cached read the
Leaderboards sheet uses; no Google Apps Script change is needed. Text size also
enlarges the play screen's labels where there is room.

Power tiles show the power's colour in a dark frame, readable on every tile and
colourway. Rounded is the default shape; the score track is Pebble 250k, Outline
750k, Mosaic 1.5M, Sunset 3M, Blossom 5M and Glass 12M. Circle, Square, Diamond and
Octagon are retired: a player who had unlocked one when b38 first runs keeps it.
The leaderboard name screen has a New colour button (sent with the name on Save
or Join, one request). The offline score queue keeps every month and all-time
best when it overflows, a full feedback queue keeps the new message on screen
instead of dropping an older one, and quick taps on iPhone no longer zoom the
page (the board cancels the browser's own touch handling; a quick second tap
elsewhere still lands as a tap).

b37 fixes a regression that blocked leaderboard reads behind a six-second
service check and rejected startup responses when the same endpoint was saved
to configuration. Known services can be read while health refreshes in the
background; first-time checks allow up to 20 seconds. Public board reads use
GET without player credentials. Personal ranks still use POST; transport or
malformed-response failures can fall back to public scores with a clear personal
rank unavailable message. Explicit server errors are not retried through that
fallback. Endpoint changes and explicit service disabling still invalidate stale
responses. No Google Apps Script changes are required.

b37 also counts each revived run once and adds only newly earned points to its
lifetime total. This bookkeeping survives saved runs and reloads. Existing
recorded totals and awarded cosmetics are preserved. The first merge of a new
run no longer gains a speed bonus merely because the page was just opened.

b36 introduced loading after service discovery. Matching reads share
one request, recent results are reused for 30 seconds, and older saved results
remain visible while refreshing. The board shows its saved time and offers
Refresh or Retry. New scores and membership changes invalidate cached results.
The existing Google Apps Script deployment is used without changes; fresh
network requests can still take several seconds.

Settings → Options → Local diagnostics shows a copyable report of this device's
foreground time, run starts/resumes, mode use, leaderboard latency and errors,
and sampled frame delays. Summaries are kept locally for up to 28 days, with
collection and clearing controls. Global Privacy Control disables collection.
Reports exclude nicknames, player credentials, and saved games, and are never
automatically sent with feedback. Sessions mean page launches, foreground time
includes menus, and frame samples are approximate diagnostics rather than an
FPS benchmark. Centralized session/retention analytics is not configured.

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
only after service confirmation. b37 uses the existing service deployment and
does not require a Google Apps Script update.

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
`node tests/browser-modes.cjs` checks all four modes, first-merge scoring,
Hold limits, and saved-run continuity.
`node tests/browser-revive.cjs` checks revival, saved run credit, and final
lifetime totals through the game-over and Continue controls in all four modes.
`node tests/browser-patch-notes.cjs` checks update notes, dismissal, Settings access,
and first-visit and gameplay deferral.
`node tests/browser-connectivity.cjs` checks slow redirected service responses,
startup configuration, and connection reuse after upgrades.
`node tests/browser-metrics.cjs` checks local diagnostics, privacy controls,
report copying and run/resume integration.
These browser tests
require Playwright and a compatible browser runtime. Tests use local fixtures
and never write to the deployed service.
