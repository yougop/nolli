import { dxfEbene } from '../vertrag';
import { type Gelaende, feldImRahmen, hoehenlinien, aequidistanz, aufsNetz, netzHoehe, tiefsteUnter } from '../geo/gelaende';
import { sichtEbene, type Objekt } from '../osm';
import { alleRinge } from '../zeichnen';
import type { Rahmen } from '../geo/rahmen';
import { STIFTE, stift } from '../stifte';
import { amRahmen, innerhalb, type Punkt } from '../schneiden';

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
 *
 * `aufGelaende` schreibt die zweite Fassung, `drawing_terrain.dxf`
 * (Volker, 03.11.2026): derselbe Plan, aber aufs Geländenetz von
 * `model.obj` gelegt, als 3D-Polylinien. Was man in Rhino sonst mit `_Pull`
 * selbst macht. Gebäudeumrisse liegen dabei eben auf der Fußhöhe ihres
 * Körpers, wie im Modell; eine Hauskante, die dem Hang folgt, stünde neben
 * der Wand. Die ebene Fassung bleibt daneben, weil sich nur ebene Kurven
 * schraffieren und extrudieren lassen.
 */
/** Ein Zug der Zeichnung in Rahmenkoordinaten: x, y, z in Metern. */
export type PlanZug = { ebene: string; punkte: [number, number, number][]; zu: boolean; flach: boolean };
export type PlanText = { text: string; x: number; y: number; z: number; hoehe: number };

/**
 * Was die Zeichnung enthält, unabhängig vom Dateiformat: Züge je Ebene, am
 * Rahmen geschnitten und auf Wunsch aufs Geländenetz gelegt, dazu die
 * Beschriftung und die Höhenlinien. `alsDxf` schreibt daraus DXF, `als3dm`
 * Rhino-Kurven — so zeigen beide genau dasselbe.
 */
export function planZuege(objekte: Objekt[], r: Rahmen, gelaende: Gelaende | null, aufGelaende: boolean,
	mitGestrichenen = false) {
	const feld = gelaende ? feldImRahmen(gelaende, r) : null;
	const netz = aufGelaende ? feld : null;
	const zuege: PlanZug[] = [];
	const texte: PlanText[] = [];
	const versatz = (x: number, y: number): [number, number] => [x - r.x0, y - r.y0];

	/**
	 * Am Rahmen geschnitten, wie das Modell. Ausgewählt wird, was den Rahmen
	 * berührt; ein Wald oder eine Landstraße, die ihn streift, reicht aber
	 * Kilometer hinaus (Jonathan, 03.11.2026: das Grün lief weit über das
	 * Modell). Flächen werden auf den Rahmen beschnitten, Linien an der Kante
	 * geteilt. Die Teile draußen braucht eine Zeichnung nicht; für Schatten
	 * gibt es `model_outside.obj`.
	 */
	const kasten: Punkt[] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
	/** Ein Zug in Rahmenkoordinaten. Mit Netz aufs Gelände gelegt, sonst eben auf null. */
	const zugLokal = (ebene: string, punkte: Punkt[], zu: boolean, fuss: number | null = null) => {
		if (!netz) { zuege.push({ ebene, punkte: punkte.map(([x, y]) => [x, y, 0]), zu, flach: true }); return; }
		let pz: [number, number, number][];
		if (fuss !== null) pz = punkte.map(([x, y]) => [x, y, fuss]);
		else {
			// Die schließende Strecke mit auflegen, dann den doppelten Punkt weg.
			pz = aufsNetz(netz, zu ? [...punkte, punkte[0]] : punkte);
			if (zu) pz.pop();
		}
		zuege.push({ ebene, punkte: pz, zu, flach: false });
	};
	const zug = (ebene: string, punkte: Punkt[], zu: boolean, fuss: number | null = null) =>
		zugLokal(ebene, punkte.map(([x, y]) => versatz(x, y)), zu, fuss);
	const bau = new Set(['gebaeude', 'erhalt', 'overture']);
	for (const o of objekte) {
		if (o.zustand === 'gestrichen' && !mitGestrichenen) continue;
		const ebene = o.zustand === 'gestrichen' ? dxfEbene(stift('gestrichen').dxf) : dxfEbene(stift(sichtEbene(o)).dxf);
		const fuss = netz && gelaende && bau.has(sichtEbene(o)) ? tiefsteUnter(gelaende, o.ringe) : null;
		for (const ring of alleRinge(o)) {
			if (ring.length < 2) continue;
			if (o.art === 'flaeche') {
				const innen = amRahmen(ring, r.x0, r.y0, r.x1, r.y1).innen;
				if (innen.length >= 3) zug(ebene, innen, true, fuss);
			} else {
				for (const teil of innerhalb(ring, kasten)) zug(ebene, teil, false);
			}
		}
	}
	// Namen als Text auf eigener Ebene. In CAD abschaltbar, im Plan lesbar.
	for (const o of objekte) {
		if (!o.name || o.zustand === 'gestrichen') continue;
		if (!['strasse', 'wasser', 'gruen', 'gebaeude', 'erhalt'].includes(o.ebene)) continue;
		const ring = o.ringe[0];
		if (!ring?.length) continue;
		let sx = 0, sy = 0;
		for (const [x, y] of ring) { sx += x; sy += y; }
		const [vx, vy] = versatz(sx / ring.length, sy / ring.length);
		if (vx < 0 || vy < 0 || vx > r.breiteM || vy > r.hoeheM) continue;
		texte.push({ text: o.name, x: vx, y: vy, z: netz ? netzHoehe(netz, vx, vy) : 0, hoehe: Math.max(3, r.breiteM / 260) });
	}
	// Höhenlinien, jede auf ihrer Höhe
	if (feld) for (const l of hoehenlinien(feld, aequidistanz(feld.max - feld.min)))
		zuege.push({ ebene: dxfEbene(l.haupt ? 'N_HOEHENLINIE_HAUPT' : 'N_HOEHENLINIE'),
			punkte: l.punkte.map(([x, y]) => [x, y, l.hoehe] as [number, number, number]), zu: l.geschlossen, flach: true });
	// Der Rahmen selbst, damit die Zeichnung ihre Grenze kennt
	zugLokal(dxfEbene(stift('rahmen').dxf), [[0, 0], [r.breiteM, 0], [r.breiteM, r.hoeheM], [0, r.hoeheM]], true);
	return { zuege, texte, netz };
}

export function alsDxf(objekte: Objekt[], r: Rahmen, mitGestrichenen = false, gelaende: Gelaende | null = null,
	aufGelaende = false): string {
	const { zuege, texte, netz } = planZuege(objekte, r, gelaende, aufGelaende, mitGestrichenen);
	let s = '';
	// Kopf mit Zeichnungsgrenzen
	s += p(0, 'SECTION') + p(2, 'HEADER');
	s += p(9, '$EXTMIN') + p(10, 0) + p(20, 0) + p(30, netz ? netz.min.toFixed(2) : 0);
	s += p(9, '$EXTMAX') + p(10, r.breiteM.toFixed(3)) + p(20, r.hoeheM.toFixed(3)) + p(30, netz ? netz.max.toFixed(2) : 0);
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
	for (const zg of zuege) {
		const e = zg.ebene;
		if (zg.flach) {
			// Eben: 2D-Polylinie mit Höhe am Kopf (Höhenlinien) oder auf null.
			const z = zg.punkte[0]?.[2] ?? 0;
			s += p(0, 'POLYLINE') + p(8, e) + p(66, 1) + (z ? p(10, '0.0') + p(20, '0.0') + p(30, z.toFixed(2)) : '') + p(70, zg.zu ? 1 : 0);
			for (const [x, y] of zg.punkte)
				s += p(0, 'VERTEX') + p(8, e) + p(10, x.toFixed(3)) + p(20, y.toFixed(3)) + p(30, z ? z.toFixed(2) : '0.0');
		} else {
			s += p(0, 'POLYLINE') + p(8, e) + p(66, 1) + p(10, '0.0') + p(20, '0.0') + p(30, '0.0') + p(70, 8 | (zg.zu ? 1 : 0));
			for (const [x, y, z] of zg.punkte)
				s += p(0, 'VERTEX') + p(8, e) + p(10, x.toFixed(3)) + p(20, y.toFixed(3)) + p(30, z.toFixed(3)) + p(70, 32);
		}
		s += p(0, 'SEQEND') + p(8, e);
	}
	const tl = dxfEbene('N_BESCHRIFTUNG');
	for (const t of texte)
		s += p(0, 'TEXT') + p(8, tl)
			+ p(10, t.x.toFixed(2)) + p(20, t.y.toFixed(2)) + p(30, t.z ? t.z.toFixed(2) : '0.0')
			+ p(40, t.hoehe.toFixed(2))
			+ p(1, text(t.text));
	s += p(0, 'ENDSEC') + p(0, 'EOF');
	return s;
}
