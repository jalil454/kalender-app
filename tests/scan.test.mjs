// G6: Antwort der Foto-Analyse wird in Schicht-Vorschläge übersetzt (ohne echten API-Aufruf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanZuSchichten, jsonAusText, streifen, zweitmeinung, planAusMarkdown } from "../src/scan.js";

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

const lesung = (schichten, gefunden = true) => scanZuSchichten({ name_gefunden: gefunden, name_im_plan: "Muster", hinweis: "", schichten }, einstellungen, []);
const namen = ["Groq", "Mistral"];

test("Zweitmeinung: gleiche Lesung bleibt vorausgewählt und ohne Markierung", () => {
  const s1 = [eintrag({ datum: "2026-11-07", beginn: "09:00", ende: "14:01", pause_min: 30 })];
  const r = zweitmeinung(lesung(s1), lesung(s1), namen);
  assert.equal(r.eintraege.length, 1);
  assert.equal(r.eintraege[0].abweichung, "");
  assert.equal(r.eintraege[0].auswahl, true);
});

test("Zweitmeinung: abweichende Zeit wird markiert, nicht vorausgewählt und nennt die andere Lesung", () => {
  const r = zweitmeinung(
    lesung([eintrag({ datum: "2026-11-07", beginn: "09:00", ende: "14:01", pause_min: 30 })]),
    lesung([eintrag({ datum: "2026-11-07", beginn: "09:00", ende: "14:00", pause_min: 30 })]),
    namen,
  );
  assert.equal(r.eintraege.length, 1);
  assert.equal(r.eintraege[0].ende, "14:01"); // Werte von Groq, zum Korrigieren
  assert.equal(r.eintraege[0].auswahl, false);
  assert.match(r.eintraege[0].abweichung, /Mistral liest: 09:00–14:00, 30 min Pause/);
});

test("Zweitmeinung: sieht nur ein Modell eine Schicht, wird sie unsicher angezeigt", () => {
  const r = zweitmeinung(
    lesung([eintrag({ datum: "2026-11-04", beginn: "16:00", ende: "18:00", pause_min: 0 })]),
    lesung([eintrag({ datum: "2026-11-07", beginn: "09:00", ende: "14:01", pause_min: 30 })]),
    namen,
  );
  assert.deepEqual(r.eintraege.map((e) => [e.datum, e.auswahl, e.abweichung]), [
    ["2026-11-04", false, "Nur Groq sieht hier eine Schicht."],
    ["2026-11-07", false, "Nur Mistral sieht hier eine Schicht."],
  ]);
});

test("Zweitmeinung: findet nur ein Modell den Namen, sind alle Einträge unsicher", () => {
  const r = zweitmeinung(lesung([], false), lesung([eintrag({ datum: "2026-11-07", beginn: "09:00", ende: "14:01", pause_min: 30 })]), namen);
  assert.equal(r.nameGefunden, true);
  assert.equal(r.eintraege[0].auswahl, false);
  assert.match(r.eintraege[0].abweichung, /Nur Mistral hat deinen Namen gefunden/);
});

test("Zweitmeinung: schon eingetragene Schicht bleibt abgewählt, auch wenn beide gleich lesen", () => {
  const s1 = [eintrag({ datum: "2026-10-14", beginn: "08:00", ende: "16:30" })];
  const vorhanden = [{ datum: "2026-10-14", beginn: "08:00" }];
  const a = scanZuSchichten({ name_gefunden: true, schichten: s1 }, einstellungen, vorhanden);
  const r = zweitmeinung(a, a, namen);
  assert.equal(r.eintraege[0].status, "doppelt");
  assert.equal(r.eintraege[0].auswahl, false);
});

// Tabellen wie aus der Texterkennung, im Format eines echten Personaleinsatzplans (Namen erfunden).
const KOPF = "| Zeitraum 02.11.26 - 08.11.26 | Mo 02.11.26 /KW 45 | Di 03.11.26 /KW 45 | Mi 04.11.26 /KW 45 | Do 05.11.26 /KW 45 | Fr 06.11.26 /KW 45 | Sa 07.11.26 /KW 45 | So 08.11.26 /KW 45 |";
const PLAN = [
  "# Personaleinsatzplan Kasse",
  "",
  KOPF,
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| Muster, Anna | SC 10:30-19:01 0:45 | SC 10:30-19:01 0:45 | Abwesend | Abwesend | Abwesend | SC 07:50-18:01 0:45 | |",
  "| Muster, Ben | Abwesend | Abwesend | KA 16:00-18:00 0:00 | Abwesend | KA 16:00-19:00 0:00 | BK 09:00-14:01 0:30 | |",
  "| Beispiel, Cem | F | Abwesend | Schule | | | | |",
].join("\n");

test("Automatik: findet Datumszeile und eigene Zeile und zerlegt Zeit, Pause und Kürzel", () => {
  const { antwort } = planAusMarkdown(PLAN, "Muster, Ben", "2026-10-15");
  assert.equal(antwort.name_gefunden, true);
  assert.equal(antwort.name_im_plan, "Muster, Ben");
  assert.deepEqual(antwort.schichten.map((s) => [s.datum, s.kuerzel, s.beginn, s.ende, s.pause_min]), [
    ["2026-11-04", "KA", "16:00", "18:00", 0],
    ["2026-11-06", "KA", "16:00", "19:00", 0],
    ["2026-11-07", "BK", "09:00", "14:01", 30],
  ]);
});

test("Automatik: Ergebnis läuft durch die normale Vorschau (Pause 0:00 bleibt 0)", () => {
  const r = scanZuSchichten(planAusMarkdown(PLAN, "Muster, Ben", "2026-10-15").antwort, einstellungen, []);
  assert.deepEqual(r.eintraege.map((e) => [e.datum, e.beginn, e.ende, e.pause, e.status]), [
    ["2026-11-04", "16:00", "18:00", 0, "ok"],
    ["2026-11-06", "16:00", "19:00", 0, "ok"],
    ["2026-11-07", "09:00", "14:01", 30, "ok"],
  ]);
});

test("Automatik: Zeit und Pause in getrennten Spalten werden zusammengefasst", () => {
  const plan = [
    "| Zeitraum | Mo 02.11.26 | | Di 03.11.26 | | Mi 04.11.26 | |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| Muster, Ben | KA 16:00-18:00 | 0:00 | Abwesend | | BK 09:00-14:01 | 0:30 |",
  ].join("\n");
  const { antwort } = planAusMarkdown(plan, "Muster, Ben", "2026-10-15");
  assert.deepEqual(antwort.schichten.map((s) => [s.datum, s.beginn, s.ende, s.pause_min]), [
    ["2026-11-02", "16:00", "18:00", 0],
    ["2026-11-04", "09:00", "14:01", 30],
  ]);
});

test("Automatik: nur der Nachname bei zwei gleichen Nachnamen ist nicht eindeutig", () => {
  const r = planAusMarkdown(PLAN, "Muster", "2026-10-15");
  assert.equal(r.antwort, undefined);
  assert.equal(r.eindeutig, false);
  assert.match(r.grund, /2 Zeilen/);
});

test("Automatik: unbekannter Name und Foto ohne Tabelle werden begründet abgelehnt", () => {
  assert.match(planAusMarkdown(PLAN, "Niemand, Nora", "2026-10-15").grund, /steht nicht in der erkannten Tabelle/);
  assert.match(planAusMarkdown("Nur Text, keine Tabelle", "Muster, Ben", "2026-10-15").grund, /Keine Datumszeile/);
});

test("Automatik: Umlaute, Kürzel ohne Zeit und unbekannter Text", () => {
  const plan = KOPF + "\n| --- |\n| Müller, Jörg | F | Berufsschule | | | | | |";
  const { antwort } = planAusMarkdown(plan, "Muller, Jorg", "2026-10-15");
  assert.deepEqual(antwort.schichten.map((s) => [s.datum, s.kuerzel, s.beginn, s.roh]), [
    ["2026-11-02", "F", "", "F"],
    ["2026-11-03", "", "", "Berufsschule"],
  ]);
  const r = scanZuSchichten(antwort, einstellungen, []);
  assert.deepEqual(r.eintraege.map((e) => [e.beginn, e.status]), [["06:00", "ok"], ["", "unklar"]]);
});

test("Automatik: Datum ohne Jahr bekommt das Jahr, das am nächsten an heute liegt", () => {
  const plan = "| Name | Mo 28.12. | Di 29.12. | Fr 01.01. |\n| --- |\n| Muster, Ben | 08:00-12:00 | 08:00-12:00 | 08:00-12:00 |";
  const { antwort } = planAusMarkdown(plan, "Muster, Ben", "2026-12-20");
  assert.deepEqual(antwort.schichten.map((s) => s.datum), ["2026-12-28", "2026-12-29", "2027-01-01"]);
});
