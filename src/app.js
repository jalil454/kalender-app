// Oberfläche der Kalender-App: zeichnet die Ansichten und verarbeitet Eingaben.
import * as L from "./logic.js";
import { laden, speichern, dauerhaftSpeichern } from "./store.js";
import { analysiereDienstplan, ausschnittErstellen, ladeBild, scanZuSchichten, streifen, zweitmeinung } from "./scan.js";

let daten = laden();
let heute = L.isoVon(new Date());
const ui = { tab: "kalender", einstellungen: false, monat: L.monatVon(heute), tag: heute, geldMonat: L.monatVon(heute) };
let scan = null; // Zustand der Foto-Analyse, solange das Sheet offen ist

const $app = document.getElementById("app");
const $tabbar = document.getElementById("tabbar");
const $sheet = document.getElementById("sheet");
const $hinweis = document.getElementById("hinweis");

const TABS = { kalender: "Kalender", geld: "Geld", todos: "To-dos" };
const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const RHYTHMUS = { 1: "monatlich", 3: "vierteljährlich", 6: "halbjährlich", 12: "jährlich" };

const fmtLang = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtMittel = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
const fmtKurz = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

const alsDate = (iso) => {
  const [j, m, t] = iso.split("-").map(Number);
  return new Date(j, m - 1, t);
};
const datumLang = (iso) => fmtLang.format(alsDate(iso));
const datumMittel = (iso) => fmtMittel.format(alsDate(iso));
const datumKurz = (iso) => fmtKurz.format(alsDate(iso));
const monatsEnde = (monat) => L.tagImMonat(monat, 31);
const mitVorzeichen = (cent) => (cent > 0 ? `+${L.formatGeld(cent)}` : L.formatGeld(cent));

const esc = (s) => String(s).replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]);
const neueId = () => crypto.randomUUID();
const finde = (liste, id) => liste.find((x) => x.id === id);

function ersetzeOderNeu(liste, eintrag) {
  const i = liste.findIndex((x) => x.id === eintrag.id);
  if (i >= 0) liste[i] = eintrag;
  else liste.push(eintrag);
}

function gruppiere(liste, schluessel) {
  const karte = new Map();
  for (const x of liste) karte.set(schluessel(x), [...(karte.get(schluessel(x)) ?? []), x]);
  return karte;
}

// ---------- Icons (eigene Linien-Icons, einheitliche Strichstärke) ----------

const svg = (pfad) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pfad}</svg>`;
const ICON = {
  kalender: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  geld: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.75"/><path d="M6 9.5v5M18 9.5v5"/>'),
  todos: svg('<path d="M4 7.5l1.75 1.75L9 6M4 15.5l1.75 1.75L9 14M12.5 8H20M12.5 16H20"/>'),
  regler: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  scan: svg('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7.5 12h9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  zurueck: svg('<path d="M15 5l-7 7 7 7"/>'),
  vor: svg('<path d="M9 5l7 7-7 7"/>'),
  haken: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

// ---------- Bausteine ----------

const navbar = (links, rechts) => `<header class="navbar"><div class="navbar-gruppe">${links}</div><div class="navbar-gruppe">${rechts}</div></header>`;
const knopfEinstellungen = () => `<button class="icon-knopf" data-aktion="einstellungen" aria-label="Einstellungen">${ICON.regler}</button>`;
const pfeile = (aktion, zurueck, vor) =>
  `<div class="navbar-gruppe"><button class="icon-knopf" data-aktion="${aktion}" data-n="-1" aria-label="${zurueck}">${ICON.zurueck}</button><button class="icon-knopf" data-aktion="${aktion}" data-n="1" aria-label="${vor}">${ICON.vor}</button></div>`;
const neuZeile = (aktion, text) => `<button class="zeile aktion" data-aktion="${aktion}">${ICON.plus}<span>${text}</span></button>`;

function feld(name, eingabe, einheit = "", breit = false) {
  return `<label class="feld${breit ? " breit" : ""}"><span class="feld-name">${name}</span>${eingabe}${einheit ? `<span class="einheit">${einheit}</span>` : ""}</label>`;
}

function tabbar() {
  return Object.entries(TABS)
    .map(([id, name]) => `<button class="tab" data-aktion="tab" data-tab="${id}"${ui.tab === id ? ' aria-current="page"' : ""}>${ICON[id]}<span>${name}</span></button>`)
    .join("");
}

// ---------- Kalender ----------

function ansichtKalender() {
  const [jahr, monat] = ui.monat.split("-").map(Number);
  const leerVorne = (new Date(jahr, monat - 1, 1).getDay() + 6) % 7; // Woche beginnt am Montag
  const schichtenProTag = gruppiere(daten.schichten, (s) => s.datum);
  const todosProTag = gruppiere(daten.todos.filter((t) => t.faellig && !t.erledigt), (t) => t.faellig);

  let zellen = "<span></span>".repeat(leerVorne);
  for (let tag = 1; tag <= L.tageImMonat(jahr, monat); tag++) {
    const datum = L.tagImMonat(ui.monat, tag);
    const anzahlSchichten = schichtenProTag.get(datum)?.length ?? 0;
    const anzahlTodos = todosProTag.get(datum)?.length ?? 0;
    const klassen = ["tag", datum === heute && "heute", datum === ui.tag && "gewaehlt"].filter(Boolean).join(" ");
    const beschreibung = [
      datumLang(datum),
      datum === heute && "heute",
      anzahlSchichten && (anzahlSchichten === 1 ? "eine Schicht" : `${anzahlSchichten} Schichten`),
      anzahlTodos && (anzahlTodos === 1 ? "ein To-do fällig" : `${anzahlTodos} To-dos fällig`),
    ]
      .filter(Boolean)
      .join(", ");
    zellen += `<button class="${klassen}" data-aktion="tag" data-datum="${datum}" aria-label="${beschreibung}" aria-pressed="${datum === ui.tag}"><span class="zahl">${tag}</span><span class="marken">${anzahlSchichten ? '<i class="marke"></i>' : ""}${anzahlTodos ? '<i class="marke todo"></i>' : ""}</span></button>`;
  }

  const summe = L.monatsLohn(daten.schichten, ui.monat);
  const lohnFehlt = daten.einstellungen.stundenlohn
    ? ""
    : `<div class="gruppe abstand-oben"><button class="zeile" data-aktion="einstellungen"><span class="haupt"><span class="titel">Stundenlohn eintragen</span><span class="unter">Damit die App deinen Lohn ausrechnen kann.</span></span>${ICON.vor}</button></div>`;

  return `
    ${navbar(`<button class="text-knopf" data-aktion="heute">Heute</button>`, `<button class="icon-knopf" data-aktion="scan" aria-label="Dienstplan scannen">${ICON.scan}</button>${knopfEinstellungen()}`)}
    <div class="titelzeile"><h1>${L.monatsName(ui.monat)} <span class="zusatz">${jahr}</span></h1>${pfeile("monat", "Vorheriger Monat", "Nächster Monat")}</div>
    <div class="wochentage" aria-hidden="true">${WOCHENTAGE.map((w) => `<span>${w}</span>`).join("")}</div>
    <div class="raster">${zellen}</div>
    ${lohnFehlt}
    <div class="gruppe abstand-oben">
      <div class="zeile"><span class="haupt">${L.monatsName(ui.monat)} gesamt</span><span class="wert">${L.formatStunden(summe.minuten)} · ${L.formatGeld(summe.lohn)}</span></div>
    </div>
    ${tagesDetail()}`;
}

function tagesDetail() {
  const schichten = daten.schichten.filter((s) => s.datum === ui.tag).sort((a, b) => a.beginn.localeCompare(b.beginn));
  const todos = daten.todos.filter((t) => t.faellig === ui.tag);
  const zeilen = schichten
    .map((s) => {
      const details = [L.formatStunden(L.arbeitsMinuten(s)), s.pause && `${s.pause} min Pause`, s.notiz && esc(s.notiz)].filter(Boolean).join(" · ");
      return `<button class="zeile" data-aktion="schicht-bearbeiten" data-id="${s.id}"><span class="haupt"><span class="titel">${s.beginn}–${s.ende}</span><span class="unter">${details}</span></span><span class="wert">${L.formatGeld(L.schichtLohn(s))}</span></button>`;
    })
    .join("");
  return `
    <h2 class="gruppen-titel">${datumLang(ui.tag)}</h2>
    <div class="gruppe">
      ${zeilen || '<div class="zeile leer-zeile">Keine Schicht</div>'}
      ${neuZeile("schicht-neu", "Schicht hinzufügen")}
    </div>
    ${todos.length ? `<h2 class="gruppen-titel">Fällig</h2><div class="gruppe">${todos.map(todoZeile).join("")}</div>` : ""}`;
}

// ---------- Geld ----------

function ansichtGeld() {
  const monat = ui.geldMonat;
  const jahr = monat.slice(0, 4);
  const name = L.monatsName(monat);
  const k = daten.kontostand;
  const p = L.prognose(daten, monatsEnde(monat));

  let hero;
  if (!k) {
    hero = `<div class="hero"><p class="etikett">Kontostand</p><p class="hero-text">Trag deinen aktuellen Kontostand ein. Dann rechnet die App aus, was am Monatsende übrig bleibt.</p><button class="knopf" data-aktion="kontostand">Kontostand eintragen</button></div>`;
  } else if (!p) {
    hero = `<div class="hero"><p class="etikett">Ende ${name} ${jahr}</p><p class="hero-text">Dein Kontostand ist vom ${datumKurz(k.datum)}. Eine Prognose gibt es ab diesem Tag.</p><button class="hero-unter" data-aktion="kontostand">Kontostand ändern</button></div>`;
  } else {
    hero = `<div class="hero"><p class="etikett">Ende ${name} ${jahr} voraussichtlich</p><p class="betrag${p.ende < 0 ? " minus" : ""}">${L.formatGeld(p.ende)}</p><button class="hero-unter" data-aktion="kontostand">Kontostand ${L.formatGeld(k.betrag)} am ${datumKurz(k.datum)} · Ändern</button></div>`;
  }

  const buchungen = p
    ? `<h2 class="gruppen-titel">Buchungen bis ${datumKurz(p.bis)}</h2><div class="gruppe">${
        p.buchungen
          .map((b) => `<div class="zeile"><span class="haupt"><span class="titel">${esc(b.text)}</span><span class="unter">${datumMittel(b.datum)} · danach ${L.formatGeld(b.danach)}</span></span><span class="wert${b.betrag > 0 ? " stark" : ""}">${mitVorzeichen(b.betrag)}</span></div>`)
          .join("") || '<div class="zeile leer-zeile">Keine Buchungen mehr</div>'
      }</div>`
    : "";

  const lohn = L.monatsLohn(daten.schichten, monat);
  const lohnZeile = `<h2 class="gruppen-titel">Lohn ${name}</h2><div class="gruppe"><div class="zeile"><span class="haupt"><span class="titel">${lohn.anzahl === 1 ? "1 Schicht" : `${lohn.anzahl} Schichten`} · ${L.formatStunden(lohn.minuten)}</span><span class="unter">Zahltag ${datumMittel(L.zahltag(monat, daten.einstellungen))}</span></span><span class="wert stark">${L.formatGeld(lohn.lohn)}</span></div></div>`;

  const aktiv = daten.abos.filter((a) => a.abMonat <= monat && (!a.bisMonat || a.bisMonat >= monat));
  const abos = [...daten.abos]
    .sort((a, b) => a.tag - b.tag || a.name.localeCompare(b.name, "de"))
    .map((a) => {
      const details = [`am ${a.tag}.`, RHYTHMUS[a.rhythmus], a.bisMonat && `bis ${L.monatsName(a.bisMonat)} ${a.bisMonat.slice(0, 4)}`].filter(Boolean).join(" · ");
      return `<button class="zeile" data-aktion="abo-bearbeiten" data-id="${a.id}"><span class="haupt"><span class="titel">${esc(a.name)}</span><span class="unter">${details}</span></span><span class="wert">${L.formatGeld(a.betrag)}</span></button>`;
    })
    .join("");

  const ausgaben = daten.ausgaben
    .filter((a) => L.monatVon(a.datum) === monat)
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((a) => `<button class="zeile" data-aktion="ausgabe-bearbeiten" data-id="${a.id}"><span class="haupt"><span class="titel">${esc(a.name)}</span><span class="unter">${datumMittel(a.datum)}</span></span><span class="wert">${L.formatGeld(a.betrag)}</span></button>`)
    .join("");

  return `
    ${navbar("", knopfEinstellungen())}
    <div class="titelzeile"><h1>Geld</h1>${pfeile("geldmonat", "Vorheriger Monat", "Nächster Monat")}</div>
    ${hero}
    ${buchungen}
    ${lohnZeile}
    <h2 class="gruppen-titel">Abos und Fixkosten</h2>
    <div class="gruppe">
      ${abos}
      ${daten.abos.length ? `<div class="zeile"><span class="haupt">Im Schnitt pro Monat</span><span class="wert stark">${L.formatGeld(Math.round(L.aboProMonat(aktiv)))}</span></div>` : ""}
      ${neuZeile("abo-neu", "Abo hinzufügen")}
    </div>
    <h2 class="gruppen-titel">Einmalige Ausgaben im ${name}</h2>
    <div class="gruppe">
      ${ausgaben}
      ${neuZeile("ausgabe-neu", "Ausgabe hinzufügen")}
    </div>`;
}

// ---------- To-dos ----------

function todoZeile(t) {
  const ueberfaellig = !t.erledigt && t.faellig && t.faellig < heute;
  const unter = t.faellig ? `<span class="unter${ueberfaellig ? " achtung" : ""}">${ueberfaellig ? "überfällig seit" : "fällig"} ${datumMittel(t.faellig)}</span>` : "";
  return `<div class="zeile${t.erledigt ? " erledigt" : ""}"><button class="haken" role="checkbox" aria-checked="${t.erledigt}" aria-label="Erledigt: ${esc(t.text)}" data-aktion="todo-umschalten" data-id="${t.id}"><span>${t.erledigt ? ICON.haken : ""}</span></button><button class="haupt zeilen-text" data-aktion="todo-bearbeiten" data-id="${t.id}"><span class="titel">${esc(t.text)}</span>${unter}</button></div>`;
}

function ansichtTodos() {
  const offen = daten.todos.filter((t) => !t.erledigt);
  const erledigt = daten.todos.filter((t) => t.erledigt);
  const projekte = [...new Set(offen.map((t) => t.projekt))].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, "de"));
  const nachFaelligkeit = (a, b) => (a.faellig || "9999").localeCompare(b.faellig || "9999");
  const gruppen = projekte
    .map((p) => `<h2 class="gruppen-titel">${esc(p || "Ohne Projekt")}</h2><div class="gruppe">${offen.filter((t) => t.projekt === p).sort(nachFaelligkeit).map(todoZeile).join("")}</div>`)
    .join("");
  return `
    ${navbar("", `<button class="icon-knopf" data-aktion="todo-neu" aria-label="Neues To-do">${ICON.plus}</button>${knopfEinstellungen()}`)}
    <div class="titelzeile"><h1>To-dos</h1></div>
    ${gruppen || '<p class="leer">Nichts offen. Neue Aufgaben legst du mit dem Plus oben rechts an.</p>'}
    ${erledigt.length ? `<details class="erledigt-block"><summary class="gruppen-titel">Erledigt (${erledigt.length})</summary><div class="gruppe">${erledigt.map(todoZeile).join("")}</div></details>` : ""}`;
}

// ---------- Einstellungen ----------

function ansichtEinstellungen() {
  const e = daten.einstellungen;
  const kuerzel = e.kuerzel
    .map((k, i) => `<button class="zeile" data-aktion="kuerzel-bearbeiten" data-index="${i}"><span class="haupt titel">${esc(k.code)}</span><span class="wert">${k.beginn}–${k.ende} · ${k.pause} min</span></button>`)
    .join("");
  return `
    ${navbar(`<button class="text-knopf" data-aktion="zurueck">${ICON.zurueck}<span>${TABS[ui.tab]}</span></button>`, "")}
    <div class="titelzeile"><h1>Einstellungen</h1></div>

    <h2 class="gruppen-titel">Lohn</h2>
    <div class="gruppe">
      ${feld("Stundenlohn", `<input data-einstellung="stundenlohn" inputmode="decimal" placeholder="0,00" value="${e.stundenlohn ? L.centZuEingabe(e.stundenlohn) : ""}">`, "€")}
      ${feld("Pause pro Schicht", `<input data-einstellung="standardPause" type="number" inputmode="numeric" min="0" max="600" value="${e.standardPause}">`, "min")}
      ${feld("Zahltag", `<input data-einstellung="zahltag" type="number" inputmode="numeric" min="1" max="31" value="${e.zahltag}">`, ". des Monats")}
      <div class="feld gestapelt"><span class="feld-name" id="zahlung-name">Lohn kommt</span>
        <div class="segment" role="radiogroup" aria-labelledby="zahlung-name">
          <label><input type="radio" name="zahlung" value="gleich" data-einstellung="zahlungImFolgemonat"${e.zahlungImFolgemonat ? "" : " checked"}>Im selben Monat</label>
          <label><input type="radio" name="zahlung" value="folgemonat" data-einstellung="zahlungImFolgemonat"${e.zahlungImFolgemonat ? " checked" : ""}>Im Folgemonat</label>
        </div>
      </div>
    </div>
    <p class="fussnote">Der Stundenlohn gilt für neue Schichten. Eingetragene Schichten behalten ihren Lohn. Die Pause ist der Vorschlag für neue Schichten.</p>

    <h2 class="gruppen-titel">Dienstplan-Foto</h2>
    <div class="gruppe">
      ${feld("Name im Plan", `<input data-einstellung="name" value="${esc(e.name)}" placeholder="z. B. Müller" autocomplete="off" autocapitalize="words">`)}
      ${feld("Groq-API-Key", `<input data-einstellung="apiKey" type="password" value="${esc(e.apiKey)}" placeholder="gsk_…" autocomplete="off" spellcheck="false">`)}
      ${feld("OpenRouter-Key", `<input data-einstellung="apiKey2" type="password" value="${esc(e.apiKey2)}" placeholder="optional, sk-or-…" autocomplete="off" spellcheck="false">`)}
    </div>
    <p class="fussnote">Den kostenlosen Groq-Key legst du auf console.groq.com an. Optional als Zweitmeinung: ein kostenloser Key von openrouter.ai. Dann liest ein zweites Modell denselben Ausschnitt, und Abweichungen werden markiert. Die Keys bleiben nur auf diesem Gerät und stehen nie in der Sicherung.</p>

    <h2 class="gruppen-titel">Schichtkürzel</h2>
    <div class="gruppe">
      ${kuerzel}
      ${neuZeile("kuerzel-neu", "Kürzel hinzufügen")}
    </div>
    <p class="fussnote">Steht im Dienstplan nur „F“ oder „S“, setzt die App die Zeiten von hier ein.</p>

    <h2 class="gruppen-titel">Daten</h2>
    <div class="gruppe">
      <button class="zeile" data-aktion="export"><span class="haupt">Sicherung exportieren</span></button>
      <label class="zeile"><span class="haupt">Sicherung importieren</span><input class="vh" type="file" accept="application/json,.json" data-datei="import"></label>
      <button class="zeile" data-aktion="ics"><span class="haupt">Schichten für Apple Kalender exportieren</span></button>
    </div>
    <p class="fussnote">Alle Daten liegen nur in diesem Browser. Füg die App zum Home-Bildschirm hinzu (Teilen, dann „Zum Home-Bildschirm“), damit iOS sie nicht nach längerer Pause löscht, und exportier ab und zu eine Sicherung.</p>

    <div class="gruppe abstand-oben"><button class="zeile gefahr" data-aktion="alles-loeschen">Alle Daten löschen</button></div>`;
}

function einstellungAendern(el) {
  const e = daten.einstellungen;
  const feldName = el.dataset.einstellung;
  if (feldName === "stundenlohn") {
    const cent = L.euroZuCent(el.value || "0");
    if (cent === null || cent < 0) return ungueltig(el, "Bitte als Betrag eingeben, z. B. 13,90");
    e.stundenlohn = cent;
  } else if (feldName === "standardPause" || feldName === "zahltag") {
    const n = Number(el.value);
    const [min, max] = feldName === "zahltag" ? [1, 31] : [0, 600];
    if (!Number.isInteger(n) || n < min || n > max) return ungueltig(el, `Bitte eine ganze Zahl von ${min} bis ${max}.`);
    e[feldName] = n;
  } else if (feldName === "zahlungImFolgemonat") {
    e.zahlungImFolgemonat = el.value === "folgemonat";
  } else {
    e[feldName] = el.value.trim();
  }
  if (!speichern(daten)) zeigeHinweis("Speichern fehlgeschlagen");
}

// ---------- Sheets ----------

function oeffneSheet(titel, inhalt, { form, id = "", knopf = "Sichern" }) {
  $sheet.innerHTML = `<form data-form="${form}" data-id="${id}">
    <div class="sheet-kopf"><button type="button" class="text-knopf" data-aktion="schliessen">Abbrechen</button><h2 id="sheet-titel">${titel}</h2>${knopf ? `<button type="submit" class="text-knopf fett">${knopf}</button>` : "<span></span>"}</div>
    <div class="sheet-inhalt">${inhalt}</div>
  </form>`;
  $sheet.setAttribute("aria-labelledby", "sheet-titel");
  if (!$sheet.open) $sheet.showModal();
}

const loeschKnopf = (aktion, id, text) => `<div class="gruppe abstand-oben"><button type="button" class="zeile gefahr" data-aktion="${aktion}" data-id="${id}">${text}</button></div>`;

function ungueltig(el, text) {
  el.setCustomValidity(text);
  el.reportValidity();
  // Jede Änderung im Formular hebt die Markierung auf, sonst blockiert sie auch abgewählte Zeilen.
  (el.form ?? el).addEventListener("input", () => el.setCustomValidity(""), { once: true });
  return false;
}

function sheetSchicht(s) {
  const letzte = daten.schichten.at(-1);
  const w = s ?? { datum: ui.tag, beginn: letzte?.beginn ?? "", ende: letzte?.ende ?? "", pause: daten.einstellungen.standardPause, lohn: daten.einstellungen.stundenlohn, notiz: "" };
  oeffneSheet(
    s ? "Schicht" : "Neue Schicht",
    `<div class="gruppe">
      ${feld("Datum", `<input type="date" name="datum" required value="${w.datum}">`)}
      ${feld("Beginn", `<input type="time" name="beginn" required value="${w.beginn}">`)}
      ${feld("Ende", `<input type="time" name="ende" required value="${w.ende}">`)}
      ${feld("Unbezahlte Pause", `<input type="number" name="pause" inputmode="numeric" min="0" max="600" required value="${w.pause}">`, "min")}
      ${feld("Stundenlohn", `<input name="lohn" inputmode="decimal" required placeholder="0,00" value="${w.lohn ? L.centZuEingabe(w.lohn) : ""}">`, "€")}
    </div>
    <p class="vorschau" data-vorschau aria-live="polite"></p>
    <div class="gruppe">${feld("Notiz", `<input name="notiz" maxlength="200" placeholder="optional" value="${esc(w.notiz)}">`, "", true)}</div>
    ${s ? loeschKnopf("schicht-loeschen", s.id, "Schicht löschen") : ""}`,
    { form: "schicht", id: s?.id },
  );
  vorschauSchicht();
}

function vorschauSchicht() {
  const f = $sheet.querySelector('[data-form="schicht"]');
  const ausgabe = f?.querySelector("[data-vorschau]");
  if (!ausgabe) return;
  const s = { beginn: f.elements.beginn.value, ende: f.elements.ende.value, pause: Number(f.elements.pause.value), lohn: L.euroZuCent(f.elements.lohn.value) };
  if (!L.istZeit(s.beginn) || !L.istZeit(s.ende) || s.beginn === s.ende || !Number.isInteger(s.pause) || s.lohn === null) {
    ausgabe.textContent = "";
    return;
  }
  ausgabe.textContent = `${L.formatStunden(L.arbeitsMinuten(s))} · ${L.formatGeld(L.schichtLohn(s))}${s.ende < s.beginn ? " · endet am nächsten Tag" : ""}`;
}

function sheetAbo(a) {
  const w = a ?? { name: "", betrag: 0, tag: 1, rhythmus: 1, abMonat: L.monatVon(heute), bisMonat: "" };
  const optionen = Object.entries(RHYTHMUS)
    .map(([wert, text]) => `<option value="${wert}"${Number(wert) === w.rhythmus ? " selected" : ""}>${text}</option>`)
    .join("");
  oeffneSheet(
    a ? "Abo" : "Neues Abo",
    `<div class="gruppe">
      ${feld("Name", `<input name="name" required maxlength="80" placeholder="z. B. Spotify" value="${esc(w.name)}">`, "", true)}
      ${feld("Betrag", `<input name="betrag" inputmode="decimal" required placeholder="0,00" value="${w.betrag ? L.centZuEingabe(w.betrag) : ""}">`, "€")}
      ${feld("Abbuchung am", `<input type="number" name="tag" inputmode="numeric" min="1" max="31" required value="${w.tag}">`, ".")}
      ${feld("Rhythmus", `<select name="rhythmus">${optionen}</select>`)}
      ${feld("Erste Abbuchung", `<input type="month" name="abMonat" required pattern="\\d{4}-\\d{2}" placeholder="2026-10" value="${w.abMonat}">`)}
      ${feld("Letzte Abbuchung", `<input type="month" name="bisMonat" pattern="\\d{4}-\\d{2}" placeholder="optional" value="${w.bisMonat}">`)}
    </div>
    <p class="fussnote">Fällt der Tag in einem kurzen Monat weg (z. B. der 31.), zählt der letzte Tag des Monats.</p>
    ${a ? loeschKnopf("abo-loeschen", a.id, "Abo löschen") : ""}`,
    { form: "abo", id: a?.id },
  );
}

function sheetAusgabe(a) {
  const w = a ?? { name: "", betrag: 0, datum: ui.geldMonat === L.monatVon(heute) ? heute : `${ui.geldMonat}-01` };
  oeffneSheet(
    a ? "Ausgabe" : "Neue Ausgabe",
    `<div class="gruppe">
      ${feld("Name", `<input name="name" required maxlength="80" placeholder="z. B. Geschenk" value="${esc(w.name)}">`, "", true)}
      ${feld("Betrag", `<input name="betrag" inputmode="decimal" required placeholder="0,00" value="${w.betrag ? L.centZuEingabe(w.betrag) : ""}">`, "€")}
      ${feld("Datum", `<input type="date" name="datum" required value="${w.datum}">`)}
    </div>
    ${a ? loeschKnopf("ausgabe-loeschen", a.id, "Ausgabe löschen") : ""}`,
    { form: "ausgabe", id: a?.id },
  );
}

function sheetKontostand() {
  const k = daten.kontostand;
  oeffneSheet(
    "Kontostand",
    `<div class="gruppe">
      ${feld("Betrag", `<input name="betrag" inputmode="decimal" required placeholder="0,00" value="${k ? L.centZuEingabe(k.betrag) : ""}">`, "€")}
      ${feld("Stand vom", `<input type="date" name="datum" required value="${heute}">`)}
    </div>
    <p class="fussnote">Trag den Betrag ein, den dein Konto heute nach allen Buchungen zeigt. Für die Prognose zählen Buchungen ab morgen.</p>`,
    { form: "kontostand" },
  );
}

function sheetTodo(t) {
  const w = t ?? { text: "", projekt: "", faellig: "" };
  const projekte = [...new Set(daten.todos.map((x) => x.projekt).filter(Boolean))];
  oeffneSheet(
    t ? "To-do" : "Neues To-do",
    `<div class="gruppe">
      ${feld("Aufgabe", `<input name="text" required maxlength="200" placeholder="Was ist zu tun?" value="${esc(w.text)}">`, "", true)}
      ${feld("Projekt", `<input name="projekt" list="projekte" maxlength="60" placeholder="optional" value="${esc(w.projekt)}">`, "", true)}
      ${feld("Fällig am", `<input type="date" name="faellig" value="${w.faellig}">`)}
    </div>
    <datalist id="projekte">${projekte.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
    ${t ? loeschKnopf("todo-loeschen", t.id, "To-do löschen") : ""}`,
    { form: "todo", id: t?.id },
  );
}

function sheetKuerzel(index) {
  const k = daten.einstellungen.kuerzel[index] ?? { code: "", beginn: "", ende: "", pause: daten.einstellungen.standardPause };
  oeffneSheet(
    index === undefined ? "Neues Kürzel" : "Kürzel",
    `<div class="gruppe">
      ${feld("Kürzel", `<input name="code" required maxlength="6" placeholder="z. B. F" autocapitalize="characters" value="${esc(k.code)}">`)}
      ${feld("Beginn", `<input type="time" name="beginn" required value="${k.beginn}">`)}
      ${feld("Ende", `<input type="time" name="ende" required value="${k.ende}">`)}
      ${feld("Unbezahlte Pause", `<input type="number" name="pause" inputmode="numeric" min="0" max="600" required value="${k.pause}">`, "min")}
    </div>
    ${index === undefined ? "" : loeschKnopf("kuerzel-loeschen", index, "Kürzel löschen")}`,
    { form: "kuerzel", id: index ?? "" },
  );
}

// Speichert ein Formular. Gibt false zurück, wenn eine Eingabe ungültig ist.
const SPEICHERN = {
  schicht(w, id, f) {
    const lohn = L.euroZuCent(w.lohn);
    if (lohn === null || lohn < 0) return ungueltig(f.elements.lohn, "Bitte als Betrag eingeben, z. B. 13,90");
    if (w.beginn === w.ende) return ungueltig(f.elements.ende, "Ende und Beginn sind gleich.");
    const s = { id: id || neueId(), datum: w.datum, beginn: w.beginn, ende: w.ende, pause: Number(w.pause), lohn, notiz: w.notiz.trim() };
    ersetzeOderNeu(daten.schichten, s);
    ui.tag = s.datum;
    ui.monat = L.monatVon(s.datum);
  },
  abo(w, id, f) {
    const betrag = L.euroZuCent(w.betrag);
    if (betrag === null || betrag <= 0) return ungueltig(f.elements.betrag, "Bitte als Betrag eingeben, z. B. 9,99");
    if (!L.istMonat(w.abMonat)) return ungueltig(f.elements.abMonat, "Bitte als Monat eingeben, z. B. 2026-10");
    if (w.bisMonat && (!L.istMonat(w.bisMonat) || w.bisMonat < w.abMonat)) return ungueltig(f.elements.bisMonat, "Bitte ein Monat nach der ersten Abbuchung.");
    ersetzeOderNeu(daten.abos, { id: id || neueId(), name: w.name.trim(), betrag, tag: Number(w.tag), rhythmus: Number(w.rhythmus), abMonat: w.abMonat, bisMonat: w.bisMonat });
  },
  ausgabe(w, id, f) {
    const betrag = L.euroZuCent(w.betrag);
    if (betrag === null || betrag <= 0) return ungueltig(f.elements.betrag, "Bitte als Betrag eingeben, z. B. 25,00");
    ersetzeOderNeu(daten.ausgaben, { id: id || neueId(), name: w.name.trim(), betrag, datum: w.datum });
  },
  kontostand(w, id, f) {
    const betrag = L.euroZuCent(w.betrag);
    if (betrag === null) return ungueltig(f.elements.betrag, "Bitte als Betrag eingeben, z. B. 1.234,56 oder -50");
    daten.kontostand = { betrag, datum: w.datum };
  },
  todo(w, id) {
    const alt = id ? finde(daten.todos, id) : null;
    ersetzeOderNeu(daten.todos, { id: id || neueId(), text: w.text.trim(), projekt: w.projekt.trim(), faellig: w.faellig, erledigt: alt?.erledigt ?? false });
  },
  kuerzel(w, id, f) {
    const liste = daten.einstellungen.kuerzel;
    const code = w.code.trim();
    const index = id === "" ? -1 : Number(id);
    if (liste.some((k, i) => i !== index && k.code.toUpperCase() === code.toUpperCase())) return ungueltig(f.elements.code, "Dieses Kürzel gibt es schon.");
    if (w.beginn === w.ende) return ungueltig(f.elements.ende, "Ende und Beginn sind gleich.");
    const k = { code, beginn: w.beginn, ende: w.ende, pause: Number(w.pause) };
    if (index >= 0) liste[index] = k;
    else liste.push(k);
  },
};

// ---------- Dienstplan-Scan ----------

function sheetScan() {
  const e = daten.einstellungen;
  if (!e.apiKey) {
    oeffneSheet(
      "Dienstplan scannen",
      `<p class="sheet-text">Für die Foto-Analyse brauchst du einen kostenlosen API-Key von Groq (console.groq.com). Trag ihn in den Einstellungen ein.</p><button type="button" class="knopf" data-aktion="einstellungen">Zu den Einstellungen</button>`,
      { form: "info", knopf: "" },
    );
    return;
  }
  if (scan?.url) URL.revokeObjectURL(scan.url);
  scan = { abbruch: null, ergebnis: null };
  oeffneSheet(
    "Dienstplan scannen",
    `<div class="gruppe">${feld("Dein Name im Plan", `<input name="name" required maxlength="60" placeholder="z. B. Müller" autocomplete="off" value="${esc(e.name)}">`)}</div>
    <label class="foto-wahl"><input type="file" name="foto" accept="image/*" required><span data-foto-name>Foto auswählen oder aufnehmen</span></label>
    <p class="fussnote">Danach tippst du im Foto auf deinen Namen, auf das Ende deiner Zeile und auf die Datumszeile. Nur dieser Ausschnitt geht an Groq. In die App kommt erst etwas, wenn du die Vorschläge bestätigst.</p>
    ${e.stundenlohn ? "" : '<p class="fussnote achtung">Noch kein Stundenlohn eingetragen: übernommene Schichten hätten 0 € Lohn.</p>'}
    <button type="submit" class="knopf">Weiter</button>`,
    { form: "scan", knopf: "" },
  );
}

const MARKIER_TEXTE = [
  "Schritt 1 von 3: Tippe auf deinen Namen.",
  "Schritt 2 von 3: Tippe in deiner Zeile auf das letzte Feld ganz am Ende.",
  "Schritt 3 von 3: Tippe auf die Kopfzeile mit den Daten.",
  "Prüf den Ausschnitt unten: Er muss die Daten und deine Zeile zeigen.",
];

async function scanStarten(f) {
  daten.einstellungen.name = f.elements.name.value.trim();
  speichern(daten);
  const url = URL.createObjectURL(f.elements.foto.files[0]);
  let bild;
  try {
    bild = await ladeBild(url);
  } catch {
    URL.revokeObjectURL(url);
    return ungueltig(f.elements.foto, "Das Foto konnte nicht geöffnet werden. Versuch es als JPG oder PNG.");
  }
  scan = { abbruch: null, ergebnis: null, url, bild, punkte: [], ausschnitt: null };
  f.dataset.form = "scan-markieren";
  $sheet.querySelector(".sheet-inhalt").innerHTML = `
    <p class="schritt" data-schritt aria-live="polite">${MARKIER_TEXTE[0]}</p>
    <div class="zoom" role="group" aria-label="Vergrößerung">${[1, 2, 3].map((z) => `<button type="button" data-aktion="zoom" data-faktor="${z}" aria-pressed="${z === 2}">${z}×</button>`).join("")}</div>
    <div class="foto-rahmen"><div class="foto-flaeche" data-foto-flaeche style="width: 200%"><img src="${url}" alt="Dienstplan-Foto, zum Markieren antippen" data-aktion="markieren"></div></div>
    <div data-ausschnitt hidden><p class="fussnote">Das geht an Groq:</p><img class="ausschnitt" alt="Ausschnitt mit Datumszeile und deiner Zeile"></div>
    <div class="knopf-reihe"><button type="button" class="knopf zweit" data-aktion="neu-markieren">Neu markieren</button><button type="submit" class="knopf" data-scan-senden disabled>Analysieren</button></div>`;
}

function markieren(bildEl, ereignis) {
  if (!scan?.bild || scan.punkte.length >= 3) return;
  const { bild, punkte } = scan;
  const p = { x: (ereignis.offsetX / bildEl.clientWidth) * bild.naturalWidth, y: (ereignis.offsetY / bildEl.clientHeight) * bild.naturalHeight };
  const hinweis = $sheet.querySelector("[data-schritt]");
  if (punkte.length === 1 && Math.hypot(p.x - punkte[0].x, p.y - punkte[0].y) < 0.1 * Math.hypot(bild.naturalWidth, bild.naturalHeight)) {
    hinweis.textContent = "Zu nah am Namen. Tippe auf das letzte Feld ganz am Ende deiner Zeile.";
    return;
  }
  if (punkte.length === 2) {
    const g = streifen(punkte[0], punkte[1], p);
    if (Math.abs(g.kopfVersatz) < g.halbeDicke) {
      hinweis.textContent = "Das ist noch deine Zeile. Tippe auf die Kopfzeile mit den Daten.";
      return;
    }
  }
  punkte.push(p);
  zeichneMarken();
  hinweis.textContent = MARKIER_TEXTE[punkte.length];
  if (punkte.length === 3) {
    scan.ausschnitt = ausschnittErstellen(bild, punkte);
    const box = $sheet.querySelector("[data-ausschnitt]");
    box.querySelector("img").src = scan.ausschnitt.url;
    box.hidden = false;
    $sheet.querySelector("[data-scan-senden]").disabled = false;
    box.scrollIntoView({ block: "nearest" });
  }
}

function zeichneMarken() {
  const flaeche = $sheet.querySelector("[data-foto-flaeche]");
  flaeche.querySelectorAll(".marke-nr").forEach((m) => m.remove());
  scan.punkte.forEach((p, i) => {
    flaeche.insertAdjacentHTML("beforeend", `<span class="marke-nr" style="left: ${(p.x / scan.bild.naturalWidth) * 100}%; top: ${(p.y / scan.bild.naturalHeight) * 100}%" aria-hidden="true">${i + 1}</span>`);
  });
}

async function scanSenden(f) {
  const abbruch = new AbortController();
  scan.abbruch = abbruch;
  const inhalt = $sheet.querySelector(".sheet-inhalt");
  const e = daten.einstellungen;
  inhalt.innerHTML = `<div class="laden" role="status"><span class="kreis" aria-hidden="true"></span><p>${e.apiKey2 ? "Groq und OpenRouter lesen" : "Groq liest"} den Dienstplan …</p><p class="fussnote">Das dauert meist bis zu einer Minute.</p></div>`;
  const lies = (anbieter, apiKey) => analysiereDienstplan({ anbieter, apiKey, bild: scan.ausschnitt.base64, name: e.name, heute, kuerzel: e.kuerzel, signal: abbruch.signal }).then((antwort) => scanZuSchichten(antwort, e, daten.schichten));
  try {
    let ergebnis;
    if (!e.apiKey2) {
      ergebnis = await lies("groq", e.apiKey);
    } else {
      // Beide gleichzeitig; fällt einer aus, zählt der andere allein, mit Hinweis.
      const [groq, openrouter] = await Promise.allSettled([lies("groq", e.apiKey), lies("openrouter", e.apiKey2)]);
      if (groq.status === "fulfilled" && openrouter.status === "fulfilled") ergebnis = zweitmeinung(groq.value, openrouter.value, ["Groq", "OpenRouter"]);
      else if (groq.status === "fulfilled") ergebnis = { ...groq.value, ausfall: `Zweitmeinung fehlgeschlagen: ${openrouter.reason.message}` };
      else if (openrouter.status === "fulfilled") ergebnis = { ...openrouter.value, ausfall: `Groq fehlgeschlagen: ${groq.reason.message}` };
      else throw groq.reason;
    }
    if (scan?.abbruch !== abbruch) return; // Sheet wurde inzwischen geschlossen
    zeigeScanErgebnis(f, ergebnis);
  } catch (fehler) {
    if (abbruch.signal.aborted || scan?.abbruch !== abbruch) return;
    inhalt.innerHTML = `<p class="sheet-text fehler" role="alert">${esc(fehler.message)}</p><button type="button" class="knopf" data-aktion="scan">Noch einmal</button>`;
  }
}

function zeigeScanErgebnis(f, r) {
  scan.ergebnis = r;
  const inhalt = $sheet.querySelector(".sheet-inhalt");
  const hinweis = (r.hinweis ? `<p class="fussnote">Hinweis: ${esc(r.hinweis)}</p>` : "") + (r.ausfall ? `<p class="fussnote achtung">${esc(r.ausfall)}</p>` : "");
  if (!r.nameGefunden || !r.eintraege.length) {
    const text = r.nameGefunden ? `Für „${esc(r.nameImPlan)}“ stehen keine Arbeitstage im Plan.` : "Dein Name wurde im Plan nicht eindeutig gefunden. Prüf die Schreibweise oder nimm ein schärferes Foto.";
    inhalt.innerHTML = `<p class="sheet-text" role="alert">${text}</p>${hinweis}<button type="button" class="knopf" data-aktion="scan">Anderes Foto</button>`;
    return;
  }
  const zeilen = r.eintraege
    .map((e, i) => {
      const status = e.status === "doppelt" ? "Schon eingetragen" : e.status === "unklar" ? `„${esc(e.kuerzel || e.roh)}“ ist unbekannt: Zeiten eintragen` : `Im Plan: ${esc(e.roh)}`;
      const abweichung = e.abweichung ? `<span class="unter achtung">Unsicher: ${esc(e.abweichung)}</span>` : "";
      return `<div class="zeile scan-zeile">
        <label class="auswahl-ziel"><input type="checkbox" class="auswahl" name="auswahl-${i}"${e.auswahl ? " checked" : ""} aria-label="${datumLang(e.datum)} übernehmen"></label>
        <div class="haupt">
          <span class="titel">${datumMittel(e.datum)}</span>
          <span class="unter${e.status === "unklar" ? " achtung" : ""}">${status}</span>
          ${abweichung}
          <div class="zeiten">
            <input type="time" class="mini" name="beginn-${i}" value="${e.beginn}" aria-label="Beginn">
            <span aria-hidden="true">–</span>
            <input type="time" class="mini" name="ende-${i}" value="${e.ende}" aria-label="Ende">
            <span class="pause-gruppe"><span class="einheit">Pause</span><input type="number" class="mini pause" name="pause-${i}" min="0" max="600" inputmode="numeric" value="${e.pause}" aria-label="Pause in Minuten"><span class="einheit">min</span></span>
          </div>
        </div>
      </div>`;
    })
    .join("");
  const anzahlUnsicher = r.eintraege.filter((e) => e.abweichung).length;
  const vergleich = !("abweichung" in r.eintraege[0]) ? "" : anzahlUnsicher ? ` ${anzahlUnsicher === 1 ? "1 Eintrag ist" : `${anzahlUnsicher} Einträge sind`} unsicher, weil die beiden Modelle verschieden lesen.` : " Groq und OpenRouter lesen dasselbe.";
  inhalt.innerHTML = `<p class="fussnote">Gefunden als „${esc(r.nameImPlan)}“.${vergleich} Prüf die Zeiten und wähl aus, was übernommen wird.</p>
    <div class="gruppe abstand-oben">${zeilen}</div>
    ${hinweis}
    <button type="submit" class="knopf" data-scan-knopf></button>`;
  f.dataset.form = "scan-uebernehmen";
  zaehleAuswahl(f);
}

function zaehleAuswahl(f) {
  const anzahl = f.querySelectorAll(".auswahl:checked").length;
  const knopf = f.querySelector("[data-scan-knopf]");
  knopf.textContent = anzahl === 1 ? "1 Schicht übernehmen" : `${anzahl} Schichten übernehmen`;
  knopf.disabled = anzahl === 0;
}

function scanUebernehmen(f) {
  const el = f.elements;
  const neu = [];
  for (const [i, e] of scan.ergebnis.eintraege.entries()) {
    if (!el[`auswahl-${i}`].checked) continue;
    const beginn = el[`beginn-${i}`].value;
    const ende = el[`ende-${i}`].value;
    const pause = Number(el[`pause-${i}`].value);
    if (!L.istZeit(beginn)) return ungueltig(el[`beginn-${i}`], "Bitte Beginn eintragen.");
    if (!L.istZeit(ende) || ende === beginn) return ungueltig(el[`ende-${i}`], "Bitte ein Ende eintragen, das sich vom Beginn unterscheidet.");
    if (!Number.isInteger(pause) || pause < 0) return ungueltig(el[`pause-${i}`], "Bitte Pause in Minuten.");
    neu.push({ id: neueId(), datum: e.datum, beginn, ende, pause, lohn: daten.einstellungen.stundenlohn, notiz: "" });
  }
  daten.schichten.push(...neu);
  ui.tab = "kalender";
  ui.einstellungen = false;
  ui.tag = neu[0].datum;
  ui.monat = L.monatVon(neu[0].datum);
  zeigeHinweis(neu.length === 1 ? "1 Schicht übernommen" : `${neu.length} Schichten übernommen`);
}

// ---------- Export und Import ----------

async function teilenOderLaden(name, inhalt, typ) {
  const datei = new File([inhalt], name, { type: typ });
  if (navigator.canShare?.({ files: [datei] })) {
    try {
      await navigator.share({ files: [datei] });
    } catch {}
    return;
  }
  const url = URL.createObjectURL(datei);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importieren(eingabe) {
  const datei = eingabe.files[0];
  eingabe.value = "";
  if (!datei) return;
  try {
    const neu = L.importiere(await datei.text(), daten.einstellungen);
    if (!confirm("Die Sicherung ersetzt alle Daten auf diesem Gerät. Fortfahren?")) return;
    daten = neu;
    sichern();
    zeigeHinweis("Sicherung importiert");
  } catch (fehler) {
    alert(fehler.message);
  }
}

// ---------- Ablauf ----------

function loeschen(liste, id, frage) {
  if (!confirm(frage)) return;
  daten[liste] = daten[liste].filter((x) => x.id !== id);
  $sheet.close();
  sichern();
}

const AKTIONEN = {
  tab(el) {
    ui.tab = el.dataset.tab;
    ui.einstellungen = false;
    render();
    scrollTo(0, 0);
  },
  einstellungen() {
    if ($sheet.open) $sheet.close();
    ui.einstellungen = true;
    render();
    scrollTo(0, 0);
  },
  zurueck() {
    ui.einstellungen = false;
    render();
  },
  heute() {
    ui.monat = L.monatVon(heute);
    ui.tag = heute;
    render();
  },
  monat(el) {
    ui.monat = L.monatPlus(ui.monat, Number(el.dataset.n));
    ui.tag = ui.monat === L.monatVon(heute) ? heute : `${ui.monat}-01`;
    render();
  },
  geldmonat(el) {
    ui.geldMonat = L.monatPlus(ui.geldMonat, Number(el.dataset.n));
    render();
  },
  tag(el) {
    ui.tag = el.dataset.datum;
    render();
  },
  "schicht-neu": () => sheetSchicht(),
  "schicht-bearbeiten": (el) => sheetSchicht(finde(daten.schichten, el.dataset.id)),
  "schicht-loeschen": (el) => loeschen("schichten", el.dataset.id, "Diese Schicht löschen?"),
  "abo-neu": () => sheetAbo(),
  "abo-bearbeiten": (el) => sheetAbo(finde(daten.abos, el.dataset.id)),
  "abo-loeschen": (el) => loeschen("abos", el.dataset.id, "Dieses Abo löschen?"),
  "ausgabe-neu": () => sheetAusgabe(),
  "ausgabe-bearbeiten": (el) => sheetAusgabe(finde(daten.ausgaben, el.dataset.id)),
  "ausgabe-loeschen": (el) => loeschen("ausgaben", el.dataset.id, "Diese Ausgabe löschen?"),
  kontostand: () => sheetKontostand(),
  "todo-neu": () => sheetTodo(),
  "todo-bearbeiten": (el) => sheetTodo(finde(daten.todos, el.dataset.id)),
  "todo-loeschen": (el) => loeschen("todos", el.dataset.id, "Dieses To-do löschen?"),
  "todo-umschalten"(el) {
    const t = finde(daten.todos, el.dataset.id);
    t.erledigt = !t.erledigt;
    sichern();
  },
  "kuerzel-neu": () => sheetKuerzel(),
  "kuerzel-bearbeiten": (el) => sheetKuerzel(Number(el.dataset.index)),
  "kuerzel-loeschen"(el) {
    if (!confirm("Dieses Kürzel löschen?")) return;
    daten.einstellungen.kuerzel.splice(Number(el.dataset.id), 1);
    $sheet.close();
    sichern();
  },
  scan: () => sheetScan(),
  markieren: (el, ereignis) => markieren(el, ereignis),
  zoom(el) {
    $sheet.querySelector("[data-foto-flaeche]").style.width = `${Number(el.dataset.faktor) * 100}%`;
    $sheet.querySelectorAll('[data-aktion="zoom"]').forEach((k) => k.setAttribute("aria-pressed", String(k === el)));
  },
  "neu-markieren"() {
    scan.punkte = [];
    scan.ausschnitt = null;
    zeichneMarken();
    $sheet.querySelector("[data-schritt]").textContent = MARKIER_TEXTE[0];
    $sheet.querySelector("[data-ausschnitt]").hidden = true;
    $sheet.querySelector("[data-scan-senden]").disabled = true;
  },
  schliessen: () => $sheet.close(),
  export: () => teilenOderLaden(`kalender-sicherung-${heute}.json`, L.exportiere(daten), "application/json"),
  ics: () => teilenOderLaden(`schichten-${heute}.ics`, L.icsExport(daten.schichten), "text/calendar"),
  "alles-loeschen"() {
    if (!confirm("Alle Schichten, Abos, Ausgaben, To-dos und Einstellungen werden gelöscht. Das lässt sich nicht rückgängig machen.")) return;
    daten = L.leereDaten();
    sichern();
    zeigeHinweis("Alle Daten gelöscht");
  },
};

document.addEventListener("click", (ereignis) => {
  const el = ereignis.target.closest("[data-aktion]");
  if (el && AKTIONEN[el.dataset.aktion]) AKTIONEN[el.dataset.aktion](el, ereignis);
});

document.addEventListener("change", (ereignis) => {
  const el = ereignis.target;
  if (el.dataset.einstellung) einstellungAendern(el);
  else if (el.dataset.datei === "import") importieren(el);
  else if (el.name === "foto") {
    const anzeige = $sheet.querySelector("[data-foto-name]");
    if (anzeige) anzeige.textContent = el.files[0]?.name ?? "Foto auswählen oder aufnehmen";
  }
});

$sheet.addEventListener("input", (ereignis) => {
  const f = ereignis.target.form;
  if (f?.dataset.form === "schicht") vorschauSchicht();
  if (f?.dataset.form === "scan-uebernehmen") zaehleAuswahl(f);
});

$sheet.addEventListener("submit", (ereignis) => {
  ereignis.preventDefault();
  const f = ereignis.target;
  const art = f.dataset.form;
  if (art === "scan") return void scanStarten(f);
  if (art === "scan-markieren") return void scanSenden(f);
  if (art === "scan-uebernehmen") {
    if (scanUebernehmen(f) === false) return;
  } else if (SPEICHERN[art]) {
    const werte = Object.fromEntries(new FormData(f));
    if (SPEICHERN[art](werte, f.dataset.id, f) === false) return;
  }
  $sheet.close();
  sichern();
});

// Tippen neben das Sheet schließt es.
$sheet.addEventListener("click", (ereignis) => {
  if (ereignis.target === $sheet) $sheet.close();
});

$sheet.addEventListener("close", () => {
  scan?.abbruch?.abort();
  if (scan?.url) URL.revokeObjectURL(scan.url);
  scan = null;
});

// Wenn die App über Nacht offen bleibt, springt „heute“ weiter.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const neu = L.isoVon(new Date());
  if (neu !== heute) {
    heute = neu;
    render();
  }
});

let hinweisTimer;
function zeigeHinweis(text) {
  $hinweis.textContent = text;
  $hinweis.classList.add("sichtbar");
  clearTimeout(hinweisTimer);
  hinweisTimer = setTimeout(() => $hinweis.classList.remove("sichtbar"), 2500);
}

function sichern() {
  if (!speichern(daten)) zeigeHinweis("Speichern fehlgeschlagen. Ist der Speicher voll?");
  render();
}

// Nach dem Neuzeichnen bleibt der Fokus auf dem gleichen Bedienelement (wichtig für Tastatur und VoiceOver).
function fokusSchluessel(el) {
  if (!el?.dataset?.aktion) return null;
  const { aktion, datum, id, tab, n } = el.dataset;
  return `[data-aktion="${aktion}"]${datum ? `[data-datum="${datum}"]` : ""}${id ? `[data-id="${id}"]` : ""}${tab ? `[data-tab="${tab}"]` : ""}${n ? `[data-n="${n}"]` : ""}`;
}

function render() {
  const fokus = fokusSchluessel(document.activeElement);
  $app.innerHTML = ui.einstellungen ? ansichtEinstellungen() : { kalender: ansichtKalender, geld: ansichtGeld, todos: ansichtTodos }[ui.tab]();
  $tabbar.innerHTML = tabbar();
  if (fokus && !$sheet.open) document.querySelector(fokus)?.focus({ preventScroll: true });
}

render();
dauerhaftSpeichern();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
