// Hex Drop web build b27: plays offline once opened, and stays current.
// The page itself always comes from the network first (falling back to the
// copy kept here when there is no signal), so a fresh launch is up to date;
// a copy already running sees version.json and offers to update.
const CACHE = "hexdrop-b27";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hexdrop-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
function slow(ms) { return new Promise((_, no) => setTimeout(() => no(new Error("slow")), ms)); }
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/version.json")) return;          // always asked of the network
  if (req.mode === "navigate") {
    e.respondWith(
      Promise.race([fetch(req, { cache: "no-store" }), slow(4000)])
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
