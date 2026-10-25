// G20: To-do-Logik. Erwartete Daten von Hand gerechnet (25.10.2026 ist ein Sonntag).
import { test } from "node:test";
import assert from "node:assert/strict";
import { todoMitStandard, naechsterTermin, todoAbhaken, verschiebeZiel, todosFiltern, todosSortieren, todosSuchen, projektFortschritt, projektUmbenennen, wochentag, importiere, mitStandardwerten } from "../src/logic.js";

const todo = (felder) => todoMitStandard({ id: felder.text ?? "x", text: "x", projekt: "", faellig: "", erledigt: false, ...felder });

test("Wochentag: Montag ist 0, Sonntag 6", () => {
  assert.equal(wochentag("2026-10-26"), 0);
  assert.equal(wochentag("2026-10-25"), 6);
});

test("Verschieben: morgen und Montag der nächsten Woche, egal an welchem Tag", () => {
  assert.equal(verschiebeZiel("morgen", "2026-10-25"), "2026-10-26");
  assert.equal(verschiebeZiel("naechsteWoche", "2026-10-25"), "2026-10-26"); // Sonntag → Montag
  assert.equal(verschiebeZiel("naechsteWoche", "2026-10-26"), "2026-11-02"); // Montag → Montag danach
  assert.equal(verschiebeZiel("naechsteWoche", "2026-10-28"), "2026-11-02"); // Mittwoch
  assert.equal(verschiebeZiel("naechsteWoche", "2026-12-30"), "2027-01-04"); // über den Jahreswechsel
});

test("Wiederholung täglich: überfällig springt auf morgen, früh erledigt auf den Tag danach", () => {
  assert.equal(naechsterTermin(todo({ wiederholung: "taeglich", faellig: "2026-10-22" }), "2026-10-25"), "2026-10-26");
  assert.equal(naechsterTermin(todo({ wiederholung: "taeglich", faellig: "2026-10-28" }), "2026-10-25"), "2026-10-29");
  assert.equal(naechsterTermin(todo({ wiederholung: "taeglich", faellig: "" }), "2026-10-25"), "2026-10-26"); // ohne Datum ab heute
});

test("Wiederholung wöchentlich bleibt auf dem Wochentag", () => {
  assert.equal(naechsterTermin(todo({ wiederholung: "woechentlich", faellig: "2026-10-14" }), "2026-10-25"), "2026-10-28"); // Mi → Mi
  assert.equal(naechsterTermin(todo({ wiederholung: "woechentlich", faellig: "2026-10-25" }), "2026-10-25"), "2026-11-01");
});

test("Wiederholung monatlich am 31.: kurzer Monat letzter Tag, danach wieder der 31.", () => {
  assert.equal(naechsterTermin(todo({ wiederholung: "monatlich", faellig: "2026-01-31", ankerTag: 31 }), "2026-01-31"), "2026-02-28");
  assert.equal(naechsterTermin(todo({ wiederholung: "monatlich", faellig: "2026-02-28", ankerTag: 31 }), "2026-02-28"), "2026-03-31");
  assert.equal(naechsterTermin(todo({ wiederholung: "monatlich", faellig: "2026-10-15" }), "2026-10-25"), "2026-11-15");
  assert.equal(naechsterTermin(todo({ wiederholung: "", faellig: "2026-10-15" }), "2026-10-25"), null);
});

test("Abhaken: Wiederholtes springt weiter und setzt Unteraufgaben zurück, Einmaliges wird erledigt und wieder offen", () => {
  const w = todo({ wiederholung: "woechentlich", faellig: "2026-10-21", unteraufgaben: [{ id: "u1", text: "A", erledigt: true }] });
  const weiter = todoAbhaken(w, "2026-10-25");
  assert.deepEqual([weiter.erledigt, weiter.faellig, weiter.unteraufgaben[0].erledigt], [false, "2026-10-28", false]);
  const e = todo({ faellig: "2026-10-21" });
  assert.equal(todoAbhaken(e, "2026-10-25").erledigt, true);
  assert.equal(todoAbhaken(todoAbhaken(e, "2026-10-25"), "2026-10-25").erledigt, false);
});

test("Ansichten: Heute mit Überfälligem, Woche bis Sonntag, Überfällig, Alle offenen", () => {
  const liste = [
    todo({ text: "a", faellig: "2026-10-20" }),
    todo({ text: "b", faellig: "2026-10-21" }),
    todo({ text: "c", faellig: "2026-10-25" }),
    todo({ text: "d", faellig: "2026-10-26" }),
    todo({ text: "e" }),
    todo({ text: "f", faellig: "2026-10-21", erledigt: true }),
  ];
  const namen = (ansicht, heute) => todosFiltern(liste, ansicht, heute).map((t) => t.text).join("");
  assert.equal(namen("heute", "2026-10-21"), "ab");
  assert.equal(namen("woche", "2026-10-21"), "abc"); // Woche Mo 19.10. bis So 25.10.
  assert.equal(namen("ueberfaellig", "2026-10-21"), "a");
  assert.equal(namen("alle", "2026-10-21"), "abcde");
});

test("Sortierung: hohe Priorität zuerst, dann Termin samt Uhrzeit, ohne Termin zuletzt, sonst Reihenfolge", () => {
  const liste = [
    todo({ text: "ohne" }),
    todo({ text: "spaet", faellig: "2026-10-26", uhrzeit: "15:00" }),
    todo({ text: "frueh", faellig: "2026-10-26", uhrzeit: "09:00" }),
    todo({ text: "ganztags", faellig: "2026-10-26" }),
    todo({ text: "wichtig", prioritaet: 2 }),
    todo({ text: "nebenbei", prioritaet: 0, faellig: "2026-10-01" }),
    todo({ text: "ohne2" }),
  ];
  assert.deepEqual(todosSortieren(liste).map((t) => t.text), ["wichtig", "frueh", "spaet", "ganztags", "ohne", "ohne2", "nebenbei"]);
});

test("Suche: Groß-/Kleinschreibung und Umlaute egal, sucht in Notiz, Projekt und Unteraufgaben, alle Wörter müssen passen", () => {
  const liste = [
    todo({ text: "Lösung für Login", projekt: "Trad tracker" }),
    todo({ text: "Einkauf", notiz: "Milch und Brot" }),
    todo({ text: "Release", unteraufgaben: [{ id: "u", text: "Changelog schreiben", erledigt: false }] }),
  ];
  const finde = (s) => todosSuchen(liste, s).map((t) => t.text);
  assert.deepEqual(finde("LÖSUNG"), ["Lösung für Login"]);
  assert.deepEqual(finde("losung"), ["Lösung für Login"]);
  assert.deepEqual(finde("trad login"), ["Lösung für Login"]);
  assert.deepEqual(finde("brot"), ["Einkauf"]);
  assert.deepEqual(finde("changelog"), ["Release"]);
  assert.deepEqual(finde("brot login"), []);
  assert.equal(todosSuchen(liste, "  ").length, 3);
});

test("Projekte: Fortschritt zählt erledigte, Umbenennen ändert nur dieses Projekt", () => {
  const liste = [todo({ projekt: "MD+", erledigt: true }), todo({ projekt: "MD+" }), todo({ projekt: "MD+", erledigt: true }), todo({ projekt: "Andere" })];
  assert.deepEqual(projektFortschritt(liste, "MD+"), { erledigt: 2, gesamt: 3 });
  const neu = projektUmbenennen(liste, "MD+", " MD Plus ");
  assert.deepEqual(neu.map((t) => t.projekt), ["MD Plus", "MD Plus", "MD Plus", "Andere"]);
});

test("Alte Daten und Sicherungen ohne die neuen To-do-Felder laden weiter", () => {
  const altesTodo = { id: "t1", text: "Alt", projekt: "", faellig: "2026-10-30", erledigt: false };
  const geladen = mitStandardwerten({ version: 1, einstellungen: {}, schichten: [], abos: [], ausgaben: [], kontostand: null, todos: [altesTodo] });
  assert.deepEqual(geladen.todos[0], { ...altesTodo, notiz: "", uhrzeit: "", prioritaet: 1, unteraufgaben: [], wiederholung: "", ankerTag: 0 });
  const sicherung = JSON.stringify({ version: 1, einstellungen: { stundenlohn: 0, standardPause: 30, zahltag: 15, zahlungImFolgemonat: true, name: "", kuerzel: [] }, schichten: [], abos: [], ausgaben: [], kontostand: null, todos: [altesTodo] });
  assert.equal(importiere(sicherung).todos[0].prioritaet, 1);
});

test("Kontrolle: kaputte neue Felder werden beim Import abgelehnt", () => {
  const mit = (felder) => JSON.stringify({ version: 1, einstellungen: { stundenlohn: 0, standardPause: 30, zahltag: 15, zahlungImFolgemonat: true, name: "", kuerzel: [] }, schichten: [], abos: [], ausgaben: [], kontostand: null, todos: [{ id: "t", text: "T", projekt: "", faellig: "", erledigt: false, ...felder }] });
  assert.throws(() => importiere(mit({ prioritaet: 5 })), /To-do/);
  assert.throws(() => importiere(mit({ wiederholung: "constructor" })), /To-do/);
  assert.throws(() => importiere(mit({ uhrzeit: "25:00" })), /To-do/);
  assert.throws(() => importiere(mit({ unteraufgaben: [{ id: 1, text: "A", erledigt: false }] })), /Unteraufgaben/);
});
