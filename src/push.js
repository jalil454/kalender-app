// Push-Nachrichten: beim Browser ein Push-Abo holen und die Erinnerungen an den eigenen Server schicken.
// Der Server (server/) bekommt nur Zeitpunkt, Titel und kurzen Text jeder Erinnerung.
import { erinnerungen } from "./logic.js";

// Wird beim Einrichten des Servers gesetzt (Adresse des Workers und öffentlicher VAPID-Schlüssel).
export const SERVER = "https://kalender-push.kalender-push.workers.dev";
export const VAPID_OEFFENTLICH = "BJqG3wLHDpSEFpLslfHDmzsh8i3yNKDLBRBg5h2Wxaoxk_-mLxB4SDptGf0SiJ4X6rmuK-sws-7qd11TXJn3Yak";

export const pushEingerichtet = () => Boolean(SERVER && VAPID_OEFFENTLICH);
export const pushMoeglich = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const istIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const istHomeBildschirm = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function zufall() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function schluesselBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (z) => z.charCodeAt(0));
}

async function anServer(pfad, methode, inhalt) {
  let antwort;
  try {
    antwort = await fetch(SERVER + pfad, { method: methode, headers: { "content-type": "application/json" }, body: JSON.stringify(inhalt) });
  } catch {
    throw new Error("Der Benachrichtigungs-Server ist nicht erreichbar. Bist du online?");
  }
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) throw new Error(daten.fehler ?? `Server-Fehler ${antwort.status}`);
  return daten;
}

async function aktuellesAbo() {
  return (await navigator.serviceWorker.ready).pushManager.getSubscription();
}

// Muss direkt aus einem Tippen heraus aufgerufen werden, sonst fragt iOS nicht nach der Erlaubnis.
export async function einschalten(daten) {
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== "granted") throw new Error("Benachrichtigungen sind nicht erlaubt. Du kannst sie in den iPhone-Einstellungen unter Mitteilungen erlauben.");
  const anmeldung = await navigator.serviceWorker.ready;
  const abo = (await anmeldung.pushManager.getSubscription()) ?? (await anmeldung.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(VAPID_OEFFENTLICH) }));
  const alt = daten.einstellungen.push;
  daten.einstellungen.push = { aktiv: true, geraet: alt.geraet || crypto.randomUUID(), geheimnis: alt.geheimnis || zufall() };
  await abgleichen(daten, abo);
}

export async function abgleichen(daten, abo = null) {
  const p = daten.einstellungen.push;
  if (!p.aktiv) return null;
  abo ??= await aktuellesAbo();
  if (!abo) throw new Error("Das Push-Abo fehlt. Schalte die Benachrichtigungen aus und wieder ein.");
  return anServer("/abo", "POST", { geraet: p.geraet, geheimnis: p.geheimnis, subscription: abo.toJSON(), erinnerungen: erinnerungen(daten, new Date()) });
}

export async function testSenden(daten) {
  const p = daten.einstellungen.push;
  return anServer("/test", "POST", { geraet: p.geraet, geheimnis: p.geheimnis });
}

export async function ausschalten(daten) {
  const p = daten.einstellungen.push;
  try {
    await anServer("/abo", "DELETE", { geraet: p.geraet, geheimnis: p.geheimnis });
  } finally {
    await (await aktuellesAbo())?.unsubscribe();
    daten.einstellungen.push = { ...p, aktiv: false };
  }
}
