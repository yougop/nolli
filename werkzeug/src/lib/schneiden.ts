/**
 * Geometrie am Polygon schneiden.
 *
 * Fuer das Freiraeumen eines Plangebiets reicht es nicht, Objekte ganz zu
 * behalten oder ganz zu verwerfen. Eine Strasse, die das Gebiet quert, soll
 * an der Grenze enden und draussen weiterlaufen. Flaechen dagegen werden
 * ganz genommen oder ganz gelassen: Ein halbes Gebaeude ist keine Aussage,
 * ein bis zur Grenze gefuehrter Weg schon.
 */
export type Punkt = [number, number];

/** Punkt im Polygon, Strahlverfahren. */
export function drin([x, y]: Punkt, p: Punkt[]): boolean {
	let innen = false;
	for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
		const [xi, yi] = p[i], [xj, yj] = p[j];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) innen = !innen;
	}
	return innen;
}

/** Schnittpunkte einer Strecke mit allen Polygonkanten, als Lagen 0..1. */
function lagen(a: Punkt, b: Punkt, p: Punkt[]): number[] {
	const aus: number[] = [];
	const dx = b[0] - a[0], dy = b[1] - a[1];
	for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
		const [cx, cy] = p[j], [ex, ey] = p[i];
		const ex2 = ex - cx, ey2 = ey - cy;
		const nenner = dx * ey2 - dy * ex2;
		if (Math.abs(nenner) < 1e-12) continue;
		const t = ((cx - a[0]) * ey2 - (cy - a[1]) * ex2) / nenner;
		const u = ((cx - a[0]) * dy - (cy - a[1]) * dx) / nenner;
		if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) aus.push(t);
	}
	return aus.sort((x, y) => x - y);
}

/**
 * Einen Linienzug am Polygon schneiden und nur behalten, was draussen liegt.
 * Ergebnis sind null, ein oder mehrere Teilzuege.
 */
export function ausserhalb(zug: Punkt[], polygon: Punkt[]): Punkt[][] {
	if (zug.length < 2) return drin(zug[0] ?? [0, 0], polygon) ? [] : [zug];
	const teile: Punkt[][] = [];
	let lauf: Punkt[] = [];

	for (let i = 1; i < zug.length; i++) {
		const a = zug[i - 1], b = zug[i];
		const ts = [0, ...lagen(a, b, polygon), 1];
		for (let k = 1; k < ts.length; k++) {
			const t0 = ts[k - 1], t1 = ts[k];
			const p0: Punkt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
			const p1: Punkt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
			const mitte: Punkt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
			if (drin(mitte, polygon)) {
				if (lauf.length > 1) teile.push(lauf);
				lauf = [];
			} else {
				if (!lauf.length) lauf.push(p0);
				lauf.push(p1);
			}
		}
	}
	if (lauf.length > 1) teile.push(lauf);
	return teile;
}

/** Beruehrt der Zug das Polygon irgendwo? Fuer die Auswahl von Linien. */
export function beruehrt(zug: Punkt[], polygon: Punkt[]): boolean {
	for (const p of zug) if (drin(p, polygon)) return true;
	for (let i = 1; i < zug.length; i++)
		if (lagen(zug[i - 1], zug[i], polygon).length) return true;
	return false;
}

export function schwerpunkt(ringe: Punkt[][]): Punkt {
	const r = ringe[0] ?? [];
	let x = 0, y = 0;
	for (const p of r) { x += p[0]; y += p[1]; }
	return r.length ? [x / r.length, y / r.length] : [0, 0];
}

/**
 * Eine Halbebene: behalten wird, wo `a·x + b·y + c >= 0`.
 */
export type Halbebene = { a: number; b: number; c: number };

/**
 * Ring an einer konvexen Region schneiden (Sutherland-Hodgman).
 *
 * Nur fuer konvexe Schnittgebiete gueltig — ein Rechteck und jeder seiner
 * vier Aussenstreifen sind konvex, deshalb reicht es hier.
 *
 * Ein einspringender Ring, der die Region mehrfach verlaesst und wieder
 * betritt, kommt als ein Polygon zurueck, dessen Kanten dann ein Stueck weit
 * auf der Grenze laufen. Fuer eine Extrusion ist das richtig: Die Wand steht
 * dort, wo die Grenze ist.
 */
export function anRegion(ring: Punkt[], region: Halbebene[]): Punkt[] {
	let aus = ring;
	for (const { a, b, c } of region) {
		if (aus.length < 3) return [];
		const ein: Punkt[] = [];
		const wert = (p: Punkt) => a * p[0] + b * p[1] + c;
		for (let i = 0, j = aus.length - 1; i < aus.length; j = i++) {
			const p = aus[i], q = aus[j];
			const wp = wert(p), wq = wert(q);
			if (wp >= 0) {
				if (wq < 0) {
					const t = wq / (wq - wp);
					ein.push([q[0] + t * (p[0] - q[0]), q[1] + t * (p[1] - q[1])]);
				}
				ein.push(p);
			} else if (wq >= 0) {
				const t = wq / (wq - wp);
				ein.push([q[0] + t * (p[0] - q[0]), q[1] + t * (p[1] - q[1])]);
			}
		}
		aus = ein;
	}
	return aus.length >= 3 ? aus : [];
}

/**
 * Einen Ring am Rahmen in das Stueck drinnen und die Stuecke draussen zerlegen.
 *
 * Die vier Aussenstreifen — links, rechts, unten, oben — ueberlappen einander
 * nicht und ergeben zusammen mit dem Rechteck die ganze Ebene. Es geht also
 * nichts verloren und nichts wird doppelt gezaehlt.
 *
 * Wozu: Ein Baukoerper, der die Rahmenkante kreuzt, kam bisher ganz mit und
 * ragte damit ueber die Bodentextur hinaus — im Modell sichtbar als Haus, das
 * ueber die Kante der Platte steht. Ihn einfach abzuschneiden waere aber
 * falsch: Im HafenCity-Rahmen kreuzen 62 von 624 Gebaeuden die Kante, und sie
 * halten 29 Prozent der Grundflaeche. Was draussen liegt, wirft Schatten
 * herein. Deshalb wird getrennt statt weggeworfen; wer nur den Rahmen zeigen
 * will, nimmt `innen`, wer Verschattung rechnet, nimmt beides.
 */
export function amRahmen(ring: Punkt[], x0: number, y0: number, x1: number, y1: number) {
	const L = { a: -1, b: 0, c: x0 };   // x <= x0
	const R = { a: 1, b: 0, c: -x1 };   // x >= x1
	const U = { a: 0, b: -1, c: y0 };   // y <= y0
	const O = { a: 0, b: 1, c: -y1 };   // y >= y1
	const drinnen = [
		{ a: 1, b: 0, c: -x0 }, { a: -1, b: 0, c: x1 },
		{ a: 0, b: 1, c: -y0 }, { a: 0, b: -1, c: y1 }
	];
	const streifen = [
		[L],                                                    // ganz links
		[R],                                                    // ganz rechts
		[U, { a: 1, b: 0, c: -x0 }, { a: -1, b: 0, c: x1 }],    // unten, zwischen den Kanten
		[O, { a: 1, b: 0, c: -x0 }, { a: -1, b: 0, c: x1 }]     // oben, zwischen den Kanten
	];
	return {
		innen: anRegion(ring, drinnen),
		aussen: streifen.map((s) => anRegion(ring, s)).filter((p) => p.length >= 3)
	};
}
