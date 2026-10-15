// Testhilfe: Empfängerseite einer Push-Nachricht, unabhängig vom Sender-Code nachgebaut.
import assert from "node:assert/strict";
import { bytesZuB64url, hmac, verbinde } from "../server/src/webpush.js";

// Entschlüsselt wie das Handy.
export async function entschluesseln(koerper, uaPrivatJwk, uaOeffentlichRoh, authGeheimnis) {
  const salt = koerper.slice(0, 16);
  const laenge = koerper[20];
  const asOeffentlich = koerper.slice(21, 21 + laenge);
  const chiffre = koerper.slice(21 + laenge);
  const privat = await crypto.subtle.importKey("jwk", uaPrivatJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asSchluessel = await crypto.subtle.importKey("raw", asOeffentlich, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asSchluessel }, privat, 256));
  const t = new TextEncoder();
  const ikm = await hmac(await hmac(authGeheimnis, ecdh), verbinde(t.encode("WebPush: info\0"), uaOeffentlichRoh, asOeffentlich, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, verbinde(t.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, verbinde(t.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const klar = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, chiffre));
  let ende = klar.length - 1;
  while (klar[ende] === 0) ende--; // Auffüllung entfernen
  assert.equal(klar[ende], 2, "Trennzeichen 0x02 fehlt");
  return new TextDecoder().decode(klar.slice(0, ende));
}

export async function empfaenger() {
  const paar = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const roh = new Uint8Array(await crypto.subtle.exportKey("raw", paar.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys: { p256dh: bytesZuB64url(roh), auth: bytesZuB64url(auth) }, privatJwk: await crypto.subtle.exportKey("jwk", paar.privateKey), roh, auth };
}

