// G3: Kontostand-Prognose. Erwartete Endstände von Hand gerechnet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prognose, leereDaten } from "../src/logic.js";

const schicht = (datum) => ({ id: datum, datum, beginn: "08:00", ende: "16:30", pause: 30, lohn: 1400, notiz: "" }); // 8 h = 112,00 €

function beispiel(einstellungen = {}) {
  const d = leereDaten();
  d.einstellungen = { ...d.einstellungen, zahltag: 15, zahlungImFolgemonat: true, ...einstellungen };
  d.kontostand = { betrag: 100000, datum: "2026-10-14" };
  d.schichten = [schicht("2026-09-10"), schicht("2026-09-11"), schicht("2026-10-20")]; // September 224,00 €, Oktober 112,00 €
  d.abos = [
    { id: "n", name: "Streaming", betrag: 1399, tag: 20, rhythmus: 1, abMonat: "2026-01", bisMonat: "" },
    { id: "h", name: "Handy", betrag: 1500, tag: 1, rhythmus: 1, abMonat: "2026-01", bisMonat: "" },
    { id: "v", name: "Versicherung", betrag: 12000, tag: 5, rhythmus: 12, abMonat: "2026-11", bisMonat: "" },
  ];
  d.ausgaben = [
    { id: "x", name: "Einkauf heute", betrag: 5000, datum: "2026-10-14" },
    { id: "y", name: "Geschenk", betrag: 2500, datum: "2026-10-25" },
  ];
  return d;
}

test("Ende Oktober: Stand + Lohn September am 15.10. − Abbuchungen nach dem 14.10.", () => {
  const p = prognose(beispiel(), "2026-10-31");
  // 1000,00 + 224,00 − 13,99 − 25,00 = 1185,01
  assert.equal(p.ende, 118501);
  assert.deepEqual(p.buchungen.map((b) => [b.datum, b.betrag]), [
    ["2026-10-15", 22400],
    ["2026-10-20", -1399],
    ["2026-10-25", -2500],
  ]);
  assert.equal(p.buchungen.at(-1).danach, 118501);
});

test("Ende November: zusätzlich Handy, Versicherung, Lohn Oktober, Streaming", () => {
  // 1185,01 − 15,00 − 120,00 + 112,00 − 13,99 = 1148,02
  assert.equal(prognose(beispiel(), "2026-11-30").ende, 114802);
});

test("Lohn im selben Monat am 31. wird am Monatsende gebucht", () => {
  const p = prognose(beispiel({ zahltag: 31, zahlungImFolgemonat: false }), "2026-10-31");
  // 1000,00 − 13,99 − 25,00 + 112,00 = 1073,01 (September wurde schon am 30.09. gezahlt)
  assert.equal(p.ende, 107301);
  assert.deepEqual(p.buchungen.at(-1), { datum: "2026-10-31", text: "Lohn Oktober", betrag: 11200, art: "lohn", danach: 107301 });
});

test("ein Monat ohne Schichten erzeugt keine Lohnbuchung über 0 €", () => {
  const d = beispiel();
  d.schichten = [];
  assert.equal(prognose(d, "2026-10-31").buchungen.some((b) => b.art === "lohn"), false);
});

test("ohne Kontostand oder mit Stichtag vor dem Kontostand gibt es keine Prognose", () => {
  const d = beispiel();
  assert.equal(prognose(d, "2026-10-13"), null);
  d.kontostand = null;
  assert.equal(prognose(d, "2026-10-31"), null);
});
