/**
 * Was die Leiste anbietet, aus dem Quelltext gelesen statt getippt.
 *
 * Anlass: Auf der Website lag einmal ein Bild einer Darstellung, die es im
 * veroeffentlichten Werkzeug noch nicht gab, und bei Umbra andersherum eines,
 * dessen Blatt schon entfernt war. Beide Male waren die Dateien in Ordnung —
 * auseinandergelaufen war die Behauptung, nicht die Auslieferung.
 *
 * Diese Zeile gehoert deshalb in jede Lieferungsmeldung. Getippt waere sie nur
 * eine weitere Erwartung; gelesen ist sie so verlaesslich wie eine Pruefsumme.
 *
 * Bricht laut ab, wenn sie nichts findet. Eine leere Zeile waere die
 * schlimmste Ausgabe: Sie saehe aus wie eine Auskunft.
 */
import { readFileSync } from 'node:fs';

const hier = new URL('.', import.meta.url).pathname;
const lies = (p) => readFileSync(hier + '../src/' + p, 'utf8');

const block = lies('lib/darstellung.ts').split('export const DARSTELLUNGEN')[1];
if (!block) throw new Error('DARSTELLUNGEN nicht gefunden — hat die Datei sich geaendert?');
const namen = [...block.split('export const')[0].matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);

const seite = lies('routes/+page.svelte');
const schalter = ['Beschriftung', 'Bäume'].filter((s) => seite.includes(`>${s}</button>`));

if (!namen.length) throw new Error('Keine Darstellung gelesen.');
if (!schalter.length) throw new Error('Keinen Schalter gelesen.');

console.log(`Darstellungen: ${namen.join(' · ')}`);
console.log(`Schalter: ${schalter.join(' · ')}`);
