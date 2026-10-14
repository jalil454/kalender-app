// G9: Prüft, ob die App installierbar ist und offline startet: Manifest, Icons, Service Worker.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wurzel = fileURLToPath(new URL("..", import.meta.url));
const lies = (pfad) => readFileSync(wurzel + pfad, "utf8");
const fehler = [];
const pruefe = (bedingung, text) => bedingung || fehler.push(text);

function pngGroesse(pfad) {
  const b = readFileSync(wurzel + pfad);
  if (b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${pfad} ist kein PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

// Kontrolle: der PNG-Leser muss Nicht-PNGs ablehnen.
let abgelehnt = false;
try {
  pngGroesse("index.html");
} catch {
  abgelehnt = true;
}
if (!abgelehnt) throw new Error("Kontrolle: PNG-Leser hat index.html akzeptiert");

// Manifest
const manifest = JSON.parse(lies("manifest.webmanifest"));
for (const feld of ["name", "short_name", "start_url", "scope", "background_color", "theme_color"]) pruefe(manifest[feld], `Manifest: ${feld} fehlt`);
pruefe(["standalone", "fullscreen"].includes(manifest.display), "Manifest: display muss standalone sein");
const iconGroessen = new Set();
for (const icon of manifest.icons ?? []) {
  if (!existsSync(wurzel + icon.src)) {
    pruefe(false, `Icon fehlt: ${icon.src}`);
    continue;
  }
  const echt = pngGroesse(icon.src);
  pruefe(echt === icon.sizes, `Icon ${icon.src}: Manifest sagt ${icon.sizes}, Datei ist ${echt}`);
  iconGroessen.add(echt);
}
pruefe(iconGroessen.has("192x192") && iconGroessen.has("512x512"), "Manifest braucht Icons in 192 und 512 px");

// index.html
const html = lies("index.html");
const verweise = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
for (const v of verweise) pruefe(existsSync(wurzel + v), `index.html verweist auf fehlende Datei ${v}`);
pruefe(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), "index.html: Manifest-Link fehlt");
const touch = /<link rel="apple-touch-icon" href="([^"]+)">/.exec(html)?.[1];
pruefe(touch && existsSync(wurzel + touch) && pngGroesse(touch) === "180x180", "index.html: apple-touch-icon mit 180x180 fehlt");
pruefe(/name="viewport"[^>]*viewport-fit=cover/.test(html), "index.html: viewport-fit=cover fehlt");

// Service Worker
const sw = lies("sw.js");
const liste = /const DATEIEN = \[([\s\S]*?)\];/.exec(sw);
pruefe(liste, "sw.js: Liste DATEIEN fehlt");
const gecacht = new Set([...(liste?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
for (const datei of gecacht) pruefe(datei === "./" || existsSync(wurzel + datei), `sw.js cached fehlende Datei ${datei}`);
const noetig = ["./", "index.html", "styles.css", "manifest.webmanifest", ...readdirSync(wurzel + "src").map((d) => `src/${d}`), ...verweise, ...(manifest.icons ?? []).map((i) => i.src)];
for (const datei of noetig) pruefe(gecacht.has(datei), `sw.js cached ${datei} nicht (offline fehlt sie)`);
pruefe(/serviceWorker\.register\("sw\.js"\)/.test(lies("src/app.js")), "src/app.js registriert sw.js nicht");

if (fehler.length) {
  console.log(fehler.join("\n"));
  process.exit(1);
}
console.log(`PWA OK (${iconGroessen.size} Icon-Größen, ${gecacht.size} Dateien offline, Kontrolle bestanden)`);
