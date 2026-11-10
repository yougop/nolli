import earcut from 'earcut';

/**
 * Importierte Körper mit fester 3D-Form (Volker, 10.11.2026).
 *
 * Ein importiertes Gebäude bleibt in Nolli ein Neubau mit Umriss, aber seine
 * Form kommt aus der Datei: Dreiecke, nicht Geschosse mal Umriss. Sie lässt
 * sich verschieben und drehen, ändern lässt sie sich nur in ihrem Programm.
 *
 * Gespeichert sind die Dreiecke um die Mitte, unten auf null. Eine Bewegung
 * ändert nur `mitte` und `grad`, die oft große Liste bleibt dieselbe.
 */
export type Fest = {
	/** Dreiecke als x y z je Ecke, in Metern, um `mitte`, tiefster Punkt auf null. */
	p: number[];
	mitte: [number, number];
	grad: number;
	datei: string;
};
export type Kasten4 = { x0: number; y0: number; x1: number; y1: number };

const weltSpeicher = new WeakMap<Fest, number[]>();
const kantenSpeicher = new WeakMap<Fest, number[]>();
const aufsichtSpeicher = new WeakMap<Fest, number[]>();

/** Die Dreiecke im Ortsgitter, z über dem Boden des Körpers. */
export function festDreiecke(f: Fest): number[] {
	const alt = weltSpeicher.get(f);
	if (alt) return alt;
	const c = Math.cos((f.grad * Math.PI) / 180), s = Math.sin((f.grad * Math.PI) / 180);
	const aus = new Array<number>(f.p.length);
	for (let i = 0; i < f.p.length; i += 3) {
		aus[i] = f.mitte[0] + f.p[i] * c - f.p[i + 1] * s;
		aus[i + 1] = f.mitte[1] + f.p[i] * s + f.p[i + 1] * c;
		aus[i + 2] = f.p[i + 2];
	}
	weltSpeicher.set(f, aus);
	return aus;
}

/**
 * Die Dreiecke auf dem Boden, nach Rahmen getrennt: drinnen oder draußen
 * zählt der Schwerpunkt. Ein Dreieck wird nicht zerschnitten, die Form aus
 * der Datei bleibt so, wie sie gezeichnet ist.
 */
export function festTeil(f: Fest, boden: number, k: Kasten4 | null, innen = true): number[] {
	const d = festDreiecke(f), aus: number[] = [];
	for (let i = 0; i < d.length; i += 9) {
		const mx = (d[i] + d[i + 3] + d[i + 6]) / 3, my = (d[i + 1] + d[i + 4] + d[i + 7]) / 3;
		const drin = !k || (mx >= k.x0 && mx <= k.x1 && my >= k.y0 && my <= k.y1);
		if (drin !== innen) continue;
		aus.push(d[i], d[i + 1], d[i + 2] + boden, d[i + 3], d[i + 4], d[i + 5] + boden, d[i + 6], d[i + 7], d[i + 8] + boden);
	}
	return aus;
}

/**
 * Die Kanten, die man von oben sieht, für die Pläne (Volker, 10.11.2026): Grate
 * und Stufen der Form, wie die Innenkanten am Bestand. Als Strecken x y x y im
 * Ortsgitter. Eine Kante zählt, wenn dort eine nach oben zeigende Fläche
 * knickt; was unter einem Überhang liegt, fällt stückweise weg.
 */
export function festAufsicht(f: Fest, knickGrad = 20): number[] {
	const alt = aufsichtSpeicher.get(f);
	if (alt) return alt;
	const d = festDreiecke(f), grenze = Math.cos((knickGrad * Math.PI) / 180);
	const sch = (a: number) => `${Math.round(d[a] * 100)},${Math.round(d[a + 1] * 100)},${Math.round(d[a + 2] * 100)}`;
	const karte = new Map<string, { a: number; b: number; n: [number, number, number]; oben: boolean; zwei: boolean; knick: boolean }>();
	const oben: number[] = [];
	for (let i = 0; i < d.length; i += 9) {
		const ux = d[i + 3] - d[i], uy = d[i + 4] - d[i + 1], uz = d[i + 5] - d[i + 2];
		const vx = d[i + 6] - d[i], vy = d[i + 7] - d[i + 1], vz = d[i + 8] - d[i + 2];
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
		const hoch = nz > 0.05;
		if (hoch) oben.push(i);
		for (const [a, b] of [[i, i + 3], [i + 3, i + 6], [i + 6, i]]) {
			const sa = sch(a), sb = sch(b);
			if (sa === sb) continue;
			const s = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
			const e = karte.get(s);
			if (!e) karte.set(s, { a, b, n: [nx, ny, nz], oben: hoch, zwei: false, knick: false });
			else { e.zwei = true; e.oben ||= hoch; if (e.n[0] * nx + e.n[1] * ny + e.n[2] * nz < grenze) e.knick = true; }
		}
	}
	// Ein Raster über den Dachflächen, damit die Frage „was liegt darüber?“ billig bleibt.
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (let i = 0; i < d.length; i += 3) { x0 = Math.min(x0, d[i]); x1 = Math.max(x1, d[i]); y0 = Math.min(y0, d[i + 1]); y1 = Math.max(y1, d[i + 1]); }
	const zelle = Math.max(Math.max(x1 - x0, y1 - y0) / 64, 0.5), nx = Math.ceil((x1 - x0) / zelle) + 1;
	const raster = new Map<number, number[]>();
	const ix = (x: number) => Math.floor((x - x0) / zelle), iy = (y: number) => Math.floor((y - y0) / zelle);
	for (const t of oben) {
		const xs = [d[t], d[t + 3], d[t + 6]], ys = [d[t + 1], d[t + 4], d[t + 7]];
		for (let i = ix(Math.min(...xs)); i <= ix(Math.max(...xs)); i++) for (let j = iy(Math.min(...ys)); j <= iy(Math.max(...ys)); j++) {
			const k = i + j * nx; (raster.get(k) ?? raster.set(k, []).get(k)!).push(t);
		}
	}
	const hoechste = (x: number, y: number) => {
		let z = -Infinity;
		for (const t of raster.get(ix(x) + iy(y) * nx) ?? []) {
			const ax = d[t], ay = d[t + 1], bx = d[t + 3] - ax, by = d[t + 4] - ay, cx = d[t + 6] - ax, cy = d[t + 7] - ay, n = bx * cy - by * cx;
			if (Math.abs(n) < 1e-9) continue;
			const u = ((x - ax) * cy - (y - ay) * cx) / n, v = (bx * (y - ay) - by * (x - ax)) / n;
			if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
			z = Math.max(z, d[t + 2] + u * (d[t + 5] - d[t + 2]) + v * (d[t + 8] - d[t + 2]));
		}
		return z;
	};
	const aus: number[] = [];
	for (const e of karte.values()) {
		if (!e.oben || (e.zwei && !e.knick)) continue;
		const [ax, ay, az, bx, by, bz] = [d[e.a], d[e.a + 1], d[e.a + 2], d[e.b], d[e.b + 1], d[e.b + 2]];
		const flach = Math.hypot(bx - ax, by - ay);
		if (flach < 0.02) continue;
		const n = Math.min(32, Math.max(1, Math.ceil(flach)));
		const punkt = (t: number) => [ax + (bx - ax) * t, ay + (by - ay) * t];
		let anfang: number | null = null;
		for (let i = 0; i <= n; i++) {
			const sicht = i < n && az + ((bz - az) * (i + 0.5)) / n >= hoechste(...(punkt((i + 0.5) / n) as [number, number])) - 0.05;
			if (sicht && anfang === null) anfang = i;
			if (!sicht && anfang !== null) { aus.push(...punkt(anfang / n), ...punkt(i / n)); anfang = null; }
		}
	}
	aufsichtSpeicher.set(f, aus);
	return aus;
}

/**
 * Die Form am Kasten geschnitten und an den Schnitten geschlossen, für den
 * 3D-Druck (Volker, 10.11.2026: importierte Gebäude ließen sich nicht teilen).
 * Eine Kachel braucht einen Körper, der an ihrer Kante endet; ein Dreieck, das
 * darüber hinausragt, stünde in der Fuge. Jede Ebene schneidet das Ergebnis
 * der vorigen, so schließen die Deckel auch an den Ecken.
 */
export function festImKasten(f: Fest, boden: number, k: Kasten4): number[] {
	let d = festTeil(f, boden, null);
	for (const [achse, wert, plus] of [[0, k.x0, true], [0, k.x1, false], [1, k.y0, true], [1, k.y1, false]] as const) d = anEbene(d, achse, wert, plus);
	return d;
}

/** Vorzeichen der Seite: Was bleibt, hat `s >= 0`. */
function anEbene(d: number[], achse: 0 | 1, wert: number, plus: boolean): number[] {
	const aus: number[] = [], kanten: [number[], number[]][] = [];
	const seite = (i: number) => (plus ? d[i + achse] - wert : wert - d[i + achse]);
	const P = (i: number) => [d[i], d[i + 1], d[i + 2]];
	/** Der Schnittpunkt, immer von derselben Ecke aus gerechnet: Beide Dreiecke an der Kante treffen genau denselben Wert. */
	const schnitt = (a: number, b: number) => {
		const tausch = d[a] > d[b] || (d[a] === d[b] && (d[a + 1] > d[b + 1] || (d[a + 1] === d[b + 1] && d[a + 2] > d[b + 2])));
		const [u, v] = tausch ? [b, a] : [a, b];
		const t = (wert - d[u + achse]) / (d[v + achse] - d[u + achse]);
		return [d[u] + (d[v] - d[u]) * t, d[u + 1] + (d[v + 1] - d[u + 1]) * t, d[u + 2] + (d[v + 2] - d[u + 2]) * t];
	};
	for (let i = 0; i < d.length; i += 9) {
		const e = [i, i + 3, i + 6], s = e.map(seite);
		if (s.every((x) => x >= 0)) { for (let j = 0; j < 9; j++) aus.push(d[i + j]); continue; }
		if (s.every((x) => x < 0)) continue;
		const poly: number[][] = [];
		let rein: number[] | null = null, raus: number[] | null = null;
		for (let n = 0; n < 3; n++) {
			const a = e[n], b = e[(n + 1) % 3], sa = s[n], sb = s[(n + 1) % 3];
			if (sa >= 0) poly.push(P(a));
			if ((sa >= 0) !== (sb >= 0)) { const q = schnitt(a, b); poly.push(q); if (sa >= 0) raus = q; else rein = q; }
		}
		for (let n = 1; n + 1 < poly.length; n++) aus.push(...poly[0], ...poly[n], ...poly[n + 1]);
		if (rein && raus) kanten.push([raus, rein]);
	}
	if (kanten.length) deckel(kanten, achse, plus, aus);
	return aus;
}

/** Aus den Schnittkanten geschlossene Züge, daraus die Deckel, mit Löchern. */
function deckel(kanten: [number[], number[]][], achse: 0 | 1, plus: boolean, aus: number[]) {
	const sch = (p: number[]) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
	const ab = new Map<string, [number[], number[]][]>();
	for (const k of kanten) { if (sch(k[0]) === sch(k[1])) continue; const s = sch(k[0]); (ab.get(s) ?? ab.set(s, []).get(s)!).push(k); }
	const u = achse === 0 ? 1 : 0;
	const zuege: number[][][] = [];
	for (const start of [...ab.keys()]) {
		while (ab.get(start)?.length) {
			const zug: number[][] = [];
			let k = ab.get(start)!.pop()!, zu = false;
			for (let n = 0; n <= kanten.length; n++) {
				zug.push(k[0]);
				const s = sch(k[1]);
				if (s === start) { zu = true; break; }
				const w = ab.get(s)?.pop();
				if (!w) break;
				k = w;
			}
			if (zu && zug.length >= 3) zuege.push(zug);
		}
	}
	const flaeche = (z: number[][]) => z.reduce((a, p, i) => { const q = z[(i + 1) % z.length]; return a + p[u] * q[2] - q[u] * p[2]; }, 0) / 2;
	const drin = (p: number[], z: number[][]) => {
		let r = false;
		for (let i = 0, j = z.length - 1; i < z.length; j = i++) if ((z[i][2] > p[2]) !== (z[j][2] > p[2]) && p[u] < ((z[j][u] - z[i][u]) * (p[2] - z[i][2])) / (z[j][2] - z[i][2]) + z[i][u]) r = !r;
		return r;
	};
	const sortiert = zuege.map((z) => ({ z, a: Math.abs(flaeche(z)) })).sort((a, b) => b.a - a.a);
	const gruppen: { aussen: number[][]; loecher: number[][][] }[] = [];
	for (const { z } of sortiert) {
		const um = gruppen.filter((g) => drin(z[0], g.aussen) && !g.loecher.some((l) => drin(z[0], l)));
		// Das kleinste umgebende Außen; liegt der Zug in keinem, beginnt er ein eigenes.
		if (um.length) um[um.length - 1].loecher.push(z); else gruppen.push({ aussen: z, loecher: [] });
	}
	for (const g of gruppen) {
		const alle = [g.aussen, ...g.loecher], flach: number[] = [], loch: number[] = [], ecken: number[][] = [];
		let n = 0;
		alle.forEach((z, i) => { if (i) loch.push(n); for (const p of z) { flach.push(p[u], p[2]); ecken.push(p); n++; } });
		const t = earcut(flach, loch, 2);
		for (let i = 0; i < t.length; i += 3) {
			const a = ecken[t[i]], b = ecken[t[i + 1]], c = ecken[t[i + 2]];
			// Der Deckel schaut von dem Körper weg, also gegen die behaltene Seite.
			const n0 = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), n1 = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
			const nach = achse === 0 ? n0 : n1, richtig = plus ? nach < 0 : nach > 0;
			aus.push(...a, ...(richtig ? b : c), ...(richtig ? c : b));
		}
	}
}

/** Sichtbare Kanten: am Rand der Fläche und wo zwei Dreiecke knicken. Strecken als x y z x y z. */
export function festKanten(f: Fest, boden: number, k: Kasten4, knickGrad = 20): number[] {
	let roh = kantenSpeicher.get(f);
	if (!roh) {
		const d = festDreiecke(f);
		const schluessel = (a: number) => `${Math.round(d[a] * 100)},${Math.round(d[a + 1] * 100)},${Math.round(d[a + 2] * 100)}`;
		const karte = new Map<string, { a: number; b: number; n: [number, number, number]; zwei: boolean; knick: boolean }>();
		const grenze = Math.cos((knickGrad * Math.PI) / 180);
		for (let i = 0; i < d.length; i += 9) {
			const ux = d[i + 3] - d[i], uy = d[i + 4] - d[i + 1], uz = d[i + 5] - d[i + 2];
			const vx = d[i + 6] - d[i], vy = d[i + 7] - d[i + 1], vz = d[i + 8] - d[i + 2];
			let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
			const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
			for (const [a, b] of [[i, i + 3], [i + 3, i + 6], [i + 6, i]]) {
				const sa = schluessel(a), sb = schluessel(b);
				if (sa === sb) continue;
				const s = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
				const e = karte.get(s);
				if (!e) karte.set(s, { a, b, n: [nx, ny, nz], zwei: false, knick: false });
				else { e.zwei = true; if (e.n[0] * nx + e.n[1] * ny + e.n[2] * nz < grenze) e.knick = true; }
			}
		}
		roh = [];
		for (const e of karte.values()) if (!e.zwei || e.knick) roh.push(d[e.a], d[e.a + 1], d[e.a + 2], d[e.b], d[e.b + 1], d[e.b + 2]);
		kantenSpeicher.set(f, roh);
	}
	const aus: number[] = [];
	const drin = (x: number, y: number) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1;
	for (let i = 0; i < roh.length; i += 6) {
		if (!drin(roh[i], roh[i + 1]) || !drin(roh[i + 3], roh[i + 4])) continue;
		aus.push(roh[i], roh[i + 1], roh[i + 2] + boden, roh[i + 3], roh[i + 4], roh[i + 5] + boden);
	}
	return aus;
}
