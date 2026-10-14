// G1: Arbeitsstunden und Lohn. Erwartete Werte von Hand gerechnet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arbeitsMinuten, schichtLohn, monatsLohn, formatStunden, euroZuCent, zahltag } from "../src/logic.js";

const schicht = (datum, beginn, ende, pause, lohn) => ({ id: datum + beginn, datum, beginn, ende, pause, lohn, notiz: "" });

test("8:00 bis 16:30 mit 30 min Pause bei 14,00 €/h ergibt 8 h und 112,00 €", () => {
  const s = schicht("2026-10-14", "08:00", "16:30", 30, 1400);
  assert.equal(arbeitsMinuten(s), 480);
  assert.equal(schichtLohn(s), 11200);
});

test("Nachtschicht 22:00 bis 06:00 zählt 8 h", () => {
  const s = schicht("2026-10-31", "22:00", "06:00", 0, 1390);
  assert.equal(arbeitsMinuten(s), 480);
  assert.equal(schichtLohn(s), 11120);
});

test("Nachtschicht 22:00 bis 06:30 mit 30 min Pause zählt 8 h", () => {
  assert.equal(arbeitsMinuten(schicht("2026-10-01", "22:00", "06:30", 30, 1390)), 480);
});

test("krumme Zeit wird auf den Cent gerundet: 9:15 bis 13:40 bei 13,90 €/h", () => {
  // 265 min * 13,90 €/60 = 61,3916… € -> 61,39 €
  assert.equal(schichtLohn(schicht("2026-10-02", "09:15", "13:40", 0, 1390)), 6139);
});

test("Pause länger als die Schicht ergibt 0 statt negativer Zeit", () => {
  assert.equal(arbeitsMinuten(schicht("2026-10-03", "10:00", "10:20", 30, 1400)), 0);
});

test("Monatssumme zählt nur Schichten, die im Monat beginnen", () => {
  const liste = [
    schicht("2026-10-01", "08:00", "16:30", 30, 1400),
    schicht("2026-10-31", "22:00", "06:00", 0, 1390),
    schicht("2026-11-01", "08:00", "12:00", 0, 1400),
  ];
  assert.deepEqual(monatsLohn(liste, "2026-10"), { minuten: 960, lohn: 22320, anzahl: 2 });
  assert.deepEqual(monatsLohn(liste, "2026-09"), { minuten: 0, lohn: 0, anzahl: 0 });
});

test("Stunden werden deutsch formatiert", () => {
  assert.equal(formatStunden(960), "16 h");
  assert.equal(formatStunden(465), "7,75 h");
});

test("Euro-Eingaben werden in Cent umgerechnet", () => {
  assert.equal(euroZuCent("13,90"), 1390);
  assert.equal(euroZuCent("1.234,56 €"), 123456);
  assert.equal(euroZuCent("12.5"), 1250);
  assert.equal(euroZuCent("-20"), -2000);
  assert.equal(euroZuCent("0,29"), 29);
  assert.equal(euroZuCent("1.234"), null);
  assert.equal(euroZuCent("abc"), null);
  assert.equal(euroZuCent(""), null);
});

test("Zahltag im Folgemonat oder im selben Monat, auf Monatsende gekürzt", () => {
  assert.equal(zahltag("2026-10", { zahltag: 15, zahlungImFolgemonat: true }), "2026-11-15");
  assert.equal(zahltag("2026-12", { zahltag: 15, zahlungImFolgemonat: true }), "2027-01-15");
  assert.equal(zahltag("2026-01", { zahltag: 31, zahlungImFolgemonat: true }), "2026-02-28");
  assert.equal(zahltag("2026-04", { zahltag: 31, zahlungImFolgemonat: false }), "2026-04-30");
});
