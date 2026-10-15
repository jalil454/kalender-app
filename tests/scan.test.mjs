// G6: Antwort der Foto-Analyse wird in Schicht-Vorschläge übersetzt (ohne echten API-Aufruf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanZuSchichten, jsonAusText, streifen } from "../src/scan.js";

const einstellungen = {
  standardPause: 30,
  kuerzel: [
    { code: "F", beginn: "06:00", ende: "14:00", pause: 30 },
    { code: "N", beginn: "22:00", ende: "06:00", pause: 45 },
  ],
};
// pause_min -1 heißt: im Plan steht keine Pause
const eintrag = (felder) => ({ datum: "2026-10-14", beginn: "", ende: "", pause_min: -1, kuerzel: "", roh: "", ...felder });

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

test("Pause 0:00 aus dem Plan bleibt 0 und wird nicht durch Kürzel oder Standard ersetzt", () => {
  const [mitKuerzel, ohne] = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ kuerzel: "F", pause_min: 0 }), eintrag({ datum: "2026-10-15", beginn: "16:00", ende: "18:00", pause_min: 0 })] }, einstellungen, []).eintraege;
  assert.equal(mitKuerzel.pause, 0);
  assert.equal(ohne.pause, 0);
});

test("Bereichskürzel vor einer Uhrzeit: Zeiten aus dem Plan gelten, auch wenn das Kürzel unbekannt ist", () => {
  const [e] = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ beginn: "16:00", ende: "19:00", pause_min: 0, kuerzel: "KA", roh: "KA 16:00-19:00 0:00" })] }, einstellungen, []).eintraege;
  assert.deepEqual([e.beginn, e.ende, e.pause, e.status, e.auswahl], ["16:00", "19:00", 0, "ok", true]);
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

test("JSON wird auch aus Codeblock oder hinter Denktext gelesen, Unlesbares wird abgelehnt", () => {
  assert.deepEqual(jsonAusText('{"a":1}'), { a: 1 });
  assert.deepEqual(jsonAusText('```json\n{"a":{"b":[1,2]}}\n```'), { a: { b: [1, 2] } });
  assert.deepEqual(jsonAusText('<think>Zeile {Muster} prüfen</think>{"a":2}'), { a: 2 });
  assert.throws(() => jsonAusText("Kein JSON hier"), /nicht gelesen/);
  assert.throws(() => jsonAusText(""), /nicht gelesen/);
});

test("ohne festes Schema: Zeit ohne führende Null und Pause als Text werden verstanden", () => {
  const r = scanZuSchichten({ name_gefunden: true, schichten: [eintrag({ beginn: "9:00", ende: "14:01", pause_min: "30" }), eintrag({ datum: "2026-10-15", beginn: "08:00", ende: "12:00", pause_min: "" })] }, einstellungen, []);
  assert.deepEqual(r.eintraege.map((e) => [e.beginn, e.ende, e.pause, e.status]), [
    ["09:00", "14:01", 30, "ok"],
    ["08:00", "12:00", 30, "ok"],
  ]);
});

const nah = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("Streifen bei geradem Foto: Zeile waagerecht, Kopfzeile darüber", () => {
  const g = streifen({ x: 100, y: 500 }, { x: 1100, y: 500 }, { x: 150, y: 100 });
  nah(g.u.x, 1); nah(g.u.y, 0); nah(g.n.x, -0); nah(g.n.y, 1);
  nah(g.start.x, -50); nah(g.start.y, 500); // 15 % der Zeilenlänge vor dem Namen
  nah(g.kopfVersatz, -400);
  nah(g.kopfStart.x, -50); nah(g.kopfStart.y, 100);
  nah(g.laenge, 1180); nah(g.halbeDicke, 16); nah(g.kopfHalbeDicke, 40);
});

test("Streifen bei um 90° gedrehtem Foto: Zeile läuft nach unten, Kopfzeile liegt rechts davon", () => {
  const g = streifen({ x: 500, y: 100 }, { x: 500, y: 1100 }, { x: 900, y: 140 });
  nah(g.u.x, 0); nah(g.u.y, 1); nah(g.n.x, -1); nah(g.n.y, 0);
  nah(g.kopfVersatz, -400);
  nah(g.kopfStart.x, 900); nah(g.kopfStart.y, -50);
});

test("Streifen bei schiefem Foto: egal wo in der Kopfzeile getippt wird, die Kopfzeile bleibt dieselbe", () => {
  const p1 = { x: 0, y: 0 };
  const p2 = { x: 1000, y: -50 }; // Zeile steigt nach rechts leicht an
  const a = streifen(p1, p2, { x: 100, y: -300 });
  const u = a.u;
  const b = streifen(p1, p2, { x: 100 + u.x * 700, y: -300 + u.y * 700 }); // 700 px weiter entlang der Kopfzeile
  nah(a.kopfVersatz, b.kopfVersatz);
  nah(Math.hypot(a.u.x, a.u.y), 1);
  nah(a.u.x * a.n.x + a.u.y * a.n.y, 0); // n steht senkrecht auf u
});
