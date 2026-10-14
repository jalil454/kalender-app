// G5: Kalender-Export für Apple Kalender.
import { test } from "node:test";
import assert from "node:assert/strict";
import { icsExport } from "../src/logic.js";

const schicht = (id, datum, beginn, ende, notiz = "") => ({ id, datum, beginn, ende, pause: 0, lohn: 1400, notiz });
const jetzt = new Date(Date.UTC(2026, 9, 14, 12, 0, 0));

function termine(ics) {
  return ics.split("BEGIN:VEVENT").slice(1).map((block) => block.split("END:VEVENT")[0]);
}

test("jede Schicht wird ein Termin mit Beginn und Ende", () => {
  const ics = icsExport([schicht("b", "2026-10-15", "09:00", "13:00"), schicht("a", "2026-10-14", "08:00", "16:30")], jetzt);
  const liste = termine(ics);
  assert.equal(liste.length, 2);
  assert.match(liste[0], /DTSTART:20261014T080000\r\n/);
  assert.match(liste[0], /DTEND:20261014T163000\r\n/);
  assert.match(liste[0], /UID:a@kalender-app\r\n/);
  assert.match(liste[0], /DTSTAMP:20261014T120000Z\r\n/);
  assert.match(liste[1], /DTSTART:20261015T090000\r\n/);
});

test("Nachtschicht endet am nächsten Tag, auch über den Jahreswechsel", () => {
  const liste = termine(icsExport([schicht("n1", "2026-10-31", "22:00", "06:00"), schicht("n2", "2026-12-31", "22:00", "06:00")], jetzt));
  assert.match(liste[0], /DTEND:20261101T060000\r\n/);
  assert.match(liste[1], /DTEND:20270101T060000\r\n/);
});

test("Datei hat Rahmen, CRLF-Zeilenenden und maskierte Sonderzeichen", () => {
  const ics = icsExport([schicht("c", "2026-10-14", "08:00", "12:00", "Kasse, Lager; Inventur")], jetzt);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
  assert.match(ics, /SUMMARY:Arbeit · Kasse\\, Lager\\; Inventur\r\n/);
});

test("lange Zeilen werden nach höchstens 75 Byte umgebrochen", () => {
  const ics = icsExport([schicht("d", "2026-10-14", "08:00", "12:00", "Übergabe ".repeat(20))], jetzt);
  for (const zeile of ics.split("\r\n")) assert.ok(new TextEncoder().encode(zeile).length <= 75, zeile);
  const entfaltet = ics.replace(/\r\n /g, "");
  assert.ok(entfaltet.includes(`SUMMARY:Arbeit · ${"Übergabe ".repeat(20)}`));
});
