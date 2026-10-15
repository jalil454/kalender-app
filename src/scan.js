// Dienstplan-Foto lesen: Ausschnitt an Groq (und optional Mistral) schicken, Antworten in Schichten übersetzen.
import { istDatum, istZeit } from "./logic.js";

// Beide Anbieter sind OpenAI-kompatibel und haben kostenlose Tarife mit Modellen, die Bilder lesen.
// Mistral dient als Zweitmeinung, damit Lesefehler auffallen.
export const ANBIETER = {
  groq: {
    name: "Groq",
    endpunkt: "https://api.groq.com/openai/v1/chat/completions",
    modell: "qwen/qwen3.8-27b",
    // Versteckte Denkschritte zählen zum Ausgabe-Limit; bei "medium" wurde die Antwort abgeschnitten.
    extra: { reasoning_format: "hidden", reasoning_effort: "low", max_completion_tokens: 16384 },
  },
  mistral: {
    name: "Mistral",
    endpunkt: "https://api.mistral.ai/v1/chat/completions",
    modell: "mistral-large-2512", // Mistral Large 3, im Gratis-Tarif „Experiment“ enthalten
    extra: {},
  },
};

const SCHEMA = {
  type: "object",
  properties: {
    name_gefunden: { type: "boolean" },
    name_im_plan: { type: "string" },
    hinweis: { type: "string" },
    schichten: {
      type: "array",
      items: {
        type: "object",
        properties: {
          datum: { type: "string", format: "date" },
          beginn: { type: "string" },
          ende: { type: "string" },
          pause_min: { type: "integer" },
          kuerzel: { type: "string" },
          roh: { type: "string" },
        },
        required: ["datum", "beginn", "ende", "pause_min", "kuerzel", "roh"],
        additionalProperties: false,
      },
    },
  },
  required: ["name_gefunden", "name_im_plan", "hinweis", "schichten"],
  additionalProperties: false,
};

function anweisung(name, heute, kuerzel) {
  const bekannte = kuerzel.length ? `Bekannte Schichtkürzel in diesem Betrieb: ${kuerzel.map((k) => k.code).join(", ")}.` : "";
  return `Das Bild zeigt Ausschnitte aus einem Dienstplan. Heute ist der ${heute}.

Aufbau des Bildes: Es hat eine obere und eine untere Hälfte. In jeder Hälfte steht oben ein Streifen aus der Kopfzeile mit den Tagen und Daten und direkt darunter ein Streifen aus der Zeile einer Person. Die obere Hälfte zeigt den Anfang der Zeilen mit dem Namen, die untere Hälfte das Ende. Eine dunkle Linie trennt in jeder Hälfte die Kopfzeile von der Zeile der Person. Die Hälften überlappen sich etwas: Zähl einen Tag, der in beiden steht, nur einmal. Der Kopfzeilen-Streifen kann zusätzlich Teile der Nachbarzeilen zeigen; nimm daraus nur die Zeile mit den Tagen und Daten. Am Rand des Personen-Streifens können Nachbarzeilen angeschnitten sein; lies nur die Zeile in seiner Mitte.

Liste jeden Tag, an dem diese Person laut Plan arbeitet.

- Prüf, ob in der Personen-Zeile der Name „${name}“ steht. Die Schreibweise kann leicht abweichen, zum Beispiel „Nachname, Vorname“. Schreib den Namen aus dem Bild in name_im_plan. Steht dort eindeutig ein anderer Name, setz name_gefunden auf false und lass schichten leer.
- Ordne jede Zelle der Personen-Zeile dem Tag darüber in der Kopfzeile zu. Ein zweistelliges Jahr wie „26“ heißt 2026. Fehlt das Jahr, nimm das Jahr, das am nächsten an heute liegt. Format JJJJ-MM-TT.
- Steht eine Uhrzeit da (zum Beispiel „8-16:30“ oder „08:00–16:30“), schreib beginn und ende als HH:MM.
- Steht nur ein Kürzel da (zum Beispiel „F“, „S“, „N“), schreib es in kuerzel und lass beginn und ende leer. Steht ein Kürzel oder Bereich vor einer Uhrzeit (zum Beispiel „KA 16:00-18:00“), schreib das Kürzel in kuerzel und die Zeiten in beginn und ende.
- Pausen stehen oft als Stunden:Minuten neben der Zeit: „0:45“ sind 45 Minuten, „0:30“ sind 30, „0:00“ ist 0. Schreib die Pause in Minuten in pause_min. Steht gar keine Pause im Plan, schreib -1.
- Lass Tage ohne Arbeit weg: frei, abwesend, Urlaub, krank, Feiertag, leere Zellen, Striche.
- roh ist der Zellinhalt genau wie im Bild.
- Wenn etwas unsicher ist (unscharf, abgeschnitten, schwer zuzuordnen), beschreib es kurz in hinweis, sonst leerer Text.
${bekannte}

Antworte nur mit einem JSON-Objekt nach diesem JSON-Schema, ohne Codeblock und ohne weiteren Text:
${JSON.stringify(SCHEMA)}`;
}

// onload statt decode(): decode() wartet, solange die Seite verdeckt ist (z. B. App gewechselt).
export function ladeBild(url) {
  return new Promise((fertig, fehler) => {
    const bild = new Image();
    bild.onload = () => fertig(bild);
    bild.onerror = fehler;
    bild.src = url;
  });
}

// Aus drei Taps im Foto (Name, Ende der eigenen Zeile, irgendwo in der Kopfzeile) wird ein gerader Streifen:
// u zeigt entlang der Zeile, n senkrecht dazu. Das gleicht gedrehte und schiefe Fotos aus.
export function streifen(p1, p2, p3) {
  const laenge = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const u = { x: (p2.x - p1.x) / laenge, y: (p2.y - p1.y) / laenge };
  const n = { x: -u.y, y: u.x };
  // Der Name beginnt links vom Tap, die letzte Zelle endet kurz hinter dem Tap.
  const start = { x: p1.x - u.x * 0.15 * laenge, y: p1.y - u.y * 0.15 * laenge };
  const kopfVersatz = (p3.x - p1.x) * n.x + (p3.y - p1.y) * n.y;
  return {
    u,
    n,
    start,
    kopfStart: { x: start.x + n.x * kopfVersatz, y: start.y + n.y * kopfVersatz },
    kopfVersatz,
    laenge: 1.18 * laenge,
    halbeDicke: 0.016 * laenge, // etwa anderthalb Zeilenhöhen bei einem dicht beschriebenen Plan
    // Die Kopfzeile ist weit weg; bei schräg fotografiertem Blatt läuft sie nicht ganz parallel.
    // Ein dickerer Streifen fängt das ab, Nachbarzeilen stören dort nicht.
    kopfHalbeDicke: 0.04 * laenge,
  };
}

// Schneidet Kopfzeile und eigene Zeile gerade aus dem Foto in voller Auflösung und legt sie
// als zwei Hälften untereinander. So bekommt das Modell nur, was es braucht, und das gut lesbar.
export function ausschnittErstellen(bild, [p1, p2, p3]) {
  const g = streifen(p1, p2, p3);
  const breite = 1400;
  const ueberlapp = g.laenge * 0.04;
  const massstab = breite / (g.laenge / 2 + ueberlapp);
  const band = Math.round(2 * g.halbeDicke * massstab);
  const kopfBand = Math.round(2 * g.kopfHalbeDicke * massstab);
  const luecke = 10;
  const abstand = 28;
  const haelfte = kopfBand + luecke + band;
  const leinwand = document.createElement("canvas");
  leinwand.width = breite;
  leinwand.height = 2 * haelfte + abstand;
  const ctx = leinwand.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, leinwand.width, leinwand.height);
  const zeichne = (anfang, oben, halbeDicke) => {
    const hoehe = Math.round(2 * halbeDicke * massstab);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, oben, breite, hoehe);
    ctx.clip();
    // Bildpunkt p landet bei x = (p − anfang)·u und y = (p − anfang)·n + halbeDicke (mal Maßstab).
    ctx.setTransform(
      massstab * g.u.x,
      massstab * g.n.x,
      massstab * g.u.y,
      massstab * g.n.y,
      -massstab * (anfang.x * g.u.x + anfang.y * g.u.y),
      oben + massstab * (halbeDicke - (anfang.x * g.n.x + anfang.y * g.n.y)),
    );
    ctx.drawImage(bild, 0, 0);
    ctx.restore();
  };
  [0, g.laenge / 2 - ueberlapp].forEach((versatz, nummer) => {
    const schiebe = (p) => ({ x: p.x + g.u.x * versatz, y: p.y + g.u.y * versatz });
    const oben = nummer * (haelfte + abstand);
    zeichne(schiebe(g.kopfStart), oben, g.kopfHalbeDicke);
    // Dunkle Trennlinie: darüber Kopfzeile, darunter nur die eigene Zeile.
    ctx.fillStyle = "#3a3936";
    ctx.fillRect(0, oben + kopfBand, breite, luecke);
    zeichne(schiebe(g.start), oben + kopfBand + luecke, g.halbeDicke);
  });
  const url = leinwand.toDataURL("image/jpeg", 0.92);
  return { url, base64: url.split(",")[1] };
}

export async function analysiereDienstplan({ anbieter = "groq", apiKey, bild, name, heute, kuerzel, signal }) {
  const a = ANBIETER[anbieter];
  let antwort;
  try {
    antwort = await fetch(a.endpunkt, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: a.modell,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: anweisung(name, heute, kuerzel) },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bild}` } },
            ],
          },
        ],
        // Kein JSON-Modus: Groq lehnt sonst bei kleinsten Abweichungen die ganze Antwort ab (400).
        // jsonAusText liest das JSON tolerant aus.
        ...a.extra,
      }),
      signal,
    });
  } catch (fehler) {
    if (fehler.name === "AbortError") throw new Error("Abgebrochen.");
    throw new Error(`Keine Verbindung zu ${a.name}. Bist du online?`);
  }
  const daten = await antwort.json().catch(() => null);
  // Groq meldet Fehler in error.message, Mistral in message oder detail.
  const meldung = daten?.error?.message ?? daten?.message ?? (typeof daten?.detail === "string" ? daten.detail : "");
  if (!antwort.ok) throw new Error(fehlerText(a.name, antwort.status, meldung));
  const wahl = daten?.choices?.[0];
  if (wahl?.finish_reason === "length") throw new Error(`${a.name} hat die Antwort abgebrochen, weil sie zu lang wurde. Versuch es noch einmal.`);
  // Manche Modelle liefern den Text als Liste von Teilen statt als einen String.
  const inhalt = wahl?.message?.content;
  return jsonAusText(Array.isArray(inhalt) ? inhalt.filter((t) => t.type === "text").map((t) => t.text).join("") : inhalt ?? "");
}

// Holt das JSON-Objekt aus der Antwort, auch wenn es in einem Codeblock oder hinter Denktext steht.
export function jsonAusText(text) {
  const ohneDenken = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = ohneDenken.indexOf("{");
  const ende = ohneDenken.lastIndexOf("}");
  try {
    return JSON.parse(ohneDenken.slice(start, ende + 1));
  } catch {
    // Der Anfang der Antwort hilft bei der Fehlersuche.
    const anfang = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`Die Antwort konnte nicht gelesen werden.${anfang ? ` Anfang der Antwort: „${anfang}“` : ""}`);
  }
}

function fehlerText(name, status, meldung) {
  if (status === 401) return `Der ${name}-Key ist ungültig.`;
  if (status === 403) return `Der ${name}-Key darf dieses Modell nicht nutzen.`;
  if (status === 413) return "Das Foto ist zu groß.";
  if (status === 429) return `Das kostenlose Limit bei ${name} ist erreicht. Warte etwas und versuch es noch einmal.`;
  if (status >= 500) return `${name} ist gerade gestört. Versuch es später noch einmal.`;
  return `${name} hat abgelehnt (${status}): ${meldung}`;
}

// Übersetzt die Antwort in Vorschläge. Nichts wird gespeichert, bevor ich es bestätige.
const zeit = (t) => (/^\d:\d\d$/.test(String(t ?? "").trim()) ? `0${String(t).trim()}` : String(t ?? "").trim());

export function scanZuSchichten(antwort, einstellungen, vorhandene) {
  const kuerzel = new Map(einstellungen.kuerzel.map((k) => [k.code.trim().toUpperCase(), k]));
  const eintraege = [];
  for (const roh of antwort.name_gefunden ? antwort.schichten ?? [] : []) {
    if (!istDatum(roh.datum)) continue;
    const k = kuerzel.get((roh.kuerzel ?? "").trim().toUpperCase());
    const zeitenAusPlan = istZeit(zeit(roh.beginn)) && istZeit(zeit(roh.ende));
    const beginn = zeitenAusPlan ? zeit(roh.beginn) : k?.beginn ?? "";
    const ende = zeitenAusPlan ? zeit(roh.ende) : k?.ende ?? "";
    const pauseImPlan = roh.pause_min === "" || roh.pause_min == null ? -1 : Number(roh.pause_min);
    const pauseAusPlan = Number.isInteger(pauseImPlan) && pauseImPlan >= 0; // -1 heißt: keine Pause im Plan
    const pause = pauseAusPlan ? pauseImPlan : k ? k.pause : einstellungen.standardPause;
    const zeitenOk = istZeit(beginn) && istZeit(ende);
    const doppelt = zeitenOk && vorhandene.some((s) => s.datum === roh.datum && s.beginn === beginn);
    eintraege.push({
      datum: roh.datum,
      beginn: zeitenOk ? beginn : "",
      ende: zeitenOk ? ende : "",
      pause,
      kuerzel: roh.kuerzel ?? "",
      roh: roh.roh ?? "",
      status: !zeitenOk ? "unklar" : doppelt ? "doppelt" : "ok",
      auswahl: zeitenOk && !doppelt,
    });
  }
  eintraege.sort((a, b) => a.datum.localeCompare(b.datum) || a.beginn.localeCompare(b.beginn));
  return {
    nameGefunden: Boolean(antwort.name_gefunden),
    nameImPlan: antwort.name_im_plan ?? "",
    hinweis: antwort.hinweis ?? "",
    eintraege,
  };
}

// Vergleicht die Vorschläge zweier Modelle. Stimmen sie überein, bleibt alles wie es ist.
// Weichen sie ab oder sieht nur eines eine Schicht, wird der Eintrag als unsicher markiert
// und nicht vorausgewählt, damit ich selbst entscheide.
export function zweitmeinung(a, b, [nameA, nameB]) {
  const unsicher = (e, text) => ({ ...e, abweichung: text, auswahl: false });
  const zeit = (e) => `${e.beginn || "?"}–${e.ende || "?"}, ${e.pause} min Pause`;
  const hinweis = [a.hinweis && `${nameA}: ${a.hinweis}`, b.hinweis && `${nameB}: ${b.hinweis}`].filter(Boolean).join(" ");
  if (!a.nameGefunden && !b.nameGefunden) return { ...a, hinweis };
  if (!a.nameGefunden || !b.nameGefunden) {
    const [gefunden, wer] = a.nameGefunden ? [a, nameA] : [b, nameB];
    return { ...gefunden, hinweis, eintraege: gefunden.eintraege.map((e) => unsicher(e, `Nur ${wer} hat deinen Namen gefunden.`)) };
  }
  const proTag = (r) => r.eintraege.reduce((m, e) => m.set(e.datum, [...(m.get(e.datum) ?? []), e]), new Map());
  const tageA = proTag(a);
  const tageB = proTag(b);
  const eintraege = [];
  for (const datum of [...new Set([...tageA.keys(), ...tageB.keys()])].sort()) {
    const ea = tageA.get(datum) ?? [];
    const eb = tageB.get(datum) ?? [];
    const gleich = ea.length === eb.length && ea.every((e, i) => e.beginn === eb[i].beginn && e.ende === eb[i].ende && e.pause === eb[i].pause);
    if (gleich) eintraege.push(...ea.map((e) => ({ ...e, abweichung: "" })));
    else if (!eb.length) eintraege.push(...ea.map((e) => unsicher(e, `Nur ${nameA} sieht hier eine Schicht.`)));
    else if (!ea.length) eintraege.push(...eb.map((e) => unsicher(e, `Nur ${nameB} sieht hier eine Schicht.`)));
    else eintraege.push(...ea.map((e) => unsicher(e, `${nameB} liest: ${eb.map(zeit).join(" / ")}`)));
  }
  return { ...a, hinweis, eintraege };
}
