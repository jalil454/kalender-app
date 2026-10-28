// Service Worker: hält die App-Dateien vor, damit die App auch offline startet.
// Online wird immer zuerst die neueste Version geladen; der Speicher ist nur Ersatz.
const CACHE = "kalender-v3";
const DATEIEN = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/app.js",
  "src/logic.js",
  "src/store.js",
  "src/scan.js",
  "src/push.js",
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
  // Anfragen an Groq gehen direkt ins Netz und werden nie gespeichert.
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

// Push-Nachricht vom eigenen Server anzeigen (Inhalt: { titel, text }).
self.addEventListener("push", (ereignis) => {
  let daten = {};
  try {
    daten = ereignis.data?.json() ?? {};
  } catch {}
  ereignis.waitUntil(self.registration.showNotification(daten.titel ?? "Kalender", { body: daten.text ?? "", icon: "icons/icon-192.png", badge: "icons/icon-192.png" }));
});

// Tippen auf die Nachricht öffnet die App. Bei „Schicht vorbei“ zeigt sie den Kalender mit der Abhaken-Karte
// (eine neu geöffnete App startet ohnehin im Kalender).
self.addEventListener("notificationclick", (ereignis) => {
  ereignis.notification.close();
  const abhaken = ereignis.notification.title.startsWith("Schicht vorbei");
  ereignis.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenster) => {
      if (!fenster[0]) return self.clients.openWindow("./");
      if (abhaken) fenster[0].postMessage({ ziel: "kalender" });
      return fenster[0].focus();
    }),
  );
});
