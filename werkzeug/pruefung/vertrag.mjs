/**
 * Datenvertrag v2 gegen v1 halten.
 *
 * Drei Prüfungen, alle aus der Tabelle in `src/lib/vertrag.ts`:
 *
 * 1. Jede Tabelle ist umkehrbar. Zwei deutsche Namen auf einem englischen
 *    ließen die Gegenrichtung raten.
 * 2. Ein v2-Paket, mit der Gegenrichtung zurückgeführt, ist inhaltsgleich mit
 *    einem v1-Paket desselben Rahmens: jede Datei, jeder Wert, jedes Bild.
 *    Ausgenommen sind nur Texte, die bewusst übersetzt sind, und der
 *    Zeitstempel.
 * 3. Umbras Abschrift der Tabelle stimmt mit dieser überein.
 *
 *     node pruefung/vertrag.mjs <v1-ordner> <v2-ordner> [umbra.html]
 *     node pruefung/vertrag.mjs --tabelle      # die Abschrift für Umbra
 *
 * Die Ordner sind entpackte Pakete.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FELDER, WERTE, DARSTELLUNGEN_V2, DATEIEN, OBJ_NAMEN, DXF_EBENEN, pfadV2 } from '../src/lib/vertrag.ts';

const TABELLE = { FELDER, WERTE, DARSTELLUNGEN_V2, DATEIEN, OBJ_NAMEN, DXF_EBENEN };
if (process.argv[2] === '--tabelle') {
	console.log(JSON.stringify(TABELLE));
	process.exit(0);
}

let fehler = 0;
const melde = (s) => { fehler++; console.log('FEHLER', s); };
const umkehren = (m, name) => {
	const aus = {};
	for (const [a, b] of Object.entries(m)) {
		if (b in aus && aus[b] !== a) melde(`${name}: „${b}" steht für „${aus[b]}" und „${a}"`);
		aus[b] = a;
	}
	return aus;
};

// 1. Umkehrbar
const FELDER_V1 = umkehren(FELDER, 'FELDER');
const WERTE_V1 = Object.fromEntries(Object.entries(WERTE).map(([k, m]) => [k, umkehren(m, `WERTE.${k}`)]));
const DARST_V1 = umkehren(DARSTELLUNGEN_V2, 'DARSTELLUNGEN_V2');
umkehren(DATEIEN, 'DATEIEN');
umkehren(DXF_EBENEN, 'DXF_EBENEN');
umkehren(Object.fromEntries(OBJ_NAMEN), 'OBJ_NAMEN');
console.log('Tabellen umkehrbar:', fehler === 0);

const [v1, v2, umbra] = process.argv.slice(2);
if (!v1 || !v2) process.exit(fehler ? 1 : 0);

// 2. Inhaltsgleich
const dateien = (d) => {
	const aus = [];
	const lauf = (p) => {
		for (const n of fs.readdirSync(path.join(d, p))) {
			const q = path.join(p, n);
			if (fs.statSync(path.join(d, q)).isDirectory()) lauf(q); else aus.push(q);
		}
	};
	lauf('');
	return aus.sort();
};
const PFADFELDER = new Set(['datei', 'modell', 'zeichnung', 'aufsicht_grund_im_paket']);
const pfadV1 = (p) => {
	for (const n of dateien(v1)) if (pfadV2(n) === p) return n;
	return p;
};
/** v2 → v1, wie es Umbra tun muss. */
const aufV1 = (w, feld = '') => {
	if (Array.isArray(w)) return w.map((x) => aufV1(x, feld));
	if (w && typeof w === 'object') {
		if (feld === 'tags') return w;
		const aus = {};
		for (const [k, v] of Object.entries(w)) {
			const k1 = FELDER_V1[k] ?? k;
			aus[k1] = aufV1(v, k1);
		}
		return aus;
	}
	if (typeof w === 'string') {
		if (PFADFELDER.has(feld)) return pfadV1(w);
		if (feld === 'darstellung') return DARST_V1[w] ?? w;
		// Die Feldliste im Inhaltsverzeichnis nennt Feldnamen als Werte.
		if (feld === 'felder') return FELDER_V1[w] ?? w;
		return WERTE_V1[feld]?.[w] ?? w;
	}
	return w;
};
// Bewusst übersetzt oder bewusst verschieden — nicht vergleichen. `aufsicht`
// ist der Name des Einzeldownloads und trägt die Darstellung, also englisch.
const AUSNAHMEN = new Set(['erstellt', 'was', 'modell_namenszusaetze', 'bildformat', 'aufsicht']);
const gleich = (a, b, wo) => {
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return melde(`${wo}: Länge ${a.length} gegen ${b.length}`);
		a.forEach((x, i) => gleich(x, b[i], `${wo}[${i}]`));
		return;
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const ka = Object.keys(a).filter((k) => !AUSNAHMEN.has(k)).sort();
		const kb = Object.keys(b).filter((k) => !AUSNAHMEN.has(k)).sort();
		if (ka.join() !== kb.join()) return melde(`${wo}: Felder ${ka.join(',')} gegen ${kb.join(',')}`);
		for (const k of ka) gleich(a[k], b[k], `${wo}.${k}`);
		return;
	}
	if (a !== b) melde(`${wo}: ${JSON.stringify(a)?.slice(0, 80)} gegen ${JSON.stringify(b)?.slice(0, 80)}`);
};
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const neu = new Set(dateien(v2));
for (const p of dateien(v1)) {
	const q = pfadV2(p);
	if (!neu.has(q)) { melde(`${p} → ${q} fehlt im v2-Paket`); continue; }
	neu.delete(q);
	const a = path.join(v1, p), b = path.join(v2, q);
	if (p.endsWith('.json')) {
		let j1 = JSON.parse(fs.readFileSync(a, 'utf8'));
		let j2 = JSON.parse(fs.readFileSync(b, 'utf8'));
		if (p === 'frame.json') {
			if (j2.contract !== 'nolli' || j2.contract_version !== 2) melde('frame.json: contract/contract_version fehlt');
			const { contract, contract_version, ...rest } = j2; j2 = rest;
			const { nolli, ...rest1 } = j1; j1 = rest1;
		}
		const zurueck = aufV1(j2);
		if (p === 'frame.json') {
			// Nach v1 dazugekommen: das Gelände. Ohne Gelände steht `gelaende: null`
			// und der Vorbehalt `gelaende_eben`; ein v1-Paket kannte beides nicht.
			if (zurueck.gelaende === null) delete zurueck.gelaende;
			if (Array.isArray(zurueck.vorbehalte)) zurueck.vorbehalte = zurueck.vorbehalte.filter((v) => v !== 'gelaende_eben');
		}
		gleich(j1, zurueck, p);
	} else if (p.endsWith('.obj') || p.endsWith('.dxf')) {
		const zurueck = (t) => {
			let s = t;
			if (p.endsWith('.obj')) {
				s = s.split('\n').filter((z) => !z.startsWith('#')).map((z) =>
					z.startsWith('o ') ? OBJ_NAMEN.reduce((n, [d, e]) => n.replace(e, d), z) : z).join('\n');
			} else {
				for (const [d, e] of Object.entries(DXF_EBENEN)) s = s.replaceAll(`\n${e}\n`, `\n${d}\n`);
			}
			return s;
		};
		const t1 = fs.readFileSync(a, 'utf8').split('\n').filter((z) => !z.startsWith('#')).join('\n');
		if (zurueck(fs.readFileSync(b, 'utf8')) !== t1) melde(`${p}: Inhalt weicht ab`);
	} else if (p === 'bilder/3d-modell.webp') {
		// Die Raumansicht wird live gerendert und ist zwischen zwei Läufen nicht
		// pixelgleich, auch nicht v1 gegen v1. Geprüft wird nur, dass sie da ist.
	} else if (hash(a) !== hash(b)) melde(`${p}: Bild weicht ab`);
}
for (const q of neu) if (q !== 'README.md') melde(`${q} ist neu im v2-Paket und steht in keiner Tabelle`);
console.log('v2 inhaltsgleich mit v1:', fehler === 0);

// Keine deutschen Reste in v2: kein Feldname, der in der Tabelle als deutscher steht
const reste = new Set();
const suche = (w, feld = '') => {
	if (Array.isArray(w)) return w.forEach((x) => suche(x, feld));
	if (w && typeof w === 'object') {
		if (feld === 'tags') return;
		for (const [k, v] of Object.entries(w)) {
			if (k in FELDER && FELDER[k] !== k) reste.add(k);
			if (/[äöüß]/.test(k)) reste.add(k);
			suche(v, k);
		}
	}
};
for (const q of dateien(v2)) if (q.endsWith('.json')) suche(JSON.parse(fs.readFileSync(path.join(v2, q), 'utf8')));
if (reste.size) melde(`deutsche Feldnamen in v2: ${[...reste].join(', ')}`);

// 3. Umbras Abschrift
if (umbra) {
	const html = fs.readFileSync(umbra, 'utf8');
	const m = /const NOLLI_V2 = (\{.*\});/.exec(html);
	if (!m) melde('Umbra: keine Abschrift `const NOLLI_V2 = {…};` gefunden');
	else if (m[1] !== JSON.stringify(TABELLE)) melde('Umbra: Abschrift weicht von src/lib/vertrag.ts ab — mit --tabelle neu erzeugen');
	else console.log('Umbras Abschrift stimmt.');
}
console.log(fehler ? `${fehler} Fehler.` : 'Alles in Ordnung.');
process.exit(fehler ? 1 : 0);
