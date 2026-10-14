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

// Seit die Oberfläche zweisprachig ist, stehen die Aufschriften im
// Wörterbuch und nicht mehr auf der Seite. Gelesen wird deshalb beides: die
// Reihenfolge aus dem Quelltext, die Namen aus `sprache.svelte.ts`, je Sprache.
const sprache = lies('lib/sprache.svelte.ts');
const teil = {
	de: sprache.slice(sprache.indexOf('const de = {'), sprache.indexOf('const en: typeof de = {')),
	en: sprache.slice(sprache.indexOf('const en: typeof de = {'))
};
/** Ein Eintrag `abschnitt.schluessel` im Wörterbuch einer Sprache. */
const wort = (sp, abschnitt, schluessel) => {
	const ab = teil[sp].slice(teil[sp].search(new RegExp(`\\n\\t${abschnitt}: \\{`)));
	const m = new RegExp(`\\b${schluessel}: \\{? ?(?:name: )?'([^']+)'`).exec(ab);
	if (!m) throw new Error(`Kein Wort für ${sp}.${abschnitt}.${schluessel}`);
	return m[1];
};

const block = lies('lib/darstellung.ts').split('export const DARSTELLUNGEN')[1];
if (!block) throw new Error('DARSTELLUNGEN nicht gefunden — hat die Datei sich geaendert?');
const ids = [...block.split('export const')[0].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);

// Die Schalter der Sichtleiste: Knöpfe der Klasse `einzeln`, deren Aufschrift
// aus dem Wörterbuch kommt.
const seite = lies('routes/+page.svelte');
const schalter = [...seite.matchAll(/class="einzeln"[\s\S]*?>\{(?:[^{}]*\? [^{}]*: )?t\(\)\.([a-z]+)\.([a-zA-Z]+)\}<\/button>/g)]
	.map((m) => [m[1], m[2]]);

if (!ids.length) throw new Error('Keine Darstellung gelesen.');
if (!schalter.length) throw new Error('Keinen Schalter gelesen.');

for (const sp of ['de', 'en']) {
	console.log(`Darstellungen (${sp}): ${ids.map((id) => wort(sp, 'darstellungen', id)).join(' · ')}`);
	console.log(`Schalter (${sp}): ${schalter.map(([a, k]) => wort(sp, a, k)).join(' · ')}`);
}
