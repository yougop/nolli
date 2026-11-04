import earcut from 'earcut';
import type { Objekt } from './osm';

/**
 * Dachformen aus OpenStreetMap (04.11.2026, nach dem Vergleich mit f4map).
 *
 * OSM führt die Form als `roof:shape`, dazu `roof:height` oder
 * `roof:levels`, die Richtung als `roof:direction` und `roof:orientation`.
 * Nolli bildet die gängigen Formen auf fünf ab; alles andere bleibt flach:
 *
 * - **Pultdach** (`skillion`, `lean_to`): eine geneigte Ebene, nach
 *   `roof:direction` abfallend.
 * - **Satteldach** (`gabled`, `gambrel`, `saltbox`, `round`): First über die
 *   lange Seite, mit `roof:orientation=across` über die kurze.
 * - **Walmdach** (`hipped`, `half-hipped`, `side_hipped`, `mansard`): wie
 *   Sattel, die Enden mit gleicher Neigung abgewalmt.
 * - **Zeltdach** (`pyramidal`, `cone`): Spitze über der Mitte.
 * - **Kuppel** (`dome`, `onion`): ein Viertelkreis von der Traufe zur Mitte.
 *
 * Die Geometrie ist bewusst schlicht. Sattel und Walm legen den First in das
 * kleinste umschreibende Rechteck des Grundrisses; für Rechtecke ist das
 * genau, für verwinkelte Grundrisse eine Annäherung — ein L-Haus bekommt
 * einen durchgehenden First statt zweier. Das Dach wird als Hülle aus Ebenen
 * gerechnet und mit dem Grundriss geschnitten, die Wände folgen ihm. Darum
 * stimmt es auch dort, wo der Rahmen ein Haus anschneidet.
 *
 * `hoeheM` bleibt die Oberkante, wie OSM sie meint (`height` schließt das
 * Dach ein). Die Traufe liegt um die Dachhöhe tiefer.
 */
export type Dachform = 'pult' | 'sattel' | 'walm' | 'zelt' | 'kuppel';
type P = [number, number];

const FORMEN: Record<string, Dachform> = {
	skillion: 'pult', lean_to: 'pult',
	gabled: 'sattel', gambrel: 'sattel', saltbox: 'sattel', round: 'sattel',
	hipped: 'walm', 'half-hipped': 'walm', side_hipped: 'walm', mansard: 'walm',
	pyramidal: 'zelt', cone: 'zelt',
	dome: 'kuppel', onion: 'kuppel'
};
/** Die Namen im Vertrag, englisch wie OSM. */
export const DACH_NAME: Record<Dachform, string> = {
	pult: 'skillion', sattel: 'gabled', walm: 'hipped', zelt: 'pyramidal', kuppel: 'dome'
};

const HIMMEL = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** `roof:direction` in Grad, 0 = Nord, im Uhrzeigersinn. Gradzahl oder Himmelsrichtung. */
function richtung(roh?: string): number | undefined {
	if (!roh) return undefined;
	const k = HIMMEL.indexOf(roh.trim().toUpperCase());
	if (k >= 0) return k * 22.5;
	const g = parseFloat(roh);
	return Number.isFinite(g) ? ((g % 360) + 360) % 360 : undefined;
}
const meter = (roh?: string) => {
	const v = parseFloat((roh ?? '').replace(',', '.'));
	return Number.isFinite(v) && v > 0 ? v : undefined;
};

/** Kleinstes umschreibendes Rechteck: Mitte, lange Achse `u`, kurze `v`, halbe Längen. */
export function rechteck(ring: P[]): { c: P; u: P; v: P; hu: number; hv: number } {
	const h = huelle(ring);
	let best = { flaeche: Infinity, c: [0, 0] as P, u: [1, 0] as P, v: [0, 1] as P, hu: 0, hv: 0 };
	for (let i = 0; i < h.length; i++) {
		const [ax, ay] = h[i], [bx, by] = h[(i + 1) % h.length];
		const l = Math.hypot(bx - ax, by - ay);
		if (l < 1e-9) continue;
		const u: P = [(bx - ax) / l, (by - ay) / l], v: P = [-u[1], u[0]];
		let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
		for (const [x, y] of h) {
			const s = x * u[0] + y * u[1], t = x * v[0] + y * v[1];
			s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
		}
		const f = (s1 - s0) * (t1 - t0);
		if (f < best.flaeche) {
			const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
			best = { flaeche: f, c: [u[0] * sm + v[0] * tm, u[1] * sm + v[1] * tm], u, v, hu: (s1 - s0) / 2, hv: (t1 - t0) / 2 };
		}
	}
	if (best.hu < best.hv) best = { ...best, u: best.v, v: [-best.u[0], -best.u[1]], hu: best.hv, hv: best.hu };
	return { c: best.c, u: best.u, v: best.v, hu: best.hu, hv: best.hv };
}

function huelle(pts: P[]): P[] {
	const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (p.length < 3) return p;
	const kreuz = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const unten: P[] = [], oben: P[] = [];
	for (const q of p) { while (unten.length >= 2 && kreuz(unten[unten.length - 2], unten[unten.length - 1], q) <= 0) unten.pop(); unten.push(q); }
	for (const q of p.reverse()) { while (oben.length >= 2 && kreuz(oben[oben.length - 2], oben[oben.length - 1], q) <= 0) oben.pop(); oben.push(q); }
	return unten.slice(0, -1).concat(oben.slice(0, -1));
}

/**
 * Die Dachangaben eines Gebäudes aus seinen Tags. Ohne bekannte Form null.
 * Ohne `roof:height` und `roof:levels` eine Höhe aus der Breite: Sattel und
 * Walm rund 32°, Pult 12° über die ganze Breite, Zelt 40°, Kuppel halbrund.
 */
export function dachAusTags(t: Record<string, string>, ring: P[]):
	{ form: Dachform; hoeheM: number; richtung?: number; quer?: boolean } | null {
	const form = FORMEN[(t['roof:shape'] ?? '').trim()];
	if (!form || ring.length < 3) return null;
	const r = rechteck(ring);
	const stufen = meter(t['roof:levels']);
	const vorgabe = form === 'pult' ? 2 * r.hv * 0.21 : form === 'zelt' ? r.hv * 0.84 : form === 'kuppel' ? r.hv : r.hv * 0.62;
	const hoeheM = Math.min(40, Math.max(0.5, meter(t['roof:height']) ?? (stufen ? stufen * 3 : vorgabe)));
	return {
		form, hoeheM,
		...(richtung(t['roof:direction']) !== undefined ? { richtung: richtung(t['roof:direction']) } : {}),
		...(t['roof:orientation'] === 'across' ? { quer: true } : {})
	};
}

const flaeche2 = (r: P[]) => {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
	return s / 2;
};
const ccw = (r: P[]) => (flaeche2(r) < 0 ? r.slice().reverse() : r);

/** Sutherland–Hodgman: beliebiges Vieleck gegen ein konvexes, gegen den Uhrzeigersinn. */
function schneiden(subjekt: P[], fenster: P[]): P[] {
	let aus = subjekt;
	for (let i = 0; i < fenster.length && aus.length; i++) {
		const a = fenster[i], b = fenster[(i + 1) % fenster.length];
		const innen = (p: P) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
		const schnitt = (p: P, q: P): P => {
			const dx = q[0] - p[0], dy = q[1] - p[1];
			const ex = b[0] - a[0], ey = b[1] - a[1];
			const n = dx * ey - dy * ex;
			const t = n === 0 ? 0 : ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / n;
			return [p[0] + dx * t, p[1] + dy * t];
		};
		const ein = aus; aus = [];
		for (let k = 0; k < ein.length; k++) {
			const p = ein[k], q = ein[(k + 1) % ein.length];
			if (innen(q)) { if (!innen(p)) aus.push(schnitt(p, q)); aus.push(q); }
			else if (innen(p)) aus.push(schnitt(p, q));
		}
	}
	return aus;
}

function punktIn(p: P, ring: P[]) {
	let drin = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i], [xj, yj] = ring[j];
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) drin = !drin;
	}
	return drin;
}

/** Parameter in (0, 1), an denen die Strecke a–b die Strecke c–d kreuzt. */
function kreuzung(a: P, b: P, c: P, d: P): number | null {
	const r: P = [b[0] - a[0], b[1] - a[1]], s: P = [d[0] - c[0], d[1] - c[1]];
	const n = r[0] * s[1] - r[1] * s[0];
	if (Math.abs(n) < 1e-12) return null;
	const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / n;
	const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / n;
	return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

export const hatDach = (o: Objekt) => !!o.dachform && !(o.loecher && o.loecher.length);

/**
 * Ein Körper mit Dach: Dreiecke und Kanten im Ortsgitter (x Ost, y Nord, z oben).
 *
 * `teile` sind die Außenringe, schon am Rahmen geschnitten; `ganz` sagt, ob
 * der Körper ungeschnitten ist (dann bekommen Zelt und Kuppel ihre Spitze
 * über der Mitte des Grundrisses, auch auf runden Türmen). `boden` ist das
 * Gelände unter dem Körper, `unter` seine Unterkante darüber. Dreiecke
 * zeigen nach außen, gegen den Uhrzeigersinn von außen gesehen.
 */
export function dachKoerper(o: Objekt, teile: P[][], boden: number, unter: number, ganz: boolean,
	knickGrad = 20): { dreiecke: number[]; kanten: number[] } {
	const dreiecke: number[] = [], kanten: number[] = [];
	const form = o.dachform!;
	const oben = boden + (o.hoeheM ?? 8), fuss = boden + unter;
	const rh = Math.min(o.dachHoeheM ?? 3, Math.max(0, (oben - fuss) * 0.8));
	const traufe = oben - rh;
	const voll = o.ringe[0] as P[];
	const knick = Math.cos((knickGrad * Math.PI) / 180);
	const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) =>
		dreiecke.push(...a, ...b, ...c);
	const linie = (a: P, za: number, b: P, zb: number) => kanten.push(a[0], a[1], za, b[0], b[1], zb);

	// Achsen: R entlang des Firsts, Q quer dazu.
	const rr = rechteck(voll);
	let R = rr.u, Q = rr.v;
	if (o.quer) { R = rr.v; Q = [-rr.u[0], -rr.u[1]]; }
	if (o.dachRichtung !== undefined && (form === 'sattel' || form === 'walm' || form === 'pult')) {
		const a = (o.dachRichtung * Math.PI) / 180;
		Q = [Math.sin(a), Math.cos(a)];   // die Richtung, in die die Dachfläche schaut
		R = [Q[1], -Q[0]];
	}
	let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
	for (const [x, y] of voll) {
		const s = x * R[0] + y * R[1], t = x * Q[0] + y * Q[1];
		s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
	}
	const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
	const L = Math.max(0.1, (s1 - s0) / 2), W = Math.max(0.1, (t1 - t0) / 2);
	const st = (p: P): P => [p[0] * R[0] + p[1] * R[1] - sm, p[0] * Q[0] + p[1] * Q[1] - tm];
	const xy = (s: number, t: number): P => [R[0] * (s + sm) + Q[0] * (t + tm), R[1] * (s + sm) + Q[1] * (t + tm)];
	const rH = Math.max(0, L - W);
	const M = 4 * (L + W) + 50;

	/** Die Dachhöhe an einem Punkt: die untere Hülle der Dachebenen. */
	const z = (p: P): number => {
		const [s, t] = st(p);
		switch (form) {
			case 'pult': return traufe + rh * (W - t) / (2 * W);   // hoch hinten, tief vorn, Q schaut nach vorn
			case 'sattel': return oben - (rh * Math.min(W, Math.abs(t))) / W;
			case 'walm': return oben - (rh * Math.min(W, Math.max(Math.abs(t), Math.abs(s) - rH))) / W;
			default: return oben - rh * Math.min(1, Math.max(Math.abs(t) / W, Math.abs(s) / L));
		}
	};
	// Die Felder, in denen je eine Ebene gilt, als konvexe Vielecke (in s, t).
	const felderST: P[][] =
		form === 'pult' ? [[[-M, -M], [M, -M], [M, M], [-M, M]]]
		: form === 'sattel' ? [[[-M, 0], [M, 0], [M, M], [-M, M]], [[-M, -M], [M, -M], [M, 0], [-M, 0]]]
		: form === 'walm' ? [
			[[-rH, 0], [rH, 0], [rH + M, M], [-rH - M, M]],
			[[-rH - M, -M], [rH + M, -M], [rH, 0], [-rH, 0]],
			[[rH, 0], [rH + M, -M], [rH + M, M]],
			[[-rH, 0], [-rH - M, M], [-rH - M, -M]]]
		: [ // Zelt über dem Rechteck: vier Felder zwischen den Diagonalen
			[[0, 0], [(M * L) / W, M], [(-M * L) / W, M]],
			[[0, 0], [(-M * L) / W, -M], [(M * L) / W, -M]],
			[[0, 0], [M, (-M * W) / L], [M, (M * W) / L]],
			[[0, 0], [-M, (M * W) / L], [-M, (-M * W) / L]]];
	const felder = felderST.map((f) => ccw(f.map(([s, t]) => xy(s, t))));
	// Grate und First als Strecken (in s, t), für die Kanten.
	const grateST: [P, P][] =
		form === 'sattel' ? [[[-M, 0], [M, 0]]]
		: form === 'walm' ? [
			...(rH > 0 ? [[[-rH, 0], [rH, 0]] as [P, P]] : []),
			[[rH, 0], [rH + M, M]], [[rH, 0], [rH + M, -M]], [[-rH, 0], [-rH - M, M]], [[-rH, 0], [-rH - M, -M]]]
		: form === 'pult' ? []
		: [[[0, 0], [M * L, M * W]], [[0, 0], [-M * L, M * W]], [[0, 0], [M * L, -M * W]], [[0, 0], [-M * L, -M * W]]];

	const radial = ganz && (form === 'zelt' || form === 'kuppel');

	for (const roh of teile) {
		const teil = ccw(roh);
		if (teil.length < 3) continue;
		const n = teil.length;
		let mx = 0, my = 0, a6 = 0;
		for (let i = 0; i < n; i++) {
			const [x0, y0] = teil[i], [x1, y1] = teil[(i + 1) % n];
			const k = x0 * y1 - x1 * y0; a6 += k; mx += (x0 + x1) * k; my += (y0 + y1) * k;
		}
		const mitte: P = a6 ? [mx / (3 * a6), my / (3 * a6)] : teil[0];
		const zw = (p: P) => (radial ? traufe : z(p));

		// Wände: jede Kante an den Feldgrenzen geteilt, oben dem Dach folgend.
		for (let i = 0; i < n; i++) {
			const a = teil[i], b = teil[(i + 1) % n];
			const ts = [0, 1];
			if (!radial) for (const f of felder) for (let k = 0; k < f.length; k++) {
				const t = kreuzung(a, b, f[k], f[(k + 1) % f.length]);
				if (t !== null) ts.push(t);
			}
			ts.sort((x, y) => x - y);
			for (let k = 0; k + 1 < ts.length; k++) {
				if (ts[k + 1] - ts[k] < 1e-6) continue;
				const p0: P = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]];
				const p1: P = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
				const z0 = zw(p0), z1 = zw(p1);
				tri([p0[0], p0[1], fuss], [p1[0], p1[1], fuss], [p1[0], p1[1], z1]);
				tri([p0[0], p0[1], fuss], [p1[0], p1[1], z1], [p0[0], p0[1], z0]);
				linie(p0, z0, p1, z1);
			}
			linie(a, fuss, b, fuss);
			// Senkrechte an echten Ecken
			const v = teil[(i + n - 1) % n];
			const ux = a[0] - v[0], uy = a[1] - v[1], wx = b[0] - a[0], wy = b[1] - a[1];
			const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
			if (lu > 1e-6 && lw > 1e-6 && (ux * wx + uy * wy) / (lu * lw) < knick) linie(a, fuss, a, zw(a));
		}

		// Boden, wenn der Körper schwebt
		if (unter > 0) {
			const idx = earcut(teil.flat());
			for (let k = 0; k < idx.length; k += 3) {
				const A = teil[idx[k]], B = teil[idx[k + 1]], C = teil[idx[k + 2]];
				const rechts = flaeche2([A, B, C]) > 0;
				tri([A[0], A[1], fuss], rechts ? [C[0], C[1], fuss] : [B[0], B[1], fuss], rechts ? [B[0], B[1], fuss] : [C[0], C[1], fuss]);
			}
		}

		if (radial) {
			// Zelt und Kuppel um die Mitte: Ringe von der Traufe zur Spitze.
			const stufen = form === 'kuppel' ? 6 : 1;
			const punkt = (p: P, k: number): [number, number, number] => {
				const w = (k / stufen) * (Math.PI / 2);
				const f = form === 'kuppel' ? Math.cos(w) : 1 - k / stufen;
				const h = form === 'kuppel' ? Math.sin(w) : k / stufen;
				return [mitte[0] + (p[0] - mitte[0]) * f, mitte[1] + (p[1] - mitte[1]) * f, traufe + rh * h];
			};
			for (let i = 0; i < n; i++) {
				const a = teil[i], b = teil[(i + 1) % n];
				for (let k = 0; k < stufen; k++) {
					const a0 = punkt(a, k), b0 = punkt(b, k), a1 = punkt(a, k + 1), b1 = punkt(b, k + 1);
					tri(a0, b0, b1);
					if (k + 1 < stufen) tri(a0, b1, a1);
				}
				// Grate des Zeltdachs an den Ecken
				if (form === 'zelt') {
					const v = teil[(i + n - 1) % n];
					const ux = a[0] - v[0], uy = a[1] - v[1], wx = b[0] - a[0], wy = b[1] - a[1];
					const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
					if (lu > 1e-6 && lw > 1e-6 && (ux * wx + uy * wy) / (lu * lw) < knick) linie(a, traufe, mitte, oben);
				}
			}
			continue;
		}

		// Dachflächen: erst der Grundriss in Dreiecke, dann jedes Dreieck je Feld
		// geschnitten, darin eben. Andersherum — der verwinkelte Grundriss direkt
		// gegen das Feld — ließ der Schnitt bei L-, U- und T-Formen Stücke weg
		// (Volker, Rothenburg; im Test 192 von 1.200 Fällen). Dreieck gegen
		// konvexes Feld ist exakt.
		const idx = earcut(teil.flat());
		for (let k = 0; k < idx.length; k += 3) {
			const grund = ccw([teil[idx[k]], teil[idx[k + 1]], teil[idx[k + 2]]]);
			for (const f of felder) {
				const stueck = schneiden(grund, f);
				if (stueck.length < 3 || Math.abs(flaeche2(stueck)) < 1e-6) continue;
				// konvex: als Fächer
				for (let j = 1; j + 1 < stueck.length; j++) {
					const A = stueck[0], B = stueck[j], C = stueck[j + 1];
					if (Math.abs(flaeche2([A, B, C])) < 1e-9) continue;
					tri([A[0], A[1], z(A)], [B[0], B[1], z(B)], [C[0], C[1], z(C)]);
				}
			}
		}
		// First und Grate, soweit sie über dem Grundriss liegen.
		for (const [g0, g1] of grateST) {
			const a = xy(g0[0], g0[1]), b = xy(g1[0], g1[1]);
			const ts = [0, 1];
			for (let k = 0; k < n; k++) {
				const t = kreuzung(a, b, teil[k], teil[(k + 1) % n]);
				if (t !== null) ts.push(t);
			}
			ts.sort((x, y) => x - y);
			for (let k = 0; k + 1 < ts.length; k++) {
				const tm2 = (ts[k] + ts[k + 1]) / 2;
				const m: P = [a[0] + (b[0] - a[0]) * tm2, a[1] + (b[1] - a[1]) * tm2];
				if (!punktIn(m, teil)) continue;
				const p0: P = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]];
				const p1: P = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
				linie(p0, z(p0), p1, z(p1));
			}
		}
	}
	return { dreiecke, kanten };
}
