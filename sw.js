// Hex Drop web build b31. Only a successful game-document response may replace
// the offline game; navigating to a README, icon or other asset cannot do so.
const CACHE = "hexdrop-b31";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
const GAME_PATHS = new Set([
  new URL("./", self.registration.scope).pathname,
  new URL("./index.html", self.registration.scope).pathname
]);
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hexdrop-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
function cachedGame() {
  return caches.match("./index.html").then((r) => r || caches.match("./"));
}
function fetchGame(req) {
  const ctl = new AbortController();
  let timer;
  return Promise.race([
    fetch(req, { cache: "no-store", signal: ctl.signal }),
    new Promise((_, reject) => {
      timer = setTimeout(() => { ctl.abort(); reject(new Error("slow")); }, 4000);
    })
  ]).then((r) => { clearTimeout(timer); return r; }, (err) => { clearTimeout(timer); throw err; });
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/version.json")) return; // configuration is always network-only
  if (req.mode === "navigate" && GAME_PATHS.has(url.pathname)) {
    e.respondWith(fetchGame(req).then((res) => {
      const finalUrl = new URL(res.url || req.url);
      if (res.ok && finalUrl.origin === self.location.origin && GAME_PATHS.has(finalUrl.pathname) &&
          /^text\/html(?:;|$)/i.test(res.headers.get("content-type") || "")) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put("./index.html", copy)));
      }
      if (res.status >= 500) return cachedGame().then((cached) => cached || res);
      return res;
    }).catch(() => cachedGame().then((r) => r || Response.error())));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
