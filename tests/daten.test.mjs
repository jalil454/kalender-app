// G4: Export und Import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportiere, importiere, leereDaten, mitStandardwerten } from "../src/logic.js";

function beispiel() {
  const d = leereDaten();
  d.einstellungen = { ...d.einstellungen, stundenlohn: 1390, name: "Muster", kuerzel: [{ code: "F", beginn: "06:00", ende: "14:00", pause: 30 }], apiKey: "sk-ant-test-geheim" };
  d.schichten = [{ id: "s1", datum: "2026-10-14", beginn: "08:00", ende: "16:30", pause: 30, lohn: 1390, notiz: "Kasse, Lager" }];
  d.abos = [{ id: "a1", name: "Streaming", betrag: 999, tag: 20, rhythmus: 1, abMonat: "2026-01", bisMonat: "" }];
  d.ausgaben = [{ id: "e1", name: "Schuhe", betrag: 5995, datum: "2026-10-20" }];
  d.kontostand = { betrag: -1250, datum: "2026-10-14" };
  d.todos = [{ id: "t1", text: "Login reparieren", projekt: "Trad tracker", faellig: "2026-10-30", erledigt: false }];
  return d;
}

test("Export und Import ergeben dieselben Daten, der API-Key bleibt der des Geräts", () => {
  const original = beispiel();
  const zurueck = importiere(exportiere(original), "geraete-key");
  assert.deepEqual(zurueck, { ...original, einstellungen: { ...original.einstellungen, apiKey: "geraete-key" } });
});

test("der API-Key steht nie in der Export-Datei", () => {
  assert.equal(exportiere(beispiel()).includes("sk-ant-test-geheim"), false);
});

test("kaputtes JSON wird abgelehnt", () => {
  assert.throws(() => importiere("{kaputt"), /kein gültiges JSON/);
});

test("ungültiges Datum in einer Schicht wird abgelehnt", () => {
  const d = JSON.parse(exportiere(beispiel()));
  d.schichten[0].datum = "2026-13-01";
  assert.throws(() => importiere(JSON.stringify(d)), /Schicht/);
});

test("unbekannte Version und fehlende Listen werden abgelehnt", () => {
  const d = JSON.parse(exportiere(beispiel()));
  assert.throws(() => importiere(JSON.stringify({ ...d, version: 2 })), /Version/);
  const ohneTodos = { ...d };
  delete ohneTodos.todos;
  assert.throws(() => importiere(JSON.stringify(ohneTodos)), /todos/);
});

test("ungültiger Abo-Rhythmus wird abgelehnt", () => {
  const d = JSON.parse(exportiere(beispiel()));
  d.abos[0].rhythmus = 2;
  assert.throws(() => importiere(JSON.stringify(d)), /Abo/);
});

test("ältere gespeicherte Daten bekommen neue Felder mit Standardwerten", () => {
  const alt = { version: 1, einstellungen: { stundenlohn: 1390 }, schichten: [], abos: [], ausgaben: [], kontostand: null, todos: [] };
  const neu = mitStandardwerten(alt);
  assert.equal(neu.einstellungen.stundenlohn, 1390);
  assert.equal(neu.einstellungen.standardPause, 30);
  assert.deepEqual(neu.einstellungen.kuerzel, []);
});
