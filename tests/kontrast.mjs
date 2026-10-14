// G8: Rechnet den Kontrast (WCAG 2.x) aller Text- und Bedienfarben aus styles.css nach, hell und dunkel.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

function tokens(block) {
  const karte = {};
  for (const [, name, wert] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)) karte[name] = wert;
  return karte;
}

function blockNach(text, start) {
  const auf = text.indexOf(":root {", start);
  if (auf < 0) throw new Error(":root-Block fehlt");
  return text.slice(auf, text.indexOf("}", auf));
}

const dunkelStart = css.indexOf("@media (prefers-color-scheme: dark)");
if (dunkelStart < 0) throw new Error("Dunkelmodus fehlt in styles.css");
const hell = tokens(blockNach(css, 0));
const dunkel = { ...hell, ...tokens(blockNach(css, dunkelStart)) };

function leuchtdichte(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((z) => z + z).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a, b) {
  const [l1, l2] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Kontrolle: bekannte Werte müssen herauskommen.
if (Math.abs(kontrast("#000000", "#ffffff") - 21) > 0.01) throw new Error("Kontrolle: Schwarz/Weiß muss 21:1 sein");
if (kontrast("#777777", "#ffffff") >= 4.5) throw new Error("Kontrolle: #777 auf Weiß muss unter 4,5:1 liegen");

// [Vordergrund, Hintergrund, Mindestwert] – Text 4,5:1, Bedienelemente und Grafik 3:1
const PAARE = [
  ["text", "bg", 4.5],
  ["text", "flaeche", 4.5],
  ["text", "flaeche-2", 4.5],
  ["text-2", "bg", 4.5],
  ["text-2", "flaeche", 4.5],
  ["text-2", "flaeche-2", 4.5],
  ["akzent-text", "akzent", 4.5],
  ["warnung", "bg", 4.5],
  ["warnung", "flaeche", 4.5],
  ["akzent", "bg", 3],
  ["akzent", "flaeche", 3],
  ["text-2", "flaeche", 3], // Rand der To-do-Kreise
];

let fehler = 0;
let geprueft = 0;
for (const [modus, t] of [["hell", hell], ["dunkel", dunkel]]) {
  for (const [vorne, hinten, mindestens] of PAARE) {
    if (!t[vorne] || !t[hinten]) throw new Error(`Token --${vorne} oder --${hinten} fehlt (${modus})`);
    const wert = kontrast(t[vorne], t[hinten]);
    geprueft++;
    const ok = wert >= mindestens;
    if (!ok) fehler++;
    console.log(`${ok ? "ok    " : "ZU WENIG"} ${modus.padEnd(6)} --${vorne} auf --${hinten}: ${wert.toFixed(2)}:1 (mind. ${mindestens}:1)`);
  }
}

if (fehler) {
  console.log(`${fehler} Paar(e) unter dem Mindestkontrast`);
  process.exit(1);
}
console.log(`KONTRAST OK (${geprueft} Paare, hell und dunkel, Kontrolle bestanden)`);
