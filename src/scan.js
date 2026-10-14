// Dienstplan-Foto lesen: Bild verkleinern, an Claude schicken, Antwort in Schichten übersetzen.
import { istDatum, istZeit } from "./logic.js";

// Offizielles Anthropic-SDK, erst beim Scannen aus dem Netz geladen. Version fest, damit sich nichts unbemerkt ändert.
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
const MODELL = "claude-opus-5-5";

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
  return `Das Bild zeigt einen Dienstplan. Heute ist der ${heute}.

Finde die Person „${name}“ und liste jeden Tag, an dem sie laut Plan arbeitet.

- Der Name kann anders geschrieben sein: nur Nachname, „Nachname, Vorname“, Initialen oder ein Kürzel. Nimm die Zeile oder Spalte, die eindeutig passt, und schreib die Schreibweise aus dem Plan in name_im_plan. Passt keine eindeutig, setz name_gefunden auf false und lass schichten leer.
- Lies das Datum aus den Kopfzeilen oder Kopfspalten. Fehlt das Jahr, nimm das Jahr, das am nächsten an heute liegt. Format JJJJ-MM-TT.
- Steht eine Uhrzeit da (zum Beispiel „8-16:30“ oder „08:00–16:30“), schreib beginn und ende als HH:MM.
- Steht nur ein Kürzel da (zum Beispiel „F“, „S“, „N“), schreib es in kuerzel und lass beginn und ende leer. Steht beides da, füll beides aus.
- Steht eine Pause im Plan, schreib sie in Minuten in pause_min, sonst 0.
- Lass Tage ohne Arbeit weg: frei, Urlaub, krank, Feiertag, leere Zellen, Striche.
- roh ist der Zellinhalt genau wie im Bild.
- Wenn etwas unsicher ist (unscharf, abgeschnitten, schwer zuzuordnen), beschreib es kurz in hinweis, sonst leerer Text.
${bekannte}`;
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
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
  } catch {
    throw new Error("Claude ist gerade nicht erreichbar. Bist du online?");
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let antwort;
  try {
    antwort = await client.beta.messages.create(
      {
        model: MODELL,
        max_tokens: 16000,
        // Lehnt das Modell ab, versucht die API es automatisch mit dem empfohlenen Ersatzmodell.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bild } },
              { type: "text", text: anweisung(name, heute, kuerzel) },
            ],
          },
        ],
      },
      { signal },
    );
  } catch (fehler) {
    throw new Error(fehlerText(Anthropic, fehler));
  }
  if (antwort.stop_reason === "refusal") throw new Error("Claude hat die Anfrage abgelehnt. Versuch es mit einem anderen Foto.");
  if (antwort.stop_reason === "max_tokens") throw new Error("Die Antwort ist unvollständig. Versuch einen kleineren Ausschnitt.");
  const block = antwort.content.find((b) => b.type === "text");
  try {
    return JSON.parse(block?.text ?? "");
  } catch {
    throw new Error("Die Antwort konnte nicht gelesen werden.");
  }
}

function fehlerText(Anthropic, fehler) {
  if (fehler instanceof Anthropic.APIUserAbortError) return "Abgebrochen.";
  if (fehler instanceof Anthropic.AuthenticationError) return "Der API-Key ist ungültig.";
  if (fehler instanceof Anthropic.PermissionDeniedError) return "Der API-Key darf dieses Modell nicht nutzen.";
  if (fehler instanceof Anthropic.RateLimitError) return "Zu viele Anfragen. Warte kurz und versuch es noch einmal.";
  if (fehler instanceof Anthropic.BadRequestError) return `Anfrage abgelehnt: ${fehler.message}`;
  if (fehler instanceof Anthropic.APIConnectionError) return "Keine Verbindung zu Claude. Bist du online?";
  if (fehler instanceof Anthropic.APIError) return `Fehler von Claude (${fehler.status ?? "?"}): ${fehler.message}`;
  return fehler?.message ?? "Unbekannter Fehler.";
}

// Übersetzt die Antwort in Vorschläge. Nichts wird gespeichert, bevor ich es bestätige.
export function scanZuSchichten(antwort, einstellungen, vorhandene) {
  const kuerzel = new Map(einstellungen.kuerzel.map((k) => [k.code.trim().toUpperCase(), k]));
  const eintraege = [];
  for (const roh of antwort.name_gefunden ? antwort.schichten ?? [] : []) {
    if (!istDatum(roh.datum)) continue;
    const k = kuerzel.get((roh.kuerzel ?? "").trim().toUpperCase());
    const zeitenAusPlan = istZeit(roh.beginn) && istZeit(roh.ende);
    const beginn = zeitenAusPlan ? roh.beginn : k?.beginn ?? "";
    const ende = zeitenAusPlan ? roh.ende : k?.ende ?? "";
    const pause = roh.pause_min > 0 ? roh.pause_min : k ? k.pause : einstellungen.standardPause;
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
