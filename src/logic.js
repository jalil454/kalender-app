// Rechenlogik der Kalender-App: Zeiten, Lohn, Abos, Prognose, Export.
// Kein DOM und kein Speicher, damit App und Tests dieselben Funktionen nutzen.
// Geld ist immer in ganzen Cent, ein Datum immer Text "JJJJ-MM-TT", ein Monat "JJJJ-MM".

export const VERSION = 1;

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const pad = (n) => String(n).padStart(2, "0");

// ---------- Datum und Zeit ----------

export function isoVon(datum) {
  return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

export function tageImMonat(jahr, monat) {
  return new Date(jahr, monat, 0).getDate();
}

export function istDatum(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!m) return false;
  const [jahr, monat, tag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return monat >= 1 && monat <= 12 && tag >= 1 && tag <= tageImMonat(jahr, monat);
}

export const istZeit = (text) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text ?? "");
export const istMonat = (text) => /^\d{4}-(0[1-9]|1[0-2])$/.test(text ?? "");
export const monatVon = (datum) => datum.slice(0, 7);

export function monatPlus(monat, n) {
  const [jahr, m] = monat.split("-").map(Number);
  const index = jahr * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function monateZwischen(von, bis) {
  const [vj, vm] = von.split("-").map(Number);
  const [bj, bm] = bis.split("-").map(Number);
  return bj * 12 + bm - (vj * 12 + vm);
}

// Tag im Monat, gekürzt auf den letzten Tag (31. im Februar wird 28. bzw. 29.)
export function tagImMonat(monat, tag) {
  const [jahr, m] = monat.split("-").map(Number);
  return `${monat}-${pad(Math.min(tag, tageImMonat(jahr, m)))}`;
}

export function datumPlusTage(datum, n) {
  const [jahr, monat, tag] = datum.split("-").map(Number);
  return isoVon(new Date(jahr, monat - 1, tag + n));
}

export function monatsName(monat) {
  return MONATE[Number(monat.slice(5, 7)) - 1];
}

const minuten = (zeit) => {
  const [h, m] = zeit.split(":").map(Number);
  return h * 60 + m;
};

// ---------- Arbeitszeit und Lohn ----------

export function arbeitsMinuten({ beginn, ende, pause = 0 }) {
  let dauer = minuten(ende) - minuten(beginn);
  if (dauer <= 0) dauer += 24 * 60; // Ende liegt am nächsten Tag (Nachtschicht)
  return Math.max(0, dauer - pause);
}

export function schichtLohn(schicht) {
  return Math.round((arbeitsMinuten(schicht) * schicht.lohn) / 60);
}

// Eine Schicht zählt zu dem Monat, in dem sie beginnt.
export function monatsLohn(schichten, monat) {
  let summeMinuten = 0;
  let lohn = 0;
  let anzahl = 0;
  for (const s of schichten) {
    if (monatVon(s.datum) !== monat) continue;
    summeMinuten += arbeitsMinuten(s);
    lohn += schichtLohn(s);
    anzahl++;
  }
  return { minuten: summeMinuten, lohn, anzahl };
}

export function zahltag(arbeitsMonat, einstellungen) {
  const monat = einstellungen.zahlungImFolgemonat ? monatPlus(arbeitsMonat, 1) : arbeitsMonat;
  return tagImMonat(monat, einstellungen.zahltag);
}

// ---------- Abos und Prognose ----------

export function aboTermin(abo, monat) {
  if (monat < abo.abMonat) return null;
  if (abo.bisMonat && monat > abo.bisMonat) return null;
  if (monateZwischen(abo.abMonat, monat) % abo.rhythmus !== 0) return null;
  return tagImMonat(monat, abo.tag);
}

export function aboProMonat(abos) {
  return abos.reduce((summe, abo) => summe + abo.betrag / abo.rhythmus, 0);
}

// Alle Buchungen mit von < Datum <= bis, nach Datum sortiert (Einnahmen eines Tages zuerst).
export function buchungen(daten, von, bis) {
  const liste = [];
  const imZeitraum = (datum) => datum > von && datum <= bis;
  const letzterMonat = monatVon(bis);

  for (let monat = monatVon(von); monat <= letzterMonat; monat = monatPlus(monat, 1)) {
    for (const abo of daten.abos) {
      const datum = aboTermin(abo, monat);
      if (datum && imZeitraum(datum)) liste.push({ datum, text: abo.name, betrag: -abo.betrag, art: "abo" });
    }
  }
  // Der Zahltag liegt im Arbeitsmonat oder im Monat danach.
  for (let monat = monatPlus(monatVon(von), -1); monat <= letzterMonat; monat = monatPlus(monat, 1)) {
    const datum = zahltag(monat, daten.einstellungen);
    if (!imZeitraum(datum)) continue;
    const { lohn } = monatsLohn(daten.schichten, monat);
    if (lohn > 0) liste.push({ datum, text: `Lohn ${monatsName(monat)}`, betrag: lohn, art: "lohn" });
  }
  for (const a of daten.ausgaben) {
    if (imZeitraum(a.datum)) liste.push({ datum: a.datum, text: a.name, betrag: -a.betrag, art: "ausgabe" });
  }
  return liste.sort((a, b) => a.datum.localeCompare(b.datum) || b.betrag - a.betrag);
}

// Der eingetragene Kontostand gilt nach allen Buchungen seines Tages.
export function prognose(daten, bis) {
  const k = daten.kontostand;
  if (!k || bis < k.datum) return null;
  const liste = buchungen(daten, k.datum, bis);
  let stand = k.betrag;
  for (const b of liste) {
    stand += b.betrag;
    b.danach = stand;
  }
  return { start: k.betrag, von: k.datum, bis, buchungen: liste, ende: stand };
}

// ---------- Erinnerungen für Push-Nachrichten ----------

// Ortszeit dieses Geräts als Date (für den Server wird daraus UTC).
function ortszeit(datum, zeit) {
  const [j, m, t] = datum.split("-").map(Number);
  const [h, mi] = zeit.split(":").map(Number);
  return new Date(j, m - 1, t, h, mi);
}

// Alle Erinnerungen der nächsten Tage. Die id ändert sich, wenn sich Datum oder Uhrzeit ändern,
// damit der Server eine verschobene Schicht neu erinnert.
export function erinnerungen(daten, jetzt, tage = 60) {
  const bis = new Date(jetzt.getTime() + tage * 864e5);
  const liste = [];
  const neu = (id, zeitpunkt, titel, inhalt) => {
    if (zeitpunkt > jetzt && zeitpunkt <= bis) liste.push({ id, zeit: zeitpunkt.toISOString(), titel, text: inhalt });
  };
  for (const s of daten.schichten) {
    const vorher = new Date(ortszeit(s.datum, s.beginn).getTime() - 60 * 6e4);
    neu(`s:${s.id}:${s.datum}:${s.beginn}`, vorher, "Schicht in 1 Stunde", `${s.beginn}–${s.ende}${s.notiz ? ` · ${s.notiz}` : ""}`);
  }
  for (const t of daten.todos) {
    if (!t.erledigt && t.faellig) neu(`t:${t.id}:${t.faellig}`, ortszeit(t.faellig, "08:00"), "To-do fällig heute", t.projekt ? `${t.text} · ${t.projekt}` : t.text);
  }
  for (let monat = monatVon(isoVon(jetzt)); monat <= monatVon(isoVon(bis)); monat = monatPlus(monat, 1)) {
    for (const a of daten.abos) {
      const termin = aboTermin(a, monat);
      if (termin) neu(`a:${a.id}:${termin}`, ortszeit(datumPlusTage(termin, -1), "18:00"), "Abbuchung morgen", `${a.name} · ${formatGeld(a.betrag)}`);
    }
  }
  return liste.sort((a, b) => a.zeit.localeCompare(b.zeit)).slice(0, 300);
}

// ---------- Formatieren und Eingaben ----------

const GELD = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const ZAHL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export const formatGeld = (cent) => GELD.format(cent / 100);
export const formatStunden = (min) => `${ZAHL.format(min / 60)} h`;

export function centZuEingabe(cent) {
  return (cent / 100).toFixed(2).replace(".", ",");
}

// "1.234,56", "12,5", "12.50" und "-20" werden verstanden; "1.234" ohne Komma ist mehrdeutig und ungültig.
export function euroZuCent(text) {
  let s = String(text ?? "").trim().replace(/[\s€]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// ---------- Daten, Export, Import ----------

export function leereDaten() {
  return {
    version: VERSION,
    einstellungen: { stundenlohn: 0, standardPause: 30, zahltag: 15, zahlungImFolgemonat: true, name: "", kuerzel: [], apiKey: "", apiKey2: "", push: { aktiv: false, geraet: "", geheimnis: "" } },
    schichten: [],
    abos: [],
    ausgaben: [],
    kontostand: null,
    todos: [],
  };
}

// Ergänzt fehlende Felder, z. B. nach einem Update der App.
export function mitStandardwerten(roh) {
  const leer = leereDaten();
  return { ...leer, ...roh, einstellungen: { ...leer.einstellungen, ...roh.einstellungen } };
}

const ganzeZahl = (n) => Number.isInteger(n);
const text = (s) => typeof s === "string";

function pruefe(bedingung, meldung) {
  if (!bedingung) throw new Error(meldung);
}

export function pruefeDaten(d) {
  pruefe(d && typeof d === "object", "Die Datei enthält keine App-Daten.");
  pruefe(d.version === VERSION, "Unbekannte Version der Datei.");
  const e = d.einstellungen;
  pruefe(e && ganzeZahl(e.stundenlohn) && ganzeZahl(e.standardPause) && ganzeZahl(e.zahltag) && typeof e.zahlungImFolgemonat === "boolean" && text(e.name) && Array.isArray(e.kuerzel), "Einstellungen sind ungültig.");
  for (const k of e.kuerzel) pruefe(text(k.code) && istZeit(k.beginn) && istZeit(k.ende) && ganzeZahl(k.pause), "Ein Schichtkürzel ist ungültig.");
  for (const liste of ["schichten", "abos", "ausgaben", "todos"]) pruefe(Array.isArray(d[liste]), `Liste „${liste}“ fehlt.`);
  for (const s of d.schichten) pruefe(text(s.id) && istDatum(s.datum) && istZeit(s.beginn) && istZeit(s.ende) && ganzeZahl(s.pause) && ganzeZahl(s.lohn) && text(s.notiz), `Schicht am ${s.datum} ist ungültig.`);
  for (const a of d.abos) pruefe(text(a.id) && text(a.name) && ganzeZahl(a.betrag) && ganzeZahl(a.tag) && [1, 3, 6, 12].includes(a.rhythmus) && istMonat(a.abMonat) && (a.bisMonat === "" || istMonat(a.bisMonat)), `Abo „${a.name}“ ist ungültig.`);
  for (const a of d.ausgaben) pruefe(text(a.id) && text(a.name) && ganzeZahl(a.betrag) && istDatum(a.datum), `Ausgabe „${a.name}“ ist ungültig.`);
  for (const t of d.todos) pruefe(text(t.id) && text(t.text) && text(t.projekt) && (t.faellig === "" || istDatum(t.faellig)) && typeof t.erledigt === "boolean", "Ein To-do ist ungültig.");
  pruefe(d.kontostand === null || (ganzeZahl(d.kontostand.betrag) && istDatum(d.kontostand.datum)), "Kontostand ist ungültig.");
}

// API-Keys und die Push-Anmeldung gehören zu diesem Gerät und werden nie exportiert.
export function exportiere(daten) {
  const { apiKey, apiKey2, push, ...einstellungen } = daten.einstellungen;
  return JSON.stringify({ ...daten, einstellungen }, null, 2);
}

// Beim Import bleiben Keys und Push-Anmeldung dieses Geräts erhalten.
export function importiere(inhalt, { apiKey = "", apiKey2 = "", push = leereDaten().einstellungen.push } = {}) {
  let d;
  try {
    d = JSON.parse(inhalt);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON.");
  }
  pruefeDaten(d);
  return { ...d, einstellungen: { ...d.einstellungen, apiKey, apiKey2, push } };
}

// ---------- Kalender-Export (.ics) ----------

const encoder = new TextEncoder();

// Zeilen über 75 Byte werden laut RFC 5545 umgebrochen und mit Leerzeichen fortgesetzt.
function falte(zeile) {
  const teile = [];
  let aktuell = "";
  for (const zeichen of zeile) {
    const grenze = teile.length === 0 ? 75 : 74;
    if (encoder.encode(aktuell + zeichen).length > grenze) {
      teile.push(aktuell);
      aktuell = "";
    }
    aktuell += zeichen;
  }
  teile.push(aktuell);
  return teile.join("\r\n ");
}

const icsText = (s) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, (z) => `\\${z}`);
const icsZeit = (datum, zeit) => `${datum.replace(/-/g, "")}T${zeit.replace(":", "")}00`;

export function icsExport(schichten, jetzt = new Date()) {
  const stempel = jetzt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kalender-App//DE", "CALSCALE:GREGORIAN"];
  const sortiert = [...schichten].sort((a, b) => a.datum.localeCompare(b.datum) || a.beginn.localeCompare(b.beginn));
  for (const s of sortiert) {
    const endeDatum = minuten(s.ende) <= minuten(s.beginn) ? datumPlusTage(s.datum, 1) : s.datum;
    zeilen.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@kalender-app`,
      `DTSTAMP:${stempel}`,
      `DTSTART:${icsZeit(s.datum, s.beginn)}`,
      `DTEND:${icsZeit(endeDatum, s.ende)}`,
      `SUMMARY:${icsText(s.notiz ? `Arbeit · ${s.notiz}` : "Arbeit")}`,
      "END:VEVENT",
    );
  }
  zeilen.push("END:VCALENDAR");
  return zeilen.map(falte).join("\r\n") + "\r\n";
}
