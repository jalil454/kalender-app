// Speichert die App-Daten im Browser dieses Geräts (localStorage).
import { leereDaten, mitStandardwerten } from "./logic.js";

const SCHLUESSEL = "kalender-app-v1";

export function laden() {
  let roh = null;
  try {
    roh = localStorage.getItem(SCHLUESSEL);
    return roh ? mitStandardwerten(JSON.parse(roh)) : leereDaten();
  } catch {
    // Unlesbare Daten nicht überschreiben, sondern beiseitelegen.
    try {
      if (roh) localStorage.setItem(`${SCHLUESSEL}-defekt`, roh);
    } catch {}
    return leereDaten();
  }
}

export function speichern(daten) {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(daten));
    return true;
  } catch {
    return false;
  }
}

// Bittet den Browser, die Daten nicht von selbst zu löschen.
export function dauerhaftSpeichern() {
  navigator.storage?.persist?.().catch(() => {});
}
