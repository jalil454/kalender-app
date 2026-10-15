// Service Worker: hält die App-Dateien vor, damit die App auch offline startet.
// Online wird immer zuerst die neueste Version geladen; der Speicher ist nur Ersatz.
const CACHE = "kalender-v2";
const DATEIEN = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/app.js",
  "src/logic.js",
  "src/store.js",
  "src/scan.js",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (ereignis) => {
  ereignis.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(DATEIEN)));
  self.skipWaiting();
});

self.addEventListener("activate", (ereignis) => {
  ereignis.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (ereignis) => {
  const anfrage = ereignis.request;
  // Anfragen an Gemini gehen direkt ins Netz und werden nie gespeichert.
  if (anfrage.method !== "GET" || new URL(anfrage.url).origin !== self.location.origin) return;
  ereignis.respondWith(
    // no-cache: beim Server nachfragen statt die 10 Minuten aus dem Browser-Cache zu nehmen,
    // sonst laufen nach einem Update kurz alte und neue Dateien gemischt.
    fetch(anfrage.url, { cache: "no-cache" })
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((cache) => cache.put(anfrage, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(anfrage, { ignoreSearch: true })),
  );
});
