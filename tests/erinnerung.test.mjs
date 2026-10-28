// G16: Erinnerungszeitpunkte. Läuft mit TZ=Europe/Berlin (gesetzt in tests/gate.mjs).
// Am 25.10.2026 endet die Sommerzeit: davor UTC+2, danach UTC+1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { erinnerungen, leereDaten } from "../src/logic.js";

const jetzt = new Date(2026, 9, 20, 12, 0); // Di 20.10.2026, 12:00 Uhr
const schicht = (id, datum, beginn, ende, notiz = "") => ({ id, datum, beginn, ende, pause: 0, lohn: 1390, notiz });

function beispiel() {
  const d = leereDaten();
  d.schichten = [
    schicht("a", "2026-10-24", "09:00", "14:01", "Kasse"), // Sommerzeit
    schicht("b", "2026-10-26", "09:00", "14:01"), // Winterzeit
    schicht("c", "2026-10-20", "12:30", "16:00"), // Erinnerung wäre 11:30, also schon vorbei
    schicht("d", "2026-10-21", "00:30", "06:00"), // Erinnerung am Vorabend
  ];
  d.todos = [
    { id: "t1", text: "Login reparieren", projekt: "Trad tracker", faellig: "2026-10-22", erledigt: false },
    { id: "t2", text: "Erledigtes", projekt: "", faellig: "2026-10-23", erledigt: true },
    { id: "t3", text: "Ohne Datum", projekt: "", faellig: "", erledigt: false },
    { id: "t4", text: "Heute fällig", projekt: "", faellig: "2026-10-20", erledigt: false }, // 8:00 ist vorbei
  ];
  d.abos = [
    { id: "n", name: "Streaming", betrag: 999, tag: 20, rhythmus: 1, abMonat: "2026-01", bisMonat: "" },
    { id: "v", name: "Versicherung", betrag: 12000, tag: 1, rhythmus: 12, abMonat: "2026-11", bisMonat: "" },
  ];
  return d;
}

const nach = (liste, praefix) => liste.filter((e) => e.id.startsWith(praefix)).map((e) => [e.id, e.zeit]);

test("Schicht: eine Stunde vorher, richtig über die Zeitumstellung, Vergangenes fällt weg", () => {
  assert.deepEqual(nach(erinnerungen(beispiel(), jetzt), "s:"), [
    ["s:d:2026-10-21:00:30", "2026-10-20T21:30:00.000Z"], // 23:30 Sommerzeit am Vorabend
    ["s:a:2026-10-24:09:00", "2026-10-24T06:00:00.000Z"], // 08:00 Sommerzeit
    ["s:b:2026-10-26:09:00", "2026-10-26T07:00:00.000Z"], // 08:00 Winterzeit
  ]);
});

test("To-do: 8:00 Uhr am Fälligkeitstag, nur offene mit Datum in der Zukunft", () => {
  assert.deepEqual(nach(erinnerungen(beispiel(), jetzt), "t:"), [["t:t1:2026-10-22:08:00", "2026-10-22T06:00:00.000Z"]]);
});

test("Abo: am Vortag 18:00, kurze Monate gekürzt, nichts nach dem Zeitfenster", () => {
  // 60 Tage ab 20.10. 12:00 enden am 19.12. 12:00 – die Erinnerung am 19.12. um 18:00 liegt schon dahinter.
  assert.deepEqual(nach(erinnerungen(beispiel(), jetzt), "a:"), [
    ["a:v:2026-11-01", "2026-10-31T17:00:00.000Z"],
    ["a:n:2026-11-20", "2026-11-19T17:00:00.000Z"],
  ]);
});

test("Texte sind kurz und verständlich, Liste ist nach Zeit sortiert", () => {
  const liste = erinnerungen(beispiel(), jetzt);
  const zeiten = liste.map((e) => e.zeit);
  assert.deepEqual(zeiten, [...zeiten].sort());
  const finde = (id) => liste.find((e) => e.id === id);
  assert.deepEqual([finde("s:a:2026-10-24:09:00").titel, finde("s:a:2026-10-24:09:00").text], ["Schicht in 1 Stunde", "09:00–14:01 · Kasse"]);
  assert.deepEqual([finde("t:t1:2026-10-22:08:00").titel, finde("t:t1:2026-10-22:08:00").text], ["To-do fällig heute", "Login reparieren · Trad tracker"]);
  assert.equal(finde("a:n:2026-11-20").titel, "Abbuchung morgen");
  assert.match(finde("a:n:2026-11-20").text, /^Streaming · 9,99\s€$/);
});

test("Verschobene Schicht bekommt eine neue id, damit der Server neu erinnert", () => {
  const d = beispiel();
  const vorher = erinnerungen(d, jetzt).map((e) => e.id);
  d.schichten[0].beginn = "10:00";
  const nachher = erinnerungen(d, jetzt).map((e) => e.id);
  assert.ok(vorher.includes("s:a:2026-10-24:09:00") && !nachher.includes("s:a:2026-10-24:09:00"));
  assert.ok(nachher.includes("s:a:2026-10-24:10:00"));
});

test("Kontrolle: die Tests laufen wirklich in deutscher Zeit", () => {
  assert.equal(new Date(2026, 9, 24, 8, 0).toISOString(), "2026-10-24T06:00:00.000Z");
  assert.equal(new Date(2026, 9, 26, 8, 0).toISOString(), "2026-10-26T07:00:00.000Z");
});

test("To-do mit Uhrzeit: Erinnerung genau dann, mit Uhrzeit im Titel", () => {
  const d = beispiel();
  d.todos[0].uhrzeit = "15:30";
  const [e] = erinnerungen(d, jetzt).filter((x) => x.id.startsWith("t:"));
  assert.deepEqual([e.id, e.zeit, e.titel], ["t:t1:2026-10-22:15:30", "2026-10-22T13:30:00.000Z", "To-do um 15:30"]);
});

test("Schicht am Vorabend um 20:00, auch über die Zeitumstellung und bei Beginn nach Mitternacht", () => {
  assert.deepEqual(nach(erinnerungen(beispiel(), jetzt), "sa:"), [
    ["sa:d:2026-10-21:00:30", "2026-10-20T18:00:00.000Z"], // 20:00 Sommerzeit, eine Stunde vor ist dann 23:30
    ["sa:a:2026-10-24:09:00", "2026-10-23T18:00:00.000Z"], // 20:00 Sommerzeit
    ["sa:b:2026-10-26:09:00", "2026-10-25T19:00:00.000Z"], // 20:00 Winterzeit
  ]);
  const e = erinnerungen(beispiel(), jetzt).find((x) => x.id === "sa:a:2026-10-24:09:00");
  assert.deepEqual([e.titel, e.text], ["Morgen Schicht", "09:00–14:01 · Kasse"]);
});

test("Nach dem geplanten Ende: Frage „warst du da?“, nur für noch nicht abgehakte Schichten", () => {
  const d = beispiel();
  d.schichten[0].status = "geplant"; // a: endet 24.10. 14:01
  d.schichten[1].status = "da"; // b: schon abgehakt, keine Frage
  d.schichten[2].status = "geplant"; // c: endet heute 16:00
  d.schichten.push({ ...schicht("e", "2026-10-24", "22:00", "06:00"), status: "geplant" }); // endet nach der Umstellung
  assert.deepEqual(nach(erinnerungen(d, jetzt), "se:"), [
    ["se:c:2026-10-20:16:00", "2026-10-20T14:00:00.000Z"],
    ["se:a:2026-10-24:14:01", "2026-10-24T12:01:00.000Z"],
    ["se:e:2026-10-24:06:00", "2026-10-25T05:00:00.000Z"], // 06:00 Winterzeit am nächsten Morgen
  ]);
  const e = erinnerungen(d, jetzt).find((x) => x.id === "se:a:2026-10-24:14:01");
  assert.deepEqual([e.titel, e.text], ["Schicht vorbei – warst du da?", "09:00–14:01 · Tippe zum Abhaken"]);
});

test("To-do zusätzlich am Vorabend um 20:00, mit Uhrzeit im Titel, wenn eine eingetragen ist", () => {
  const d = beispiel();
  assert.deepEqual(nach(erinnerungen(d, jetzt), "ta:"), [["ta:t1:2026-10-22", "2026-10-21T18:00:00.000Z"]]);
  const ohne = erinnerungen(d, jetzt).find((x) => x.id.startsWith("ta:"));
  assert.deepEqual([ohne.titel, ohne.text], ["To-do morgen", "Login reparieren · Trad tracker"]);
  d.todos[0].uhrzeit = "15:30";
  assert.equal(erinnerungen(d, jetzt).find((x) => x.id.startsWith("ta:")).titel, "To-do morgen um 15:30");
  assert.equal(nach(erinnerungen(d, jetzt), "t:").length, 1); // die Erinnerung am Tag selbst bleibt
});
