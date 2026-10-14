import { dxfEbene } from '../vertrag';
import { type Gelaende, feldImRahmen, hoehenlinien, aequidistanz } from '../geo/gelaende';
import type { Objekt } from '../osm';
import { alleRinge } from '../zeichnen';
import type { Rahmen } from '../geo/rahmen';
import { STIFTE, stift } from '../stifte';

/**
 * DXF R12, von Hand geschrieben. Bewusst ohne Bibliothek: Das Format ist
 * an dieser Stelle schlicht, und eine selbstgeschriebene Datei laesst sich
 * lesen, wenn Rhino sie eines Tages nicht mag.
 *
 * Koordinaten sind Meter im Ortsgitter, der Ursprung liegt auf der linken
 * unteren Rahmenecke, Y zeigt nach Norden. Damit passt die Zeichnung ohne
 * Verschiebung und ohne Drehung zum Bild.
 */
const p = (code: number, wert: string | number) => `${code}\n${wert}\n`;

/**
 * DXF R12 kennt kein UTF-8, sondern eine Codepage. Zeichen jenseits von ASCII
 * schreibt man deshalb als Unicode-Fluchtfolge, die AutoCAD und Rhino beide
 * verstehen. Ohne das wird aus "Nový prístav" ein "NovÃ½ prÃ­stav".
 */
const text = (s: string) =>
	s.replace(/[\r\n]/g, ' ').replace(/[^\x20-\x7E]/g, (c) =>
		'\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));

/**
 * Mit Gelände kommen Höhenlinien dazu, auf zwei eigenen Ebenen und auf ihrer
 * Höhe über dem Meer. Der Plan selbst bleibt auf null, wie bisher.
 */
export function alsDxf(objekte: Objekt[], r: Rahmen, mitGestrichenen = false, gelaende: Gelaende | null = null): string {
	const linien = gelaende ? (() => {
		const f = feldImRahmen(gelaende, r);
		return hoehenlinien(f, aequidistanz(f.max - f.min));
	})() : [];
	let s = '';
	// Kopf mit Zeichnungsgrenzen
	s += p(0, 'SECTION') + p(2, 'HEADER');
	s += p(9, '$EXTMIN') + p(10, 0) + p(20, 0) + p(30, 0);
	s += p(9, '$EXTMAX') + p(10, r.breiteM.toFixed(3)) + p(20, r.hoeheM.toFixed(3)) + p(30, 0);
	s += p(9, '$INSUNITS') + p(70, 6); // Meter
	s += p(0, 'ENDSEC');

	// Ebenentabelle. Dieselbe Stifttabelle wie auf dem Bildschirm.
	s += p(0, 'SECTION') + p(2, 'TABLES') + p(0, 'TABLE') + p(2, 'LAYER') + p(70, STIFTE.length + 1 + (gelaende ? 2 : 0));
	for (const st of STIFTE) {
		s += p(0, 'LAYER') + p(2, dxfEbene(st.dxf)) + p(70, 0) + p(62, st.dxfFarbe) + p(6, 'CONTINUOUS');
	}
	s += p(0, 'LAYER') + p(2, dxfEbene('N_BESCHRIFTUNG')) + p(70, 0) + p(62, 8) + p(6, 'CONTINUOUS');
	if (gelaende) {
		s += p(0, 'LAYER') + p(2, dxfEbene('N_HOEHENLINIE')) + p(70, 0) + p(62, 33) + p(6, 'CONTINUOUS');
		s += p(0, 'LAYER') + p(2, dxfEbene('N_HOEHENLINIE_HAUPT')) + p(70, 0) + p(62, 32) + p(6, 'CONTINUOUS');
	}
	s += p(0, 'ENDTAB') + p(0, 'ENDSEC');

	s += p(0, 'SECTION') + p(2, 'ENTITIES');
	const versatz = (x: number, y: number): [number, number] => [x - r.x0, y - r.y0];

	for (const o of objekte) {
		if (o.zustand === 'gestrichen' && !mitGestrichenen) continue;
		const ebene = o.zustand === 'gestrichen' ? dxfEbene(stift('gestrichen').dxf) : dxfEbene(stift(o.ebene).dxf);
		for (const ring of alleRinge(o)) {
			if (ring.length < 2) continue;
			s += p(0, 'POLYLINE') + p(8, ebene) + p(66, 1) + p(70, o.art === 'flaeche' ? 1 : 0);
			for (const [x, y] of ring) {
				const [vx, vy] = versatz(x, y);
				s += p(0, 'VERTEX') + p(8, ebene) + p(10, vx.toFixed(3)) + p(20, vy.toFixed(3)) + p(30, '0.0');
			}
			s += p(0, 'SEQEND') + p(8, ebene);
		}
	}
	// Namen als Text auf eigener Ebene. In CAD abschaltbar, im Plan lesbar.
	const tl = dxfEbene('N_BESCHRIFTUNG');
	for (const o of objekte) {
		if (!o.name || o.zustand === 'gestrichen') continue;
		if (!['strasse', 'wasser', 'gruen', 'gebaeude', 'erhalt'].includes(o.ebene)) continue;
		const ring = o.ringe[0];
		if (!ring?.length) continue;
		let sx = 0, sy = 0;
		for (const [x, y] of ring) { sx += x; sy += y; }
		const [vx, vy] = versatz(sx / ring.length, sy / ring.length);
		if (vx < 0 || vy < 0 || vx > r.breiteM || vy > r.hoeheM) continue;
		s += p(0, 'TEXT') + p(8, tl)
			+ p(10, vx.toFixed(2)) + p(20, vy.toFixed(2)) + p(30, '0.0')
			+ p(40, Math.max(3, r.breiteM / 260).toFixed(2))
			+ p(1, text(o.name));
	}

	// Höhenlinien, jede auf ihrer Höhe
	for (const l of linien) {
		const ebene = dxfEbene(l.haupt ? 'N_HOEHENLINIE_HAUPT' : 'N_HOEHENLINIE');
		const z = l.hoehe.toFixed(2);
		s += p(0, 'POLYLINE') + p(8, ebene) + p(66, 1) + p(10, '0.0') + p(20, '0.0') + p(30, z) + p(70, l.geschlossen ? 1 : 0);
		for (const [x, y] of l.punkte)
			s += p(0, 'VERTEX') + p(8, ebene) + p(10, x.toFixed(3)) + p(20, y.toFixed(3)) + p(30, z);
		s += p(0, 'SEQEND') + p(8, ebene);
	}

	// Der Rahmen selbst, damit die Zeichnung ihre Grenze kennt
	const rl = dxfEbene(stift('rahmen').dxf);
	s += p(0, 'POLYLINE') + p(8, rl) + p(66, 1) + p(70, 1);
	for (const [x, y] of [[0, 0], [r.breiteM, 0], [r.breiteM, r.hoeheM], [0, r.hoeheM]])
		s += p(0, 'VERTEX') + p(8, rl) + p(10, x.toFixed(3)) + p(20, y.toFixed(3)) + p(30, '0.0');
	s += p(0, 'SEQEND') + p(8, rl);

	s += p(0, 'ENDSEC') + p(0, 'EOF');
	return s;
}
