// Web Push ohne Bibliothek: Anmeldung beim Push-Dienst (VAPID, RFC 8292) und
// Verschlüsselung der Nachricht (aes128gcm, RFC 8291). Läuft im Cloudflare Worker und in Node,
// weil beide WebCrypto haben.

const text = new TextEncoder();

export function b64urlZuBytes(wert) {
  const b64 = wert.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((wert.length + 3) % 4);
  return Uint8Array.from(atob(b64), (z) => z.charCodeAt(0));
}

export function bytesZuB64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function verbinde(...teile) {
  const ergebnis = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let stelle = 0;
  for (const t of teile) {
    ergebnis.set(t, stelle);
    stelle += t.length;
  }
  return ergebnis;
}

export async function hmac(schluessel, daten) {
  const k = await crypto.subtle.importKey("raw", schluessel, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, daten));
}

// Privater P-256-Schlüssel aus d (base64url) und dem öffentlichen Schlüssel (65 Byte, unkomprimiert).
function privatAlsJwk(d, oeffentlichRoh) {
  return { kty: "EC", crv: "P-256", d, x: bytesZuB64url(oeffentlichRoh.slice(1, 33)), y: bytesZuB64url(oeffentlichRoh.slice(33, 65)), ext: true };
}

// Verschlüsselt eine Nachricht für ein Push-Abo (keys.p256dh, keys.auth aus subscription.toJSON()).
// test erlaubt feste Werte (salt, Server-Schlüsselpaar), damit das RFC-Beispiel nachgerechnet werden kann.
export async function verschluesseln(nachricht, { p256dh, auth }, test = {}) {
  const uaOeffentlich = b64urlZuBytes(p256dh);
  const authGeheimnis = b64urlZuBytes(auth);
  const salt = test.salt ?? crypto.getRandomValues(new Uint8Array(16));
  let asPrivat;
  let asOeffentlich;
  if (test.asPrivat) {
    asOeffentlich = test.asOeffentlich;
    asPrivat = await crypto.subtle.importKey("jwk", privatAlsJwk(test.asPrivat, asOeffentlich), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const paar = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivat = paar.privateKey;
    asOeffentlich = new Uint8Array(await crypto.subtle.exportKey("raw", paar.publicKey));
  }
  const uaSchluessel = await crypto.subtle.importKey("raw", uaOeffentlich, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhGeheimnis = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaSchluessel }, asPrivat, 256));

  // RFC 8291, Abschnitt 3.4: erst mit auth zusammenführen, dann Schlüssel und Nonce ableiten.
  const prkSchluessel = await hmac(authGeheimnis, ecdhGeheimnis);
  const schluesselInfo = verbinde(text.encode("WebPush: info\0"), uaOeffentlich, asOeffentlich);
  const ikm = await hmac(prkSchluessel, verbinde(schluesselInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, verbinde(text.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, verbinde(text.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const klartext = verbinde(typeof nachricht === "string" ? text.encode(nachricht) : nachricht, new Uint8Array([2])); // 0x02 = letzter Datensatz
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, klartext));
  // Kopf: salt (16) · Datensatzgröße 4096 (4) · Länge des Schlüssels (1) · Server-Schlüssel (65)
  const kopf = verbinde(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asOeffentlich.length]), asOeffentlich);
  return { koerper: verbinde(kopf, chiffre), zwischen: { ecdhGeheimnis, prkSchluessel, ikm, prk, cek, nonce } };
}

// Authorization-Kopf für den Push-Dienst: signiertes Token (ES256) plus öffentlicher Schlüssel.
export async function vapidKopf(endpunkt, { oeffentlich, privat }, kontakt, jetzt = Date.now()) {
  const roh = b64urlZuBytes(oeffentlich);
  const schluessel = await crypto.subtle.importKey("jwk", privatAlsJwk(privat, roh), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const kopf = bytesZuB64url(text.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const inhalt = bytesZuB64url(text.encode(JSON.stringify({ aud: new URL(endpunkt).origin, exp: Math.floor(jetzt / 1000) + 12 * 3600, sub: kontakt })));
  const signatur = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, schluessel, text.encode(`${kopf}.${inhalt}`));
  return `vapid t=${kopf}.${inhalt}.${bytesZuB64url(signatur)}, k=${oeffentlich}`;
}

export async function senden(abo, nachricht, vapid, kontakt, fetchFn = fetch) {
  const { koerper } = await verschluesseln(JSON.stringify(nachricht), abo.keys);
  return fetchFn(abo.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidKopf(abo.endpoint, vapid, kontakt),
      ttl: "86400", // Push-Dienst hält die Nachricht bis zu einen Tag, falls das Handy offline ist
      urgency: "normal",
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
    },
    body: koerper,
  });
}
