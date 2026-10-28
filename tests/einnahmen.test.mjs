// G22: Einmalige Einnahmen. Erwartete Stände von Hand gerechnet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prognose, leereDaten, mitStandardwerten, importiere, exportiere } from "../src/logic.js";

function beispiel() {
  const d = leereDaten();
  d.kontostand = { betrag: 100000, datum: "2026-10-14" };
  d.ausgaben = [{ id: "x", name: "Geschenk", betrag: 2500, datum: "2026-10-30" }];
  d.einnahmen = [
    { id: "e1", name: "Flohmarkt", betrag: 4000, datum: "2026-10-31" },
    { id: "e2", name: "Vor dem Kontostand", betrag: 9900, datum: "2026-10-14" }, // schon im Kontostand enthalten
    { id: "e3", name: "November", betrag: 1000, datum: "2026-11-02" },
  ];
  return d;
}

test("Prognose: Einnahme zählt am eingetragenen Tag mit Plus, nur nach dem Kontostand und bis zum Stichtag", () => {
  const p = prognose(beispiel(), "2026-10-31");
  // 1000,00 − 25,00 + 40,00 = 1015,00
  assert.equal(p.ende, 101500);
  assert.deepEqual(p.buchungen.map((b) => [b.datum, b.text, b.betrag, b.art]), [
    ["2026-10-30", "Geschenk", -2500, "ausgabe"],
    ["2026-10-31", "Flohmarkt", 4000, "einnahme"],
  ]);
  assert.equal(prognose(beispiel(), "2026-11-30").ende, 102500); // + 10,00 im November
});

test("Am selben Tag kommt die Einnahme vor der Ausgabe", () => {
  const d = beispiel();
  d.ausgaben[0].datum = "2026-10-31";
  assert.deepEqual(prognose(d, "2026-10-31").buchungen.map((b) => b.text), ["Flohmarkt", "Geschenk"]);
});

test("Neue Daten haben eine leere Einnahmen-Liste, alte Daten bekommen sie ergänzt", () => {
  assert.deepEqual(leereDaten().einnahmen, []);
  const alt = { version: 1, einstellungen: {}, schichten: [], abos: [], ausgaben: [], kontostand: null, todos: [] };
  assert.deepEqual(mitStandardwerten(alt).einnahmen, []);
});

test("Sicherung: Einnahmen gehen verlustfrei hin und zurück, alte Sicherungen ohne Einnahmen laden", () => {
  const d = beispiel();
  assert.deepEqual(importiere(exportiere(d)).einnahmen, d.einnahmen);
  const { einnahmen, ...ohne } = d;
  assert.deepEqual(importiere(exportiere(ohne)).einnahmen, []);
});

test("Kontrolle: kaputte Einnahmen werden beim Import abgelehnt", () => {
  const mit = (e) => exportiere({ ...beispiel(), einnahmen: [e] });
  assert.throws(() => importiere(mit({ id: "e", name: "A", betrag: 10.5, datum: "2026-10-31" })), /Einnahme/);
  assert.throws(() => importiere(mit({ id: "e", name: "A", betrag: 100, datum: "31.10.2026" })), /Einnahme/);
  assert.throws(() => importiere(exportiere({ ...beispiel(), einnahmen: "keine Liste" })), /einnahmen/);
});
