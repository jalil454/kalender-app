// Führt eine Testdatei aus und meldet das Ergebnis in einer eindeutigen Zeile für GATES.md.
// Aufruf: node tests/gate.mjs <suite>   (läuft tests/<suite>.test.mjs)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suite = process.argv[2] ?? "";
if (!/^[a-z]+$/.test(suite)) {
  console.error("Aufruf: node tests/gate.mjs <suite>");
  process.exit(2);
}

const datei = fileURLToPath(new URL(`./${suite}.test.mjs`, import.meta.url));
// Feste Zeitzone, damit Erinnerungszeiten (Sommer-/Winterzeit) auf jedem Rechner gleich geprüft werden.
const lauf = spawnSync(process.execPath, ["--test", "--test-reporter=tap", datei], { encoding: "utf8", env: { ...process.env, TZ: "Europe/Berlin" } });
process.stdout.write(lauf.stdout ?? "");
process.stderr.write(lauf.stderr ?? "");

const bestanden = Number(/^# pass (\d+)$/m.exec(lauf.stdout)?.[1] ?? 0);
const fehler = Number(/^# fail (\d+)$/m.exec(lauf.stdout)?.[1] ?? 1);
if (lauf.status === 0 && fehler === 0 && bestanden > 0) {
  console.log(`SUITE ${suite} BESTANDEN (${bestanden} Tests)`);
} else {
  console.log(`SUITE ${suite} FEHLGESCHLAGEN`);
  process.exit(1);
}
