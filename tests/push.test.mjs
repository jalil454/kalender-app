// G15: Verschlüsselung (RFC 8291) gegen das offizielle Beispiel aus dem RFC, Hin- und Rückweg
// mit eigenem Schlüssel und gültige VAPID-Signatur (RFC 8292).
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlZuBytes, bytesZuB64url, verschluesseln, vapidKopf } from "../server/src/webpush.js";
import { empfaenger, entschluesseln } from "./push-empfaenger.mjs";

// Werte aus RFC 8291, Anhang A (wörtlich übernommen)
const RFC = {
  klartext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asOeffentlich: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivat: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaOeffentlich: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivat: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdh: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkSchluessel: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  koerper:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("RFC 8291 Anhang A: alle Zwischenwerte und der fertige Nachrichtenkörper stimmen", async () => {
  const { koerper, zwischen } = await verschluesseln(b64urlZuBytes(RFC.klartext), { p256dh: RFC.uaOeffentlich, auth: RFC.auth }, {
    salt: b64urlZuBytes(RFC.salt),
    asPrivat: RFC.asPrivat,
    asOeffentlich: b64urlZuBytes(RFC.asOeffentlich),
  });
  assert.equal(bytesZuB64url(zwischen.ecdhGeheimnis), RFC.ecdh);
  assert.equal(bytesZuB64url(zwischen.prkSchluessel), RFC.prkSchluessel);
  assert.equal(bytesZuB64url(zwischen.ikm), RFC.ikm);
  assert.equal(bytesZuB64url(zwischen.prk), RFC.prk);
  assert.equal(bytesZuB64url(zwischen.cek), RFC.cek);
  assert.equal(bytesZuB64url(zwischen.nonce), RFC.nonce);
  assert.equal(bytesZuB64url(koerper), RFC.koerper);
});

test("Hin und zurück: eine deutsche Nachricht kommt beim Empfänger unverändert an, jedes Mal anders verschlüsselt", async () => {
  const e = await empfaenger();
  const nachricht = JSON.stringify({ titel: "Schicht in 1 Stunde", text: "09:00–14:01 · Kasse" });
  const a = await verschluesseln(nachricht, e.keys);
  const b = await verschluesseln(nachricht, e.keys);
  assert.notEqual(bytesZuB64url(a.koerper), bytesZuB64url(b.koerper)); // neues salt und Schlüsselpaar pro Nachricht
  assert.equal(await entschluesseln(a.koerper, e.privatJwk, e.roh, e.auth), nachricht);
  assert.equal(await entschluesseln(b.koerper, e.privatJwk, e.roh, e.auth), nachricht);
});

test("Kontrolle: mit falschem auth-Geheimnis lässt sich die Nachricht nicht entschlüsseln", async () => {
  const e = await empfaenger();
  const { koerper } = await verschluesseln("geheim", e.keys);
  await assert.rejects(entschluesseln(koerper, e.privatJwk, e.roh, crypto.getRandomValues(new Uint8Array(16))));
});

test("VAPID: Token ist mit dem Server-Schlüssel signiert und enthält Push-Dienst, Ablauf und Kontakt", async () => {
  const paar = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const oeffentlich = bytesZuB64url(await crypto.subtle.exportKey("raw", paar.publicKey));
  const privat = (await crypto.subtle.exportKey("jwk", paar.privateKey)).d;
  const jetzt = Date.UTC(2026, 10, 7, 7, 0, 0);
  const kopf = await vapidKopf("https://web.push.apple.com/QGxyz123", { oeffentlich, privat }, "https://jalil454.github.io/kalender-app/", jetzt);
  const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(kopf);
  assert.equal(k, oeffentlich);
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlZuBytes(h))), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlZuBytes(p))), { aud: "https://web.push.apple.com", exp: jetzt / 1000 + 43200, sub: "https://jalil454.github.io/kalender-app/" });
  const pruef = await crypto.subtle.importKey("raw", b64urlZuBytes(oeffentlich), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const daten = new TextEncoder().encode(`${h}.${p}`);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pruef, b64urlZuBytes(s), daten), true);
  // Kontrolle: veränderter Inhalt muss die Prüfung scheitern lassen
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pruef, b64urlZuBytes(s), new TextEncoder().encode(`${h}.${p}x`)), false);
});
