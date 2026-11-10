/**
 * Eigene Gebäude, der Schritt „Entwerfen" (Volker, 09.11.2026).
 *
 * Ein Neubau ist für Nolli ein Gebäude wie jedes andere, nur mit eigener
 * Ebene: Plan, 3D, SVG, DXF, OBJ, 3DM, Druck und Vertrag nehmen ihn ohne
 * Sonderweg mit. Er liegt aber in einer eigenen Liste neben dem Bestand
 * (`z.entwurf`), damit Neu holen, Bereinigen und „Alles zurücksetzen" ihn
 * nicht anfassen.
 *
 * Die Geometrie ist deterministisch und in Metern: Ein Rechteck behält seine
 * Maße (`rechteck`), damit Länge, Tiefe und Drehung sich als Zahl ändern
 * lassen. Wer eine Ecke zieht, macht daraus ein freies Polygon.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import type { Objekt, Nutzungsklasse } from './osm';

export type Punkt = [number, number];
/** Mitte, Länge entlang `winkel`, Tiefe quer dazu; Winkel in Grad, gegen den Uhrzeiger von Ost. */
export type Rechteck = { cx: number; cy: number; l: number; t: number; winkel: number };

/** Eine Fläche in Metern: Außenringe, Höfe, beim Rechteck seine Maße. */
export type Gestalt = { ringe: Punkt[][]; loecher?: Punkt[][]; rechteck?: Rechteck };

/**
 * Eine Form im Stapel eines Gebäudes (Volker, 09.11.2026): weitere Masse
 * oder Aussparung, je für einen Bereich von Geschossen. `von` ist das erste
 * Geschoss (0 = EG), `bis` das erste darüber, das nicht mehr dazugehört;
 * `null` heißt bis oben. Aussparungen bleiben eigene Formen, das Ergebnis
 * rechnet `teileVon` jedes Mal neu — wie ein Operator in Archicad oder ein
 * Boolean-Modifier in Blender, nicht wie ein endgültiger Schnitt.
 */
export type Form = Gestalt & {
	id: string;
	art: 'masse' | 'aussparung';
	von: number;
	bis: number | null;
	name?: string;
	aus?: boolean;
};

/**
 * Ein eigenes Gebäude oder, mit `typ: 'gruen'`, eine eigene Grünfläche.
 * Der eigene Umriss ist die Grundmasse vom EG bis `geschosse`; weitere
 * Formen stehen in `formen`.
 */
export type Neubau = Objekt & {
	ebene: 'neubau';
	geschosse: number;
	geschossHoeheM: number;
	rechteck?: Rechteck;
	formen?: Form[];
	typ?: 'gruen';
};

export type Entwurfswahl = { geschosse: number; geschossHoeheM: number; klasse: Nutzungsklasse };
export const ENTWURF_VORGABE: Entwurfswahl = { geschosse: 5, geschossHoeheM: 3.2, klasse: 'wohnen' };
/** Neubau im Plan: ein warmes Rot, wie in der Planlegende Bestand, Abriss, Neubau. */
export const NEUBAU_FARBE = '#D0563B';
/** Kleiner als das hat ein Gebäude keinen Sinn, und ein versehentlicher Klick wird keins. */
export const MIN_SEITE_M = 2;

const rad = (g: number) => (g * Math.PI) / 180;

export function rechteckRing(r: Rechteck): Punkt[] {
	const c = Math.cos(rad(r.winkel)), s = Math.sin(rad(r.winkel));
	const ux = (c * r.l) / 2, uy = (s * r.l) / 2, vx = (-s * r.t) / 2, vy = (c * r.t) / 2;
	return [
		[r.cx - ux - vx, r.cy - uy - vy],
		[r.cx + ux - vx, r.cy + uy - vy],
		[r.cx + ux + vx, r.cy + uy + vy],
		[r.cx - ux + vx, r.cy - uy + vy]
	];
}

/** Ein Rechteck aus zwei gegenüberliegenden Ecken, in einem gedrehten Raster. */
export function rechteckAusEcken(a: Punkt, b: Punkt, winkel: number): Rechteck {
	const c = Math.cos(rad(winkel)), s = Math.sin(rad(winkel));
	const dx = b[0] - a[0], dy = b[1] - a[1];
	const du = dx * c + dy * s, dv = -dx * s + dy * c;
	return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, l: Math.abs(du), t: Math.abs(dv), winkel };
}

export function ringFlaeche(r: Punkt[]): number {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
	return Math.abs(s / 2);
}

/** Gegen den Uhrzeiger, wie die übrigen Außenringe. */
function gegenUhr(r: Punkt[]): Punkt[] {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
	return s < 0 ? [...r].reverse() : r;
}

export function mitte(r: Punkt[]): Punkt {
	let x = 0, y = 0;
	for (const p of r) { x += p[0]; y += p[1]; }
	return [x / r.length, y / r.length];
}

export function drinRing(p: Punkt, r: Punkt[]): boolean {
	let drin = false;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
		const [xi, yi] = r[i], [xj, yj] = r[j];
		if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) drin = !drin;
	}
	return drin;
}

/** Höhe aus Geschossen; der Rest bleibt, wie er war. */
export function neubau(id: string, ring: Punkt[], w: Entwurfswahl, rechteck?: Rechteck, typ?: 'gruen'): Neubau {
	return {
		id, ebene: 'neubau', art: 'flaeche', ringe: [gegenUhr(ring)], zustand: 'normal',
		geschosse: typ ? 0 : w.geschosse, geschossHoeheM: w.geschossHoeheM,
		hoeheM: typ ? 0 : Math.round(w.geschosse * w.geschossHoeheM * 100) / 100, hoeheGeschaetzt: false,
		klasse: typ ? undefined : w.klasse, rechteck, herkunft: 'design', ...(typ ? { typ } : {})
	};
}

export function mitWahl(o: Neubau, w: Partial<Entwurfswahl>): Neubau {
	if (o.typ) return o;
	const geschosse = w.geschosse ?? o.geschosse, gh = w.geschossHoeheM ?? o.geschossHoeheM;
	// Was aufgestockt ist, steht auf dem Gebäude und geht mit, wenn es wächst oder schrumpft.
	const d = geschosse - o.geschosse;
	const formen = d && o.formen?.length
		? o.formen.map((f) => (f.art === 'masse' && f.von >= o.geschosse ? { ...f, von: f.von + d, bis: f.bis === null ? null : f.bis + d } : f))
		: o.formen;
	return { ...o, geschosse, geschossHoeheM: gh, hoeheM: Math.round(geschosse * gh * 100) / 100, klasse: w.klasse ?? o.klasse, ...(formen ? { formen } : {}) };
}

export function mitRechteck<T extends Gestalt>(o: T, r: Rechteck): T {
	return { ...o, rechteck: r, ringe: [gegenUhr(rechteckRing(r))], loecher: undefined };
}

const bewegt = (o: Gestalt, f: (p: Punkt) => Punkt) => ({
	ringe: o.ringe.map((r) => r.map(f)),
	...(o.loecher?.length ? { loecher: o.loecher.map((r) => r.map(f)) } : {})
});

export function verschoben<T extends Gestalt>(o: T, dx: number, dy: number): T {
	return {
		...o, ...bewegt(o, ([x, y]) => [x + dx, y + dy]),
		rechteck: o.rechteck ? { ...o.rechteck, cx: o.rechteck.cx + dx, cy: o.rechteck.cy + dy } : undefined
	};
}

/** Die Mitte einer Fläche, um die sie sich dreht. */
export function drehMitte(o: Gestalt): Punkt {
	return o.rechteck ? [o.rechteck.cx, o.rechteck.cy] : mitte(o.ringe.flat());
}

/** Drehen in Grad gegen den Uhrzeiger, um `um` oder die eigene Mitte. */
export function gedreht<T extends Gestalt>(o: T, grad: number, um: Punkt = drehMitte(o)): T {
	const [mx, my] = um;
	const c = Math.cos(rad(grad)), s = Math.sin(rad(grad));
	const dreh = ([x, y]: Punkt): Punkt => { const dx = x - mx, dy = y - my; return [mx + dx * c - dy * s, my + dx * s + dy * c]; };
	if (o.rechteck && !o.loecher?.length) {
		const [cx, cy] = dreh([o.rechteck.cx, o.rechteck.cy]);
		return mitRechteck(o, { ...o.rechteck, cx, cy, winkel: normWinkel(o.rechteck.winkel + grad) });
	}
	return { ...o, rechteck: undefined, ...bewegt(o, dreh) };
}

/** Ein Gebäude samt seinen Formen verschieben. */
export function neubauVerschoben(o: Neubau, dx: number, dy: number): Neubau {
	const v = verschoben(o, dx, dy);
	return o.formen?.length ? { ...v, formen: o.formen.map((f) => verschoben(f, dx, dy)) } : v;
}
/** Ein Gebäude samt seinen Formen um seine Mitte drehen. */
export function neubauGedreht(o: Neubau, grad: number): Neubau {
	const m = drehMitte(o), d = gedreht(o, grad, m);
	return o.formen?.length ? { ...d, formen: o.formen.map((f) => gedreht(f, grad, m)) } : d;
}

/** Wo ein Punkt sitzt: im Außenring `r` oder im Loch `r`, an Stelle `i`. */
export type Stelle = { loch: boolean; r: number; i: number };
export const ringAn = (o: Gestalt, st: Stelle) => (st.loch ? o.loecher?.[st.r] : o.ringe[st.r]) ?? [];

const ringErsetzt = <T extends Gestalt>(o: T, st: Stelle, neu: Punkt[]): T => st.loch
	? { ...o, rechteck: undefined, loecher: o.loecher!.map((r, k) => (k === st.r ? neu : r)) }
	: { ...o, rechteck: undefined, ringe: o.ringe.map((r, k) => (k === st.r ? neu : r)) };

/** Einen Punkt versetzen. Danach ist es eine freie Form. */
export function punktVersetzt<T extends Gestalt>(o: T, st: Stelle, p: Punkt): T {
	return ringErsetzt(o, st, ringAn(o, st).map((q, k) => (k === st.i ? p : q)));
}
/** Einen Punkt hinter `st.i` einfügen. */
export function punktEingefuegt<T extends Gestalt>(o: T, st: Stelle, p: Punkt): T {
	const alt = ringAn(o, st);
	return ringErsetzt(o, st, [...alt.slice(0, st.i + 1), p, ...alt.slice(st.i + 1)]);
}
/** Einen Punkt entfernen; ein Ring behält mindestens drei. */
export function punktEntfernt<T extends Gestalt>(o: T, st: Stelle): T {
	const alt = ringAn(o, st);
	if (alt.length <= 3) return o;
	return ringErsetzt(o, st, alt.filter((_, k) => k !== st.i));
}

// ---- Rechnen mit Flächen (polygon-clipping) ------------------------------
const zu = (r: Punkt[]): [number, number][] => [...r.map(([x, y]) => [x, y] as [number, number]), [r[0][0], r[0][1]]];
const offen = (r: [number, number][]): Punkt[] => r.slice(0, -1).map(([x, y]) => [x, y] as Punkt);
/** Eine Gestalt als Multipolygon: jeder Außenring mit den Höfen, die in ihm liegen. */
export function alsMulti(g: Gestalt): MultiPolygon {
	const loecher = g.loecher ?? [];
	return g.ringe.filter((r) => r.length >= 3)
		.map((aussen) => [zu(aussen), ...loecher.filter((l) => l.length >= 3 && drinRing(l[0], aussen)).map(zu)]) as MultiPolygon;
}
export function ausMulti(mp: MultiPolygon): Gestalt {
	const ringe = mp.map((pg) => offen(pg[0])).filter((r) => r.length >= 3 && ringFlaeche(r) >= 0.5).map(gegenUhr);
	const loecher = mp.flatMap((pg) => pg.slice(1).map(offen)).filter((r) => r.length >= 3);
	return { ringe, ...(loecher.length ? { loecher } : {}) };
}
export const multiFlaeche = (mp: MultiPolygon) =>
	mp.reduce((s, pg) => s + ringFlaeche(offen(pg[0])) - pg.slice(1).reduce((t, l) => t + ringFlaeche(offen(l)), 0), 0);

/**
 * Die Bauteile eines Gebäudes, wie Plan, Modell und Paket sie zeigen.
 *
 * Je Geschossband gilt: alle Massen in dem Band vereinigt, alle Aussparungen
 * darin abgezogen. Gleiche Bänder übereinander werden ein Teil. Das Ergebnis
 * sind Körper mit Unter- und Oberkante, dieselben wie OSM-Gebäudeteile
 * (`unterM`, `hoeheM`), die Raum, OBJ, 3DM und Druck längst können.
 */
const teilSpeicher = new WeakMap<Neubau, Objekt[]>();
export function teileVon(o: Neubau): Objekt[] {
	const alt = teilSpeicher.get(o);
	if (alt) return alt;
	const aus = teileRechnen(o);
	teilSpeicher.set(o, aus);
	return aus;
}
function teileRechnen(o: Neubau): Objekt[] {
	const basis = { ebene: o.ebene, art: 'flaeche' as const, zustand: 'normal' as const, herkunft: 'design' as const };
	if (o.typ === 'gruen') return [{ ...basis, id: o.id, ebene: 'gruen', ringe: o.ringe, entwurf: o.id, ...(o.loecher ? { loecher: o.loecher } : {}) }];
	const formen = (o.formen ?? []).filter((f) => !f.aus && f.ringe.length);
	if (!formen.length) return [{ ...o, formen: undefined, rechteck: undefined, entwurf: o.id } as Objekt];
	const G = o.geschosse, gh = o.geschossHoeheM;
	const massen = formen.filter((f) => f.art === 'masse'), schnitte = formen.filter((f) => f.art === 'aussparung');
	const oben = Math.max(G, ...massen.map((f) => f.bis ?? G));
	const bisVon = (f: Form) => Math.min(oben, f.bis ?? oben);
	const marken = [...new Set([0, G, oben, ...formen.flatMap((f) => [f.von, bisVon(f)])])]
		.filter((x) => x >= 0 && x <= oben).sort((a, b) => a - b);
	const teile: { a: number; b: number; mp: MultiPolygon; schluessel: string }[] = [];
	for (let k = 0; k + 1 < marken.length; k++) {
		const a = marken[k], b = marken[k + 1];
		const drin = (f: { von: number; bis: number }) => f.von <= a && f.bis >= b;
		const hier = [
			...(drin({ von: 0, bis: G }) ? [alsMulti(o)] : []),
			...massen.filter((f) => drin({ von: f.von, bis: bisVon(f) })).map(alsMulti)
		].filter((m) => m.length);
		if (!hier.length) continue;
		let mp = hier.length > 1 ? polygonClipping.union(hier[0], ...hier.slice(1)) : hier[0];
		const ab = schnitte.filter((f) => drin({ von: f.von, bis: bisVon(f) })).map(alsMulti).filter((m) => m.length);
		if (ab.length) mp = polygonClipping.difference(mp, ...ab);
		if (!mp.length || multiFlaeche(mp) < 0.5) continue;
		const schluessel = JSON.stringify(mp.map((pg) => pg.map((r) => r.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]))));
		const letzt = teile[teile.length - 1];
		if (letzt && letzt.b === a && letzt.schluessel === schluessel) letzt.b = b;
		else teile.push({ a, b, mp, schluessel });
	}
	const fussRinge = teile.flatMap((t) => ausMulti(t.mp).ringe);
	return teile.map((t, k) => ({
		...basis, ...ausMulti(t.mp), fussRinge,
		id: k === 0 && t.a === 0 ? o.id : `${o.id}-${k + 1}`,
		geschosse: t.b - t.a, geschossHoeheM: gh, klasse: o.klasse, hoeheGeschaetzt: false,
		hoeheM: Math.round(t.b * gh * 100) / 100,
		...(t.a > 0 ? { unterM: Math.round(t.a * gh * 100) / 100 } : {}),
		entwurf: o.id
	}) as Objekt);
}

/** Trifft der Punkt die Fläche, also einen Außenring und kein Loch? */
export function trifftGestalt(o: Gestalt, p: Punkt): boolean {
	return o.ringe.some((r) => drinRing(p, r)) && !(o.loecher ?? []).some((l) => drinRing(p, l));
}
/** Trifft der Punkt ein Gebäude, gleich auf welcher Höhe? */
export function trifftNeubau(o: Neubau, p: Punkt): boolean {
	return teileVon(o).some((t) => trifftGestalt(t, p));
}
/** Grundfläche ohne Höfe. */
export function grundflaeche(o: Gestalt): number {
	return Math.max(0, o.ringe.reduce((s, r) => s + ringFlaeche(r), 0) - (o.loecher ?? []).reduce((s, r) => s + ringFlaeche(r), 0));
}
/** Die Hülle in Metern: x0, y0, x1, y1; beim Gebäude samt seinen Formen. */
export function huelle(o: Gestalt & { formen?: Form[] }): [number, number, number, number] {
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const g of [o, ...(o.formen ?? [])]) for (const r of g.ringe) for (const [x, y] of r) {
		if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
	}
	return [x0, y0, x1, y1];
}

/**
 * Eine Fläche ringsum einrücken, um `d` Meter: für das Staffelgeschoss. Ein
 * Rechteck bleibt eines; ein Polygon wird Kante für Kante nach innen
 * versetzt. Null, wenn dabei nichts Brauchbares übrig bleibt.
 */
export function eingerueckt(g: Gestalt, d: number): Gestalt | null {
	if (g.rechteck && !g.loecher?.length) {
		const r = { ...g.rechteck, l: g.rechteck.l - 2 * d, t: g.rechteck.t - 2 * d };
		return r.l >= MIN_SEITE_M && r.t >= MIN_SEITE_M ? { ringe: [gegenUhr(rechteckRing(r))], rechteck: r } : null;
	}
	const ring = gegenUhr(g.ringe[0] ?? []), n = ring.length;
	if (n < 3) return null;
	// Jede Kante um d nach links (innen) versetzt; die neue Ecke ist der Schnitt zweier Nachbarkanten.
	const kante = (i: number) => {
		const a = ring[i], b = ring[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
		return { x: a[0] + nx * d, y: a[1] + ny * d, ux: (b[0] - a[0]) / l, uy: (b[1] - a[1]) / l };
	};
	const aus: Punkt[] = [];
	for (let i = 0; i < n; i++) {
		const k1 = kante((i + n - 1) % n), k2 = kante(i);
		const det = k1.ux * k2.uy - k1.uy * k2.ux;
		if (Math.abs(det) < 1e-6) { aus.push([k2.x, k2.y]); continue; }
		const t = ((k2.x - k1.x) * k2.uy - (k2.y - k1.y) * k2.ux) / det;
		aus.push([k1.x + k1.ux * t, k1.y + k1.uy * t]);
	}
	// Bei zu schmalen oder verwinkelten Formen kehrt sich der Ring um oder wächst: dann lieber nichts.
	const f = ringFlaeche(aus), f0 = ringFlaeche(ring);
	const innen = aus.every((p) => drinRing(p, ring));
	return f >= MIN_SEITE_M * MIN_SEITE_M && f < f0 && innen ? { ringe: [aus] } : null;
}

export function normWinkel(g: number): number {
	let w = g % 180;
	if (w > 90) w -= 180;
	if (w <= -90) w += 180;
	return Math.round(w * 100) / 100;
}

/**
 * Die Richtung der nächsten Gebäudekante beim Punkt, in Grad zwischen −45
 * und 45. Damit liegt ein neues Rechteck parallel zum Nachbarn, statt schief
 * im Block zu stehen. Null, wenn im Umkreis keine Kante liegt.
 */
export function ausrichtungBei(objekte: Objekt[], p: Punkt, umkreisM = 60): number | null {
	let best = Infinity, winkel: number | null = null;
	for (const o of objekte) {
		if (o.zustand === 'gestrichen' || !o.ringe.length) continue;
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt' && o.ebene !== 'neubau') continue;
		const r = o.ringe[0];
		// grob vorab: ein Punkt des Rings muss in Reichweite liegen
		if (Math.abs(r[0][0] - p[0]) > umkreisM * 4 || Math.abs(r[0][1] - p[1]) > umkreisM * 4) continue;
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
			const [ax, ay] = r[j], [bx, by] = r[i];
			const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
			if (l2 < 9) continue; // Kanten unter 3 m sind Rauschen
			const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
			const d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
			if (d < best && d <= umkreisM) {
				best = d;
				let w = (Math.atan2(dy, dx) * 180) / Math.PI;
				w = ((w % 90) + 90) % 90;
				if (w > 45) w -= 90;
				winkel = Math.round(w * 100) / 100;
			}
		}
	}
	return winkel;
}

/** Auf eine nahe Ecke fangen, sonst der Punkt selbst. */
export function fangen(objekte: Objekt[], p: Punkt, tolM: number, ohne?: string): Punkt {
	let best = tolM, aus = p;
	for (const o of objekte) {
		if (o.id === ohne || (ohne && o.entwurf === ohne) || o.zustand === 'gestrichen' || o.art !== 'flaeche') continue;
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt' && o.ebene !== 'neubau' && o.herkunft !== 'design') continue;
		for (const r of o.ringe) {
			if (Math.abs(r[0][0] - p[0]) > 400 || Math.abs(r[0][1] - p[1]) > 400) continue;
			for (const q of r) {
				const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
				if (d < best) { best = d; aus = [q[0], q[1]]; }
			}
		}
	}
	return aus;
}

/**
 * Auf die Flucht einer Gebäudekante fangen (Volker, 09.11.2026: „Referenzen
 * umliegender Gebäude, Achsen"): Liegt der Punkt nahe der verlängerten Kante
 * eines Hauses im Umkreis, rückt er auf diese Linie. Zurück kommt der Punkt
 * und das Stück von der Kante bis zu ihm, damit der Plan die Flucht zeigt.
 */
export function fangFlucht(objekte: Objekt[], p: Punkt, tolM: number, ohne?: string, umkreisM = 160): { p: Punkt; linien: { von: Punkt; bis: Punkt }[] } | null {
	type K = { ax: number; ay: number; ux: number; uy: number; quer: number; weit: number; von: Punkt };
	const kand: K[] = [];
	for (const o of objekte) {
		if (o.id === ohne || (ohne && o.entwurf === ohne) || o.zustand === 'gestrichen' || o.art !== 'flaeche') continue;
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt' && o.ebene !== 'neubau') continue;
		for (const r of o.ringe) {
			if (!r.length || Math.abs(r[0][0] - p[0]) > umkreisM * 2 || Math.abs(r[0][1] - p[1]) > umkreisM * 2) continue;
			for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
				const [ax, ay] = r[j], [bx, by] = r[i];
				const ex = bx - ax, ey = by - ay, l = Math.hypot(ex, ey);
				if (l < 6) continue; // kurze Kanten geben keine Flucht
				const ux = ex / l, uy = ey / l;
				// Zwei Fluchten zugleich dürfen etwas weiter weg liegen, deshalb hier mit doppelter Weite sammeln.
				const quer = Math.abs((p[0] - ax) * uy - (p[1] - ay) * ux);
				if (quer > tolM * 2) continue;
				const laengs = (p[0] - ax) * ux + (p[1] - ay) * uy;
				const weit = laengs < 0 ? -laengs : laengs > l ? laengs - l : 0;
				if (weit > umkreisM) continue;
				kand.push({ ax, ay, ux, uy, quer, weit, von: laengs < l / 2 ? [ax, ay] : [bx, by] });
			}
		}
	}
	kand.sort((a, b) => a.quer - b.quer || a.weit - b.weit);
	const k1 = kand[0];
	if (!k1 || k1.quer > tolM) return null;
	const auf = (k: K): Punkt => { const t = (p[0] - k.ax) * k.ux + (p[1] - k.ay) * k.uy; return [k.ax + k.ux * t, k.ay + k.uy * t]; };
	// Eine zweite Flucht quer dazu: Dann sitzt der Punkt im Schnitt beider, wie eine Ecke im Raster der Nachbarn.
	const k2 = kand.find((k) => Math.abs(k.ux * k1.uy - k.uy * k1.ux) > 0.26);
	if (k2) {
		const det = k1.ux * k2.uy - k1.uy * k2.ux;
		const t = ((k2.ax - k1.ax) * k2.uy - (k2.ay - k1.ay) * k2.ux) / det;
		const x: Punkt = [k1.ax + k1.ux * t, k1.ay + k1.uy * t];
		if (Math.hypot(x[0] - p[0], x[1] - p[1]) <= tolM * 2.2) return { p: x, linien: [{ von: k1.von, bis: x }, { von: k2.von, bis: x }] };
	}
	const q = auf(k1);
	return { p: q, linien: [{ von: k1.von, bis: q }] };
}

// ---- Schnitt --------------------------------------------------------------
/** Die Richtung der langen Seite, in Grad gegen den Uhrzeiger von Ost. */
export function hauptWinkel(g: Gestalt): number {
	if (g.rechteck) return g.rechteck.l >= g.rechteck.t ? g.rechteck.winkel : g.rechteck.winkel + 90;
	let best = 0, w = 0;
	for (const r of g.ringe) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
		const l = Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
		if (l > best) { best = l; w = (Math.atan2(r[i][1] - r[j][1], r[i][0] - r[j][0]) * 180) / Math.PI; }
	}
	return w;
}
/** Wo die Gerade `c + t·d` in der Fläche liegt: Abschnitte von t, Höfe ausgenommen. */
export function linieIn(g: { ringe: Punkt[][]; loecher?: Punkt[][] }, c: Punkt, d: Punkt): [number, number][] {
	const ts: number[] = [];
	for (const r of [...g.ringe, ...(g.loecher ?? [])])
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
			const sa = (r[j][0] - c[0]) * -d[1] + (r[j][1] - c[1]) * d[0], sb = (r[i][0] - c[0]) * -d[1] + (r[i][1] - c[1]) * d[0];
			if ((sa > 0) === (sb > 0)) continue;
			const u = sa / (sa - sb);
			ts.push((r[j][0] + u * (r[i][0] - r[j][0]) - c[0]) * d[0] + (r[j][1] + u * (r[i][1] - r[j][1]) - c[1]) * d[1]);
		}
	ts.sort((a, b) => a - b);
	const aus: [number, number][] = [];
	for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k + 1] - ts[k] > 0.05) aus.push([ts[k], ts[k + 1]]);
	return aus;
}
/** Ein geschnittener Körper: von a bis b entlang der Schnittlinie, von unten bis oben in Metern. */
export type Schnittflaeche = { a: number; b: number; unten: number; oben: number };
export type Schnitt = {
	/** Die Schnittlinie im Plan. */
	von: Punkt; bis: Punkt;
	t0: number; t1: number;
	eigen: Schnittflaeche[];
	nachbarn: Schnittflaeche[];
	/** Die gewählte Form im Schnitt: ihre Abschnitte und ihr Geschossbereich in Metern. */
	form: (Schnittflaeche & { art: 'masse' | 'aussparung' })[];
	/** Oberkante des Gebäudes (Grundkörper) in Metern und seine Abschnitte, für den Griff. */
	traufe: number;
	hoch: number;
	umgebung: { mittel: number | null; max: number | null; n: number };
};
/** Höhen der Gebäude im Umkreis: Mittel (Median) und höchstes, nur wo OSM eine Höhe oder Geschosse führt. */
export function umgebungHoehen(objekte: Objekt[], c: Punkt, radiusM = 150) {
	const h: number[] = [];
	for (const o of objekte) {
		if ((o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') || o.zustand === 'gestrichen' || o.teil || o.hoeheM === undefined || !o.ringe.length) continue;
		const [x, y] = o.ringe[0][0];
		if (Math.hypot(x - c[0], y - c[1]) <= radiusM) h.push(o.hoeheM);
	}
	h.sort((a, b) => a - b);
	return { mittel: h.length ? h[Math.floor(h.length / 2)] : null, max: h.length ? h[h.length - 1] : null, n: h.length };
}
/**
 * Ein echter Schnitt durch ein Gebäude, mit den Nachbarn, die die Linie
 * trifft (09.11.2026; vorher standen die Formen als Balken nebeneinander).
 * Quer zur langen Seite der gewählten Form oder des Gebäudes, auf Wunsch längs.
 */
export function schnittDurch(o: Neubau, form: Form | null, objekte: Objekt[], laengs: boolean, randM = 45): Schnitt {
	const bezug: Gestalt = form ?? o;
	const w = rad(hauptWinkel(bezug) + (laengs ? 0 : 90));
	const d: Punkt = [Math.cos(w), Math.sin(w)], c = drehMitte(bezug);
	const gh = o.geschossHoeheM, teile = teileVon(o);
	const eigen: Schnittflaeche[] = teile.flatMap((t) => linieIn(t, c, d).map(([a, b]) => ({ a, b, unten: t.unterM ?? 0, oben: t.hoeheM ?? 0 })));
	// Der Rahmen des Schnitts: das ganze Gebäude samt seinen Formen, plus Rand für die Nachbarn
	let t0 = Infinity, t1 = -Infinity;
	for (const g of [o, ...(o.formen ?? [])]) for (const r of g.ringe) for (const [x, y] of r) {
		const t = (x - c[0]) * d[0] + (y - c[1]) * d[1];
		if (t < t0) t0 = t; if (t > t1) t1 = t;
	}
	t0 -= randM; t1 += randM;
	const nachbarn: Schnittflaeche[] = [];
	for (const n of objekte) {
		if ((n.ebene !== 'gebaeude' && n.ebene !== 'erhalt') || n.zustand === 'gestrichen' || !n.ringe.length) continue;
		const [x, y] = n.ringe[0][0];
		const t = (x - c[0]) * d[0] + (y - c[1]) * d[1], q = Math.abs((x - c[0]) * -d[1] + (y - c[1]) * d[0]);
		if (t < t0 - 300 || t > t1 + 300 || q > 400) continue;
		for (const [a, b] of linieIn(n, c, d)) if (b > t0 && a < t1) nachbarn.push({ a: Math.max(a, t0), b: Math.min(b, t1), unten: n.unterM ?? 0, oben: n.hoeheM ?? 8 });
	}
	const oben = Math.max(o.geschosse, ...(o.formen ?? []).filter((f) => f.art === 'masse' && !f.aus).map((f) => f.bis ?? o.geschosse));
	const fo = form ? linieIn(form, c, d).map(([a, b]) => ({ a, b, unten: form.von * gh, oben: Math.min(oben, form.bis ?? oben) * gh, art: form.art })) : [];
	const umgebung = umgebungHoehen(objekte, drehMitte(o));
	const hoch = Math.max(oben * gh, ...nachbarn.map((n) => n.oben), umgebung.mittel ?? 0, 6);
	return { von: [c[0] + d[0] * t0, c[1] + d[1] * t0], bis: [c[0] + d[0] * t1, c[1] + d[1] * t1], t0, t1, eigen, nachbarn, form: fo, traufe: o.geschosse * gh, hoch, umgebung };
}

/** Rechtwinklig zum letzten Stück, in Schritten von 45 Grad zum Bezugswinkel. */
export function gerade(von: Punkt, p: Punkt, bezug: number): Punkt {
	const d = Math.hypot(p[0] - von[0], p[1] - von[1]);
	if (!d) return p;
	const w = (Math.atan2(p[1] - von[1], p[0] - von[0]) * 180) / Math.PI;
	const s = Math.round((w - bezug) / 45) * 45 + bezug;
	// Länge entlang der gefangenen Richtung, nicht die des Zeigers
	const c = Math.cos(rad(s)), si = Math.sin(rad(s));
	const l = (p[0] - von[0]) * c + (p[1] - von[1]) * si;
	return [von[0] + l * c, von[1] + l * si];
}

/**
 * Kennzahlen der eigenen Gebäude und Grünflächen, in Quadratmetern.
 * Grundfläche ist die überbaute Fläche, also alle Teile von oben gesehen;
 * die BGF zählt jedes Teil mal seine Geschosse.
 */
export function kennzahlen(liste: Neubau[]) {
	let grund = 0, bgf = 0, gruen = 0, anzahl = 0;
	for (const o of liste) {
		if (o.typ === 'gruen') { gruen += grundflaeche(o); continue; }
		anzahl++;
		const teile = teileVon(o);
		for (const t of teile) bgf += grundflaeche(t) * (t.geschosse ?? 0);
		const mps = teile.map((t) => alsMulti(t)).filter((m) => m.length);
		grund += mps.length > 1 ? multiFlaeche(polygonClipping.union(mps[0], ...mps.slice(1))) : mps.length ? multiFlaeche(mps[0]) : 0;
	}
	return { grund, bgf, gruen, anzahl };
}
