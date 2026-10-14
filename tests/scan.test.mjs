// G6: Antwort der Foto-Analyse wird in Schicht-Vorschläge übersetzt (ohne echten API-Aufruf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanZuSchichten } from "../src/scan.js";

const einstellungen = {
  standardPause: 30,
  kuerzel: [
    { code: "F", beginn: "06:00", ende: "14:00", pause: 30 },
    { code: "N", beginn: "22:00", ende: "06:00", pause: 45 },
  ],
};
const eintrag = (felder) => ({ datum: "2026-10-14", beginn: "", ende: "", pause_min: 0, kuerzel: "", roh: "", ...felder });

test("Uhrzeiten aus dem Plan werden übernommen, ohne Pause gilt die Standardpause", () => {
  const r = scanZuSchichten({ name_gefunden: true, name_im_plan: "Muster", hinweis: "", schichten: [eintrag({ beginn: "08:00", ende: "16:30", roh: "8-16:30" })] }, einstellungen, []);
  assert.deepEqual(r.eintraege, [{ datum: "2026-10-14", beginn: "08:00", ende: "16:30", pause: 30, kuerzel: "", roh: "8-16:30", status: "ok", auswahl: true }]);
});

test("bekannte Kürzel werden zu Uhrzeiten, auch kleingeschrieben", () => {
  const r = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ datum: "2026-10-15", kuerzel: "f" }), eintrag({ datum: "2026-10-16", kuerzel: "N" })] }, einstellungen, []);
  assert.deepEqual(r.eintraege.map((e) => [e.beginn, e.ende, e.pause, e.status]), [
    ["06:00", "14:00", 30, "ok"],
    ["22:00", "06:00", 45, "ok"],
  ]);
});

test("unbekanntes Kürzel wird als unklar markiert und ist nicht ausgewählt", () => {
  const [e] = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ kuerzel: "Z" })] }, einstellungen, []).eintraege;
  assert.equal(e.status, "unklar");
  assert.equal(e.auswahl, false);
  assert.equal(e.beginn, "");
});

test("ungültige Daten werden verworfen", () => {
  const r = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ datum: "2026-02-30", beginn: "08:00", ende: "12:00" }), eintrag({ datum: "14.10.", beginn: "08:00", ende: "12:00" })] }, einstellungen, []);
  assert.equal(r.eintraege.length, 0);
});

test("schon eingetragene Schicht ist markiert und nicht ausgewählt", () => {
  const vorhanden = [{ datum: "2026-10-14", beginn: "08:00" }];
  const [e] = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ beginn: "08:00", ende: "16:30" })] }, einstellungen, vorhanden).eintraege;
  assert.equal(e.status, "doppelt");
  assert.equal(e.auswahl, false);
});

test("Pause aus dem Plan hat Vorrang vor Kürzel und Standard", () => {
  const [e] = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ kuerzel: "F", pause_min: 15 })] }, einstellungen, []).eintraege;
  assert.equal(e.pause, 15);
});

test("Name nicht gefunden ergibt keine Vorschläge, auch wenn Einträge mitkommen", () => {
  const r = scanZuSchichten({ name_gefunden: false, name_im_plan: "", hinweis: "Name fehlt", schichten: [eintrag({ beginn: "08:00", ende: "12:00" })] }, einstellungen, []);
  assert.equal(r.nameGefunden, false);
  assert.equal(r.hinweis, "Name fehlt");
  assert.deepEqual(r.eintraege, []);
});

test("Vorschläge sind nach Datum sortiert", () => {
  const r = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ datum: "2026-10-20", beginn: "08:00", ende: "12:00" }), eintrag({ datum: "2026-10-03", beginn: "08:00", ende: "12:00" })] }, einstellungen, []);
  assert.deepEqual(r.eintraege.map((e) => e.datum), ["2026-10-03", "2026-10-20"]);
});
