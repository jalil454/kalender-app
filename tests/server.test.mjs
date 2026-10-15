// G17: Push-Server mit nachgebautem KV-Speicher und abgefangenen Push-Aufrufen.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { faelligeSenden } from "../server/src/index.js";
import { b64urlZuBytes, bytesZuB64url } from "../server/src/webpush.js";
import { empfaenger, entschluesseln } from "./push-empfaenger.mjs";

const APP = "https://jalil454.github.io";
const GEHEIMNIS = "ein-langes-zufaelliges-geheimnis-1234";

async function umgebung() {
  const paar = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const speicher = new Map();
  return {
    KV: {
      async get(k, art) {
        const w = speicher.get(k);
        return w === undefined ? null : art === "json" ? JSON.parse(w) : w;
      },
      async put(k, w) {
        speicher.set(k, w);
      },
    },
    ERLAUBT: `${APP},http://localhost:5174`,
    KONTAKT: "https://jalil454.github.io/kalender-app/",
    VAPID_OEFFENTLICH: bytesZuB64url(await crypto.subtle.exportKey("raw", paar.publicKey)),
    VAPID_PRIVAT: (await crypto.subtle.exportKey("jwk", paar.privateKey)).d,
    speicher,
  };
}

const anfrage = (env, pfad, inhalt, { methode = "POST", herkunft = APP } = {}) =>
  worker.fetch(new Request(`https://kalender-push.example.workers.dev${pfad}`, { method: methode, headers: { origin: herkunft, "content-type": "application/json" }, body: JSON.stringify(inhalt) }), env);

async function geraetAnmelden(env, erinnerungen, e) {
  const subscription = { endpoint: "https://web.push.apple.com/QGabc", keys: e.keys };
  return anfrage(env, "/abo", { geraet: "g1", geheimnis: GEHEIMNIS, subscription, erinnerungen });
}

function pushFaenger(status = 201) {
  const aufrufe = [];
  const fetchFn = async (url, init) => {
    aufrufe.push({ url, init });
    return new Response(null, { status });
  };
  return { aufrufe, fetchFn };
}

const jetzt = Date.parse("2026-11-07T07:02:00Z");
const ERINNERUNGEN = [
  { id: "s:a", zeit: "2026-11-07T07:00:00.000Z", titel: "Schicht in 1 Stunde", text: "09:00–14:01" }, // fällig
  { id: "s:b", zeit: "2026-11-07T09:00:00.000Z", titel: "Schicht in 1 Stunde", text: "11:00–15:00" }, // Zukunft
  { id: "t:alt", zeit: "2026-11-06T20:00:00.000Z", titel: "To-do fällig heute", text: "zu alt" }, // > 6 h zu spät
];

test("Anmeldung: nur von der App-Adresse, mit Geheimnis, nur echte Push-Dienste", async () => {
  const env = await umgebung();
  const e = await empfaenger();
  assert.equal((await geraetAnmelden(env, ERINNERUNGEN, e)).status, 200);
  const fremd = await anfrage(env, "/abo", { geraet: "g1", geheimnis: GEHEIMNIS, subscription: {}, erinnerungen: [] }, { herkunft: "https://boese.example" });
  assert.equal(fremd.status, 403);
  const falsch = await anfrage(env, "/abo", { geraet: "g1", geheimnis: "anderes-geheimnis-das-lang-genug-ist", subscription: { endpoint: "https://web.push.apple.com/x", keys: e.keys }, erinnerungen: [] });
  assert.equal(falsch.status, 403);
  const zielFremd = await anfrage(env, "/abo", { geraet: "g2", geheimnis: GEHEIMNIS, subscription: { endpoint: "https://boese.example/push", keys: e.keys }, erinnerungen: [] });
  assert.equal(zielFremd.status, 400);
  const gespeichert = JSON.parse(env.speicher.get("geraete"));
  assert.deepEqual(Object.keys(gespeichert), ["g1"]);
  assert.notEqual(gespeichert.g1.geheimnisHash, GEHEIMNIS); // nur der Hash wird gespeichert
});

test("CORS: Vorabfrage der App wird erlaubt, fremde Adresse nicht", async () => {
  const env = await umgebung();
  const vorab = (herkunft) => worker.fetch(new Request("https://x.workers.dev/abo", { method: "OPTIONS", headers: { origin: herkunft } }), env);
  const ok = await vorab(APP);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), APP);
  const nein = await vorab("https://boese.example");
  assert.equal(nein.status, 403);
  assert.equal(nein.headers.get("access-control-allow-origin"), null);
});

test("Cron: Fälliges wird genau einmal verschickt, Zukunft wartet, zu Altes entfällt", async () => {
  const env = await umgebung();
  const e = await empfaenger();
  await geraetAnmelden(env, ERINNERUNGEN, e);
  const f = pushFaenger();
  assert.equal(await faelligeSenden(env, jetzt, f.fetchFn), 1);
  assert.equal(await faelligeSenden(env, jetzt + 5 * 60e3, f.fetchFn), 0); // nächster Lauf: nichts doppelt
  assert.equal(f.aufrufe.length, 1);
  assert.equal(f.aufrufe[0].url, "https://web.push.apple.com/QGabc");
  const kopf = f.aufrufe[0].init.headers;
  assert.equal(kopf["content-encoding"], "aes128gcm");
  assert.equal(kopf.ttl, "86400");
  assert.match(kopf.authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.VAPID_OEFFENTLICH}$`));
  const inhalt = JSON.parse(await entschluesseln(f.aufrufe[0].init.body, e.privatJwk, e.roh, e.auth));
  assert.deepEqual(inhalt, { titel: "Schicht in 1 Stunde", text: "09:00–14:01" });
  // Zwei Stunden später ist die nächste dran.
  assert.equal(await faelligeSenden(env, Date.parse("2026-11-07T09:01:00Z"), f.fetchFn), 1);
});

test("Neuer Abgleich aus der App verschickt Gesendetes nicht nochmal", async () => {
  const env = await umgebung();
  const e = await empfaenger();
  await geraetAnmelden(env, ERINNERUNGEN, e);
  const f = pushFaenger();
  await faelligeSenden(env, jetzt, f.fetchFn);
  await geraetAnmelden(env, ERINNERUNGEN, e); // App öffnet sich und gleicht ab
  assert.equal(await faelligeSenden(env, jetzt + 60e3, f.fetchFn), 0);
});

test("Abgelaufenes Abo (410) wird entfernt", async () => {
  const env = await umgebung();
  await geraetAnmelden(env, ERINNERUNGEN, await empfaenger());
  await faelligeSenden(env, jetzt, pushFaenger(410).fetchFn);
  assert.deepEqual(JSON.parse(env.speicher.get("geraete")), {});
});

test("Abmelden löscht das Gerät, Test-Nachricht für unbekanntes Gerät wird abgelehnt", async () => {
  const env = await umgebung();
  await geraetAnmelden(env, ERINNERUNGEN, await empfaenger());
  assert.equal((await anfrage(env, "/abo", { geraet: "g1", geheimnis: GEHEIMNIS }, { methode: "DELETE" })).status, 200);
  assert.deepEqual(JSON.parse(env.speicher.get("geraete")), {});
  assert.equal((await anfrage(env, "/test", { geraet: "g1", geheimnis: GEHEIMNIS })).status, 404);
});

test("Kontrolle: Base64url-Umwandlung hin und zurück verliert nichts", async () => {
  assert.equal(b64urlZuBytes(bytesZuB64url(new Uint8Array([1, 2, 255]))).join(","), "1,2,255");
});
