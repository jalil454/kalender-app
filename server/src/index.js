// Kleiner Push-Server für die Kalender-App (Cloudflare Worker).
// Die App schickt ihre Erinnerungen (Zeitpunkt, Titel, kurzer Text) und ihr Push-Abo hierher.
// Alle 5 Minuten (Cron) verschickt der Server, was fällig ist. Andere App-Daten bekommt er nie.
import { senden } from "./webpush.js";

const SCHLUESSEL = "geraete"; // ein KV-Eintrag für alle Geräte; bei einer Person reicht das
// Nur echte Push-Dienste als Ziel, damit der Server keine beliebigen Adressen aufruft.
const PUSH_DIENSTE = ["push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com"];

async function hashVon(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gueltigesAbo(abo) {
  try {
    const host = new URL(abo.endpoint).hostname;
    return abo.endpoint.startsWith("https://") && PUSH_DIENSTE.some((d) => host === d || host.endsWith(`.${d}`)) && typeof abo.keys?.p256dh === "string" && typeof abo.keys?.auth === "string";
  } catch {
    return false;
  }
}

const gueltigeErinnerung = (e) =>
  typeof e?.id === "string" && e.id.length <= 120 && !Number.isNaN(Date.parse(e.zeit)) && typeof e.titel === "string" && e.titel.length <= 120 && typeof e.text === "string" && e.text.length <= 300;

const vapid = (env) => ({ oeffentlich: env.VAPID_OEFFENTLICH, privat: env.VAPID_PRIVAT });

export default {
  async fetch(request, env) {
    const herkunft = request.headers.get("origin") ?? "";
    const erlaubt = (env.ERLAUBT ?? "").split(",").map((s) => s.trim()).includes(herkunft);
    const kopf = erlaubt ? { "access-control-allow-origin": herkunft, "access-control-allow-methods": "POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" } : {};
    const json = (daten, status = 200) => new Response(JSON.stringify(daten), { status, headers: { "content-type": "application/json", ...kopf } });

    if (request.method === "OPTIONS") return new Response(null, { status: erlaubt ? 204 : 403, headers: kopf });
    if (!erlaubt) return json({ fehler: "Diese Adresse darf den Server nicht nutzen." }, 403);

    let k;
    try {
      k = await request.json();
    } catch {
      return json({ fehler: "Anfrage ist kein JSON." }, 400);
    }
    if (typeof k?.geraet !== "string" || typeof k.geheimnis !== "string" || k.geheimnis.length < 20) return json({ fehler: "Gerät oder Geheimnis fehlt." }, 400);

    const alle = (await env.KV.get(SCHLUESSEL, "json")) ?? {};
    const vorher = alle[k.geraet];
    const hash = await hashVon(k.geheimnis);
    if (vorher && vorher.geheimnisHash !== hash) return json({ fehler: "Falsches Geheimnis für dieses Gerät." }, 403);
    const pfad = new URL(request.url).pathname;

    if (pfad === "/abo" && request.method === "POST") {
      if (!gueltigesAbo(k.subscription) || !Array.isArray(k.erinnerungen)) return json({ fehler: "Push-Abo oder Erinnerungen ungültig." }, 400);
      const erinnerungen = k.erinnerungen.filter(gueltigeErinnerung).slice(0, 300);
      const ids = new Set(erinnerungen.map((e) => e.id));
      // Schon Verschicktes merken, solange es die Erinnerung noch gibt – sonst käme sie nach jedem Abgleich erneut.
      alle[k.geraet] = { geheimnisHash: hash, subscription: k.subscription, erinnerungen, gesendet: (vorher?.gesendet ?? []).filter((id) => ids.has(id)) };
      await env.KV.put(SCHLUESSEL, JSON.stringify(alle));
      return json({ ok: true, anzahl: erinnerungen.length });
    }

    if (pfad === "/test" && request.method === "POST") {
      if (!vorher) return json({ fehler: "Dieses Gerät ist nicht angemeldet." }, 404);
      const antwort = await senden(vorher.subscription, { titel: "Kalender", text: "Benachrichtigungen funktionieren." }, vapid(env), env.KONTAKT);
      return json({ ok: antwort.ok, status: antwort.status }, antwort.ok ? 200 : 502);
    }

    if (pfad === "/abo" && request.method === "DELETE") {
      delete alle[k.geraet];
      await env.KV.put(SCHLUESSEL, JSON.stringify(alle));
      return json({ ok: true });
    }

    return json({ fehler: "Unbekannte Anfrage." }, 404);
  },

  async scheduled(_ereignis, env, ctx) {
    ctx.waitUntil(faelligeSenden(env, Date.now()));
  },
};

// Verschickt alle fälligen Erinnerungen genau einmal. Was über 6 Stunden zu spät wäre, entfällt.
export async function faelligeSenden(env, jetzt, fetchFn = fetch) {
  const alle = (await env.KV.get(SCHLUESSEL, "json")) ?? {};
  let geaendert = false;
  let anzahl = 0;
  for (const [id, geraet] of Object.entries(alle)) {
    for (const e of geraet.erinnerungen) {
      const zeit = Date.parse(e.zeit);
      if (zeit > jetzt || zeit < jetzt - 6 * 3600e3 || geraet.gesendet.includes(e.id)) continue;
      const antwort = await senden(geraet.subscription, { titel: e.titel, text: e.text }, vapid(env), env.KONTAKT, fetchFn);
      if (antwort.status === 404 || antwort.status === 410) {
        delete alle[id]; // Abo gibt es nicht mehr (App gelöscht oder Benachrichtigungen aus)
        geaendert = true;
        break;
      }
      if (antwort.ok) {
        geraet.gesendet.push(e.id);
        anzahl++;
        geaendert = true;
      }
    }
    if (!alle[id]) continue;
    // Alte Erinnerungen aufräumen, damit der Eintrag klein bleibt.
    const vorher = geraet.erinnerungen.length;
    geraet.erinnerungen = geraet.erinnerungen.filter((e) => Date.parse(e.zeit) > jetzt - 24 * 3600e3);
    geraet.gesendet = geraet.gesendet.filter((g) => geraet.erinnerungen.some((e) => e.id === g));
    if (geraet.erinnerungen.length !== vorher) geaendert = true;
  }
  if (geaendert) await env.KV.put(SCHLUESSEL, JSON.stringify(alle));
  return anzahl;
}
