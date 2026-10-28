// G23: Schicht nach dem Ende abhaken. Läuft mit TZ=Europe/Berlin (gesetzt in tests/gate.mjs).
// Lohn von Hand: 09:00–14:01 mit 30 min Pause = 4 h 31 min = 271 min × 13,90 €/h = 62,78 €.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schichtMitStandard, schichtEnde, neuerStatus, zuBestaetigen, frueherRaus, arbeitsMinuten, schichtLohn, monatsLohn, mitStandardwerten, importiere, exportiere, leereDaten } from "../src/logic.js";

const schicht = (felder) => ({ id: "a", datum: "2026-11-07", beginn: "09:00", ende: "14:01", pause: 30, lohn: 1390, notiz: "", status: "geplant", ...felder });

test("Schichten ohne Status (von vor dem Update): vergangene gelten als da, kommende werden abgefragt", () => {
  const jetzt = new Date(2026, 9, 28, 12, 0);
  const alt = { id: "a", datum: "2026-10-01", beginn: "09:00", ende: "14:01", pause: 30, lohn: 1390, notiz: "" };
  const kommend = { ...alt, id: "b", datum: "2026-11-07" };
  assert.equal(schichtMitStandard(alt, jetzt).status, "da");
  assert.equal(schichtMitStandard(kommend, jetzt).status, "geplant");
  assert.equal(schichtMitStandard({ ...alt, status: "nichtDa" }, jetzt).status, "nichtDa"); // vorhandener Status bleibt
  assert.deepEqual(mitStandardwerten({ ...leereDaten(), schichten: [alt, kommend] }, jetzt).schichten.map((s) => s.status), ["da", "geplant"]);
  const sicherung = exportiere({ ...leereDaten(), schichten: [alt, kommend] });
  assert.deepEqual(importiere(sicherung, { jetzt }).schichten.map((s) => s.status), ["da", "geplant"]);
});

test("Ende einer Schicht: am selben Tag, Nachtschicht am nächsten Morgen", () => {
  assert.equal(schichtEnde(schicht()).getTime(), new Date(2026, 10, 7, 14, 1).getTime());
  assert.equal(schichtEnde(schicht({ datum: "2026-10-24", beginn: "22:00", ende: "06:00" })).getTime(), new Date(2026, 9, 25, 6, 0).getTime());
});

test("Neue Schicht: geplant, wenn sie noch nicht vorbei ist, sonst direkt da (nachträglich eingetragen)", () => {
  assert.equal(neuerStatus(schicht(), new Date(2026, 10, 7, 14, 0)), "geplant");
  assert.equal(neuerStatus(schicht(), new Date(2026, 10, 7, 14, 1)), "da");
});

test("Abhaken-Liste: nur geplante Schichten, deren Ende erreicht ist, nach Datum sortiert", () => {
  const liste = [
    schicht({ id: "spaeter", datum: "2026-11-08" }),
    schicht({ id: "heute" }),
    schicht({ id: "gestern", datum: "2026-11-06" }),
    schicht({ id: "bestaetigt", datum: "2026-11-05", status: "da" }),
    schicht({ id: "weg", datum: "2026-11-04", status: "nichtDa" }),
  ];
  assert.deepEqual(zuBestaetigen(liste, new Date(2026, 10, 7, 14, 0)).map((s) => s.id), ["gestern"]);
  assert.deepEqual(zuBestaetigen(liste, new Date(2026, 10, 7, 14, 1)).map((s) => s.id), ["gestern", "heute"]);
});

test("Früher raus: neues Ende, abgehakt, Lohn neu gerechnet", () => {
  const s = frueherRaus(schicht(), "12:30");
  assert.deepEqual([s.ende, s.status, s.pause], ["12:30", "da", 30]);
  assert.equal(arbeitsMinuten(s), 180);
  assert.equal(schichtLohn(s), 4170); // 3 h × 13,90 €
  assert.equal(schichtLohn(schicht()), 6278);
});

test("Früher raus: nur zwischen Beginn und geplantem Ende, auch über Mitternacht", () => {
  for (const zeit of ["14:01", "14:30", "09:00", "08:00", "", "25:00"]) assert.equal(frueherRaus(schicht(), zeit), null, zeit);
  const nacht = schicht({ datum: "2026-10-24", beginn: "22:00", ende: "06:00" });
  assert.equal(frueherRaus(nacht, "03:00").ende, "03:00");
  assert.equal(frueherRaus(nacht, "23:15").ende, "23:15");
  for (const zeit of ["06:00", "07:00", "21:00", "22:00"]) assert.equal(frueherRaus(nacht, zeit), null, zeit);
});

test("Nicht da: 0 Minuten, 0 €, zählt nicht als Schicht im Monat", () => {
  const weg = schicht({ status: "nichtDa" });
  assert.equal(arbeitsMinuten(weg), 0);
  assert.equal(schichtLohn(weg), 0);
  assert.deepEqual(monatsLohn([weg, schicht({ id: "b", datum: "2026-11-08" })], "2026-11"), { minuten: 271, lohn: 6278, anzahl: 1 });
});

test("Kontrolle: unbekannter Status wird beim Import abgelehnt", () => {
  const sicherung = exportiere({ ...leereDaten(), schichten: [schicht({ status: "vielleicht" })] });
  assert.throws(() => importiere(sicherung), /Schicht/);
  assert.equal(importiere(exportiere({ ...leereDaten(), schichten: [schicht()] })).schichten[0].status, "geplant");
});
