// Dienstplan-Foto lesen: Bild verkleinern, an Groq schicken, Antwort in Schichten übersetzen.
import { istDatum, istZeit } from "./logic.js";

// Groq (OpenAI-kompatibel), kostenloser Tarif; qwen3.8-27b ist dort das Modell, das Bilder liest.
const ENDPUNKT = "https://api.groq.com/openai/v1/chat/completions";
const MODELL = "qwen/qwen3.8-27b";

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
  return `Das Bild zeigt einen Dienstplan. Das Foto kann gedreht sein. Heute ist der ${heute}.

Finde die Person „${name}“ und liste jeden Tag, an dem sie laut Plan arbeitet.

- Der Name kann anders geschrieben sein: nur Nachname, „Nachname, Vorname“, Initialen oder ein Kürzel. Nimm die Zeile oder Spalte, die eindeutig passt, und schreib die Schreibweise aus dem Plan in name_im_plan. Passt keine eindeutig, setz name_gefunden auf false und lass schichten leer.
- Die Tabelle kann schief fotografiert sein. Folge der Zeile der Person an den Linien entlang über alle Spalten, damit du nicht in die Zeile darüber oder darunter rutschst.
- Lies das Datum aus den Kopfzeilen oder Kopfspalten. Ein zweistelliges Jahr wie „26“ heißt 2026. Fehlt das Jahr, nimm das Jahr, das am nächsten an heute liegt. Format JJJJ-MM-TT.
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

// Fotos vom iPhone sind groß; 2000 px an der langen Kante reichen zum Lesen einer Tabelle.
export async function bildVorbereiten(datei, maxKante = 2000) {
  const url = URL.createObjectURL(datei);
  try {
    // onload statt decode(): decode() wartet, solange die Seite verdeckt ist (z. B. App gewechselt).
    const bild = await new Promise((fertig, fehler) => {
      const b = new Image();
      b.onload = () => fertig(b);
      b.onerror = fehler;
      b.src = url;
    });
    const faktor = Math.min(1, maxKante / Math.max(bild.naturalWidth, bild.naturalHeight));
    const leinwand = document.createElement("canvas");
    leinwand.width = Math.round(bild.naturalWidth * faktor);
    leinwand.height = Math.round(bild.naturalHeight * faktor);
    leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
    return leinwand.toDataURL("image/jpeg", 0.85).split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function analysiereDienstplan({ apiKey, bild, name, heute, kuerzel, signal }) {
  let antwort;
  try {
    antwort = await fetch(ENDPUNKT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELL,
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
        // jsonAusText liest das JSON tolerant aus. Die Denkschritte brauchen wir nicht.
        reasoning_format: "hidden",
        // Versteckte Denkschritte zählen zum Ausgabe-Limit; bei "medium" wurde die Antwort abgeschnitten.
        reasoning_effort: "low",
        max_completion_tokens: 16384, // Maximum dieses Modells
      }),
      signal,
    });
  } catch (fehler) {
    if (fehler.name === "AbortError") throw new Error("Abgebrochen.");
    throw new Error("Keine Verbindung zu Groq. Bist du online?");
  }
  const daten = await antwort.json().catch(() => null);
  if (!antwort.ok) throw new Error(fehlerText(antwort.status, daten?.error?.message ?? ""));
  const wahl = daten?.choices?.[0];
  if (wahl?.finish_reason === "length") throw new Error("Groq hat die Antwort abgebrochen, weil sie zu lang wurde. Versuch es noch einmal.");
  return jsonAusText(wahl?.message?.content ?? "");
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

function fehlerText(status, meldung) {
  if (status === 401) return "Der API-Key ist ungültig.";
  if (status === 403) return "Der API-Key darf dieses Modell nicht nutzen (console.groq.com).";
  if (status === 413) return "Das Foto ist zu groß.";
  if (status === 429) return "Das kostenlose Limit ist erreicht. Warte eine Minute und versuch es noch einmal.";
  if (status >= 500) return "Groq ist gerade gestört. Versuch es später noch einmal.";
  return `Anfrage abgelehnt (${status}): ${meldung}`;
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
