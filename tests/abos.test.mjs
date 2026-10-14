// G2: Abo-Abbuchungen fallen auf die richtigen Tage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aboTermin, aboProMonat } from "../src/logic.js";

const abo = (felder) => ({ id: "a", name: "Abo", betrag: 999, tag: 1, rhythmus: 1, abMonat: "2026-01", bisMonat: "", ...felder });

test("Abbuchung am 31. fällt in kurzen Monaten auf den letzten Tag", () => {
  const a = abo({ tag: 31 });
  assert.equal(aboTermin(a, "2026-01"), "2026-01-31");
  assert.equal(aboTermin(a, "2026-02"), "2026-02-28");
  assert.equal(aboTermin(a, "2026-04"), "2026-04-30");
  assert.equal(aboTermin(a, "2028-02"), "2028-02-29");
});

test("vierteljährlich zählt ab dem ersten Abbuchungsmonat", () => {
  const a = abo({ tag: 15, rhythmus: 3 });
  assert.equal(aboTermin(a, "2026-04"), "2026-04-15");
  assert.equal(aboTermin(a, "2026-05"), null);
  assert.equal(aboTermin(a, "2026-06"), null);
  assert.equal(aboTermin(a, "2027-01"), "2027-01-15");
});

test("jährlich nur im Startmonat jedes Jahres", () => {
  const a = abo({ rhythmus: 12, abMonat: "2026-03" });
  assert.equal(aboTermin(a, "2026-03"), "2026-03-01");
  assert.equal(aboTermin(a, "2026-09"), null);
  assert.equal(aboTermin(a, "2027-03"), "2027-03-01");
});

test("vor dem Start und nach dem Ende keine Abbuchung", () => {
  const a = abo({ abMonat: "2026-11", bisMonat: "2026-12" });
  assert.equal(aboTermin(a, "2026-10"), null);
  assert.equal(aboTermin(a, "2026-11"), "2026-11-01");
  assert.equal(aboTermin(a, "2026-12"), "2026-12-01");
  assert.equal(aboTermin(a, "2027-01"), null);
});

test("Kosten pro Monat rechnen seltene Abos anteilig um", () => {
  // 9,99 € monatlich + 120,00 € jährlich (= 10,00 € im Monat)
  assert.equal(aboProMonat([abo({}), abo({ betrag: 12000, rhythmus: 12 })]), 1999);
});
