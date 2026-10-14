// G7: Findet Blau- und Lilatöne in Styles, HTML, Manifest, Icon und Oberfläche.
// Vorher prüft das Skript, dass es bekannte Blau-/Lilawerte erkennt und Grau/Graphit/Rot nicht (Kontrolle).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wurzel = fileURLToPath(new URL("..", import.meta.url));
const DATEIEN = ["styles.css", "index.html", "manifest.webmanifest", "icons/icon.svg", "src/app.js"];

function zuRgb(farbe) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(farbe);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((z) => z + z).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = /^rgba?\(([^)]*)\)$/i.exec(farbe);
  if (rgb) return rgb[1].split("/")[0].split(/[\s,]+/).filter(Boolean).slice(0, 3).map(Number);
  return null;
}

// Liefert Farbton (0–360) und Buntheit (0–1). Hsl-Werte werden direkt gelesen.
function tonUndBuntheit(farbe) {
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%/i.exec(farbe);
  if (hsl) return { ton: Number(hsl[1]) % 360, buntheit: Number(hsl[2]) / 100 };
  const [r, g, b] = zuRgb(farbe).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  if (c === 0) return { ton: 0, buntheit: 0 };
  let ton = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  ton = (ton * 60 + 360) % 360;
  return { ton, buntheit: c };
}

const istBlauOderLila = (farbe) => {
  const { ton, buntheit } = tonUndBuntheit(farbe);
  return buntheit >= 0.08 && ton >= 180 && ton <= 330;
};

const FARBE = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

// Kontrolle: Der Detektor muss diese Werte richtig einordnen, sonst ist sein „OK“ wertlos.
const SOLL_TREFFER = ["#007AFF", "#5856D6", "#8B5CF6", "#60A5FA", "#6366f1", "rgb(99 102 241)", "rgba(56, 189, 248, 1)", "hsl(260 80% 60%)"];
const SOLL_KEIN_TREFFER = ["#1a1a19", "#f4f3f1", "#ffffff", "#000", "#b3362b", "#f0897a", "rgb(0 0 0 / 0.5)", "#a19f9a"];
for (const f of SOLL_TREFFER) if (!istBlauOderLila(f)) throw new Error(`Kontrolle fehlgeschlagen: ${f} wurde nicht erkannt`);
for (const f of SOLL_KEIN_TREFFER) if (istBlauOderLila(f)) throw new Error(`Kontrolle fehlgeschlagen: ${f} fälschlich erkannt`);

let anzahl = 0;
const funde = [];
for (const datei of DATEIEN) {
  const zeilen = readFileSync(wurzel + datei, "utf8").split("\n");
  zeilen.forEach((zeile, i) => {
    for (const [farbe] of zeile.matchAll(FARBE)) {
      anzahl++;
      if (istBlauOderLila(farbe)) funde.push(`${datei}:${i + 1}  ${farbe}`);
    }
  });
}

if (anzahl === 0) throw new Error("Keine Farben gefunden – Dateien falsch gelesen?");
if (funde.length) {
  console.log(`Blau-/Lilatöne gefunden:\n${funde.join("\n")}`);
  process.exit(1);
}
console.log(`FARBEN OK (${anzahl} Farbwerte in ${DATEIEN.length} Dateien geprüft, Kontrolle bestanden)`);
