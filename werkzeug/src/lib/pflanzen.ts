import { geballt, type Baum } from './analysedaten';
import type { Objekt } from './osm';

/**
 * Bäume von Hand ergänzen (Volker, 07.11.2026: „In Rothenburg sieht man,
 * dass es viel mehr gibt“). Pinsel, Lasso, Einzelbaum und Radierer im
 * Fenster „Bäume pflanzen“; hier steht, wo ein Baum hinkommt.
 *
 * - Ein festes Raster im Ortsgitter mit der Maschenweite `abstandM`, je
 *   Masche ein Punkt, fest verschoben. Zweimal über dieselbe Stelle gemalt
 *   gibt keinen zweiten Baum, und die Dichte bleibt gleichmäßig.
 * - Freihalten: Gebäude, Wasser und Straßen (in ihrer Breite plus einem
 *   Meter), je abschaltbar. Ein Lasso über einen Hang mit Weg setzt so keine
 *   Bäume auf die Fahrbahn.
 * - Nicht dichter als 70 % des Abstands an einen schon gepflanzten Baum,
 *   auch wenn er mit einem anderen Abstand gesetzt wurde.
 */
export type Pflanzwahl = {
	werkzeug: 'pinsel' | 'lasso' | 'einzel' | 'waehlen';
	radieren: boolean;
	pinselM: number;
	abstandM: number;
	kroneM: number;
	variation: number;
	/** Ballung wie bei Wald und Naturflächen; 0 ist gleichmäßig. */
	ballung?: number;
	art: 'laub' | 'nadel' | 'misch';
	nadelAnteil: number;
	freiGebaeude: boolean; freiWasser: boolean; freiStrassen: boolean;
};
export const PFLANZ_VORGABE: Pflanzwahl = {
	werkzeug: 'pinsel', radieren: false, pinselM: 25, abstandM: 8, kroneM: 6, variation: 0.3, ballung: 0,
	art: 'laub', nadelAnteil: 0.3, freiGebaeude: true, freiWasser: true, freiStrassen: true
};

const zufall = (x: number, y: number, n: number) => { const v = Math.sin(x * 12.9898 + y * 78.233 + n * 39.425) * 43758.5453; return v - Math.floor(v); };

function innen(x: number, y: number, ring: [number, number][]) {
	let drin = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i], [xj, yj] = ring[j];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
	}
	return drin;
}
function abstandZurStrecke(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
	const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
	const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
	return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Hindernisse in einem Raster von 50 m, damit die Prüfung je Baum schnell bleibt. */
type Hindernis = { art: 'flaeche' | 'linie'; ringe: [number, number][][]; loecher: [number, number][][]; halb: number; ebene: string };
const ZELLE = 50;
let merk: { objekte: Objekt[]; index: Map<string, Hindernis[]> } | null = null;
function index(objekte: Objekt[]) {
	if (merk?.objekte === objekte) return merk.index;
	const idx = new Map<string, Hindernis[]>();
	for (const o of objekte) {
		if (o.zustand === 'gestrichen' || !o.ringe.length) continue;
		const istStrasse = o.ebene === 'strasse' && o.art === 'linie';
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt' && o.ebene !== 'wasser' && !istStrasse) continue;
		const h: Hindernis = { art: istStrasse ? 'linie' : 'flaeche', ringe: o.ringe, loecher: o.loecher ?? [], halb: istStrasse ? (o.breiteM ?? 6) / 2 + 1 : 0, ebene: o.ebene };
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const ring of o.ringe) for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
		x0 -= h.halb; y0 -= h.halb; x1 += h.halb; y1 += h.halb;
		for (let gy = Math.floor(y0 / ZELLE); gy <= Math.floor(y1 / ZELLE); gy++)
			for (let gx = Math.floor(x0 / ZELLE); gx <= Math.floor(x1 / ZELLE); gx++) {
				const k = `${gx}:${gy}`;
				(idx.get(k) ?? idx.set(k, []).get(k)!).push(h);
			}
	}
	merk = { objekte, index: idx };
	return idx;
}

/** Ist der Punkt frei nach der Wahl? */
export function frei(objekte: Objekt[], w: Pflanzwahl, x: number, y: number) {
	const liste = index(objekte).get(`${Math.floor(x / ZELLE)}:${Math.floor(y / ZELLE)}`);
	if (!liste) return true;
	for (const h of liste) {
		if (h.art === 'linie') {
			if (!w.freiStrassen) continue;
			for (const ring of h.ringe) for (let i = 1; i < ring.length; i++)
				if (abstandZurStrecke(x, y, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]) < h.halb) return false;
		} else {
			if (h.ebene === 'wasser' ? !w.freiWasser : !w.freiGebaeude) continue;
			if (h.ringe.some((r) => innen(x, y, r)) && !h.loecher.some((r) => innen(x, y, r))) return false;
		}
	}
	return true;
}

/** Neue Bäume in einem Gebiet: `drin` sagt, ob ein Punkt dazugehört. */
export function pflanzen(objekte: Objekt[], schon: Baum[], w: Pflanzwahl, box: [number, number, number, number],
	drin: (x: number, y: number) => boolean): Baum[] {
	const d = Math.max(2, w.abstandM), min = d * 0.7;
	// Bestehende ergänzte Bäume in einem Raster nach `min`, für den Mindestabstand.
	const nachbarn = new Map<string, Baum[]>();
	const schluessel = (x: number, y: number) => `${Math.floor(x / min)}:${Math.floor(y / min)}`;
	const merke = (b: Baum) => { const k = schluessel(b.x, b.y); (nachbarn.get(k) ?? nachbarn.set(k, []).get(k)!).push(b); };
	for (const b of schon) if (b.x >= box[0] - min && b.x <= box[2] + min && b.y >= box[1] - min && b.y <= box[3] + min) merke(b);
	const zuNah = (x: number, y: number) => {
		const gx = Math.floor(x / min), gy = Math.floor(y / min);
		for (let j = gy - 1; j <= gy + 1; j++) for (let i = gx - 1; i <= gx + 1; i++)
			for (const b of nachbarn.get(`${i}:${j}`) ?? []) if (Math.hypot(b.x - x, b.y - y) < min) return true;
		return false;
	};
	const neu: Baum[] = [];
	for (let gy = Math.floor(box[1] / d); gy * d <= box[3]; gy++)
		for (let gx = Math.floor(box[0] / d); gx * d <= box[2]; gx++) {
			const x = (gx + 0.15 + 0.7 * zufall(gx, gy, d)) * d, y = (gy + 0.15 + 0.7 * zufall(gx, gy, d + 1)) * d;
			if (!drin(x, y) || zuNah(x, y) || !frei(objekte, w, x, y)) continue;
			const gb = geballt(x, y, gx, gy, w.ballung ?? 0);
			if (!gb.bleibt) continue;
			const b = baumAn(x, y, w, `${gx}:${gy}:${d}`);
			neu.push(gb.groesse === 1 ? b : { ...b, krone: b.krone * gb.groesse });
			merke(neu[neu.length - 1]);
		}
	return neu;
}

/** Ein Baum an einem Punkt, mit Größe und Art nach der Wahl. */
export function baumAn(x: number, y: number, w: Pflanzwahl, kennung = `${Math.round(x * 10)}:${Math.round(y * 10)}`): Baum {
	const krone = Math.max(1, w.kroneM * (1 + w.variation * (2 * zufall(x, y, 4) - 1)));
	const nadel = w.art === 'nadel' || (w.art === 'misch' && zufall(x, y, 5) < w.nadelAnteil);
	return { id: `neu:${kennung}`, x, y, krone, gemessen: true, ergaenzt: true, ...(nadel ? { nadel: true } : {}) };
}

/** Gebiete: Kreis um einen Punkt und Polygon. */
export const imKreis = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
export const imRing = (ring: [number, number][]) => (x: number, y: number) => innen(x, y, ring);
export function huelle(ring: [number, number][]): [number, number, number, number] {
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
	return [x0, y0, x1, y1];
}

/**
 * Gebiete (Volker, 07.11.2026: „auch im Nachhinein ändern, Dichte, Variation
 * usw.“). Jeder Pinselzug, jedes Lasso, jeder Einzelbaum ist ein Gebiet mit
 * seiner Wahl. Die Bäume entstehen der Reihe nach aus den Gebieten; ändert
 * man die Wahl eines Gebiets, wird es neu gesetzt. Radieren ist ein Gebiet,
 * das entfernt, was vor ihm stand.
 */
export type Form =
	| { art: 'kreise'; kreise: [number, number, number][] }
	| { art: 'ring'; ring: [number, number][] }
	| { art: 'punkt'; x: number; y: number }
	| { art: 'fest'; baeume: Baum[] };
export type Gebiet = { id: number; form: Form; radieren: boolean; wahl: Pflanzwahl };

export function gebietDrin(f: Form): (x: number, y: number) => boolean {
	if (f.art === 'kreise') return (x, y) => f.kreise.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
	if (f.art === 'ring') return imRing(f.ring);
	if (f.art === 'punkt') return (x, y) => Math.hypot(x - f.x, y - f.y) <= 3;
	return () => false;
}
export function gebietHuelle(f: Form): [number, number, number, number] {
	if (f.art === 'kreise') {
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const [x, y, r] of f.kreise) { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
		return [x0, y0, x1, y1];
	}
	if (f.art === 'ring') return huelle(f.ring);
	if (f.art === 'punkt') return [f.x - 3, f.y - 3, f.x + 3, f.y + 3];
	return [0, 0, 0, 0];
}

/** Ein Gebiet auf eine Liste anwenden: pflanzen oder radieren. Gibt die neue Liste zurück. */
export function gebietAnwenden(objekte: Objekt[], liste: Baum[], g: Gebiet, nur?: [number, number, number]): Baum[] {
	const f = g.form;
	if (f.art === 'fest') return [...liste, ...f.baeume.map((b) => ({ ...b, gebiet: g.id }))];
	if (g.radieren) {
		const drin = nur ? imKreis(nur[0], nur[1], nur[2]) : gebietDrin(f);
		// Radieren trifft beim Einzelklick nur den nächsten Baum in Reichweite.
		if (f.art === 'punkt') {
			let best = -1, d = Infinity;
			liste.forEach((b, i) => { const a = Math.hypot(b.x - f.x, b.y - f.y); if (a < d) { d = a; best = i; } });
			return best >= 0 && d <= Math.max(3, liste[best].krone) ? liste.filter((_, i) => i !== best) : liste;
		}
		return liste.filter((b) => !drin(b.x, b.y));
	}
	if (f.art === 'punkt') return frei(objekte, g.wahl, f.x, f.y) ? [...liste, { ...baumAn(f.x, f.y, g.wahl), gebiet: g.id }] : liste;
	const box: [number, number, number, number] = nur ? [nur[0] - nur[2], nur[1] - nur[2], nur[0] + nur[2], nur[1] + nur[2]] : gebietHuelle(f);
	const drin = nur ? imKreis(nur[0], nur[1], nur[2]) : gebietDrin(f);
	const neu = pflanzen(objekte, liste, g.wahl, box, drin).map((b) => ({ ...b, gebiet: g.id }));
	return neu.length ? [...liste, ...neu] : liste;
}

/** Alle Gebiete der Reihe nach. */
export function ausGebieten(objekte: Objekt[], gebiete: Gebiet[]): Baum[] {
	let liste: Baum[] = [];
	for (const g of gebiete) liste = gebietAnwenden(objekte, liste, g);
	return liste;
}
