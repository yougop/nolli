/**
 * Meer aus Küstenlinien.
 *
 * OpenStreetMap erfasst Seen und Flüsse als Flächen, das Meer aber nicht. Es
 * ist nur durch `natural=coastline` gegeben: Linien, die so laufen, dass das
 * Land links und das Wasser rechts liegt. Am 26.10.2026 in Manhattan
 * aufgefallen: Der Hudson stand als Fläche im Plan und hörte an der Battery
 * schräg auf, die Upper New York Bay südlich davon blieb weiß.
 *
 * Gerechnet wird wie in den üblichen Kartenprogrammen, nur auf einen Kasten
 * beschränkt: Die Küstenlinien werden zu Ketten verbunden und am Kasten
 * geschnitten. Jedes Stück läuft von einem Eintritt zu einem Austritt, das
 * Wasser zur Rechten. Vom Austritt geht es im Uhrzeigersinn am Kastenrand
 * entlang bis zum nächsten Eintritt — so bleibt das Wasser weiter rechts —,
 * und so fort, bis der Ring sich schließt. Geschlossene Küsten ganz im Kasten
 * sind Inseln und werden zu Löchern.
 *
 * Ist die Küste lückenhaft — ein Stück endet mitten im Kasten —, gibt es kein
 * Meer statt eines falschen. Ein falsch gefülltes Meer überdeckt eine Stadt;
 * ein fehlendes ist nur weiß.
 */

type P = [number, number];
export type Kasten = { x0: number; y0: number; x1: number; y1: number };

const gleich = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];

/** Küstenstücke in Laufrichtung zu Ketten verbinden. Nie umdrehen: Die Richtung trägt die Bedeutung. */
function ketten(linien: P[][]): P[][] {
	const offen = linien.filter((l) => l.length >= 2).map((l) => [...l]);
	const fertig: P[][] = [];
	while (offen.length) {
		let k = offen.shift()!;
		for (let weiter = true; weiter && !gleich(k[0], k[k.length - 1]);) {
			weiter = false;
			for (let i = 0; i < offen.length; i++) {
				const t = offen[i];
				if (gleich(t[0], k[k.length - 1])) { k = k.concat(t.slice(1)); offen.splice(i, 1); weiter = true; break; }
				if (gleich(t[t.length - 1], k[0])) { k = t.concat(k.slice(1)); offen.splice(i, 1); weiter = true; break; }
			}
		}
		fertig.push(k);
	}
	return fertig;
}

const drin = (p: P, b: Kasten) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;

/** Schnitt der Strecke a→b mit dem Kasten nach Liang–Barsky: Anteil t von Eintritt und Austritt. */
function schnitt(a: P, b: P, k: Kasten): [number, number] | null {
	let t0 = 0, t1 = 1;
	const dx = b[0] - a[0], dy = b[1] - a[1];
	for (const [p, q] of [[-dx, a[0] - k.x0], [dx, k.x1 - a[0]], [-dy, a[1] - k.y0], [dy, k.y1 - a[1]]]) {
		if (p === 0) { if (q < 0) return null; continue; }
		const r = q / p;
		if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
		else { if (r < t0) return null; if (r < t1) t1 = r; }
	}
	return [t0, t1];
}

const auf = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Eine Kette in die Stücke im Kasten zerlegen.
 *
 * `null`, wenn ein Stück im Kasten anfängt oder endet: Dann fehlt Küste, und
 * jede Füllung wäre geraten.
 */
function zerlegen(kette: P[], k: Kasten): P[][] | null {
	let pts = kette;
	if (gleich(pts[0], pts[pts.length - 1])) {
		// Geschlossen und den Kasten kreuzend: an einem Punkt draußen beginnen,
		// sonst würde ein Stück über den Anfang hinweg zerschnitten.
		const i = pts.findIndex((p) => !drin(p, k));
		if (i > 0) pts = [...pts.slice(i, -1), ...pts.slice(0, i + 1)];
	}
	const stuecke: P[][] = [];
	let jetzt: P[] | null = drin(pts[0], k) ? [pts[0]] : null;
	if (jetzt) return null;   // beginnt im Kasten
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i], b = pts[i + 1];
		const s = schnitt(a, b, k);
		if (!s) continue;
		const [t0, t1] = s;
		if (!jetzt) jetzt = [auf(a, b, t0)];
		if (t1 < 1) { jetzt.push(auf(a, b, t1)); stuecke.push(jetzt); jetzt = null; }
		else jetzt.push(b);
	}
	if (jetzt) return null;   // endet im Kasten
	return stuecke.filter((s) => s.length >= 2);
}

/** Lage eines Randpunkts als Weg im Uhrzeigersinn, ab der linken oberen Ecke. */
function lage(p: P, k: Kasten): number {
	const b = k.x1 - k.x0, h = k.y1 - k.y0, e = 1e-6 * (b + h);
	if (Math.abs(p[1] - k.y1) < e) return p[0] - k.x0;
	if (Math.abs(p[0] - k.x1) < e) return b + (k.y1 - p[1]);
	if (Math.abs(p[1] - k.y0) < e) return b + h + (k.x1 - p[0]);
	return 2 * b + h + (p[1] - k.y0);
}

function ecken(k: Kasten): { s: number; p: P }[] {
	const b = k.x1 - k.x0, h = k.y1 - k.y0;
	return [
		{ s: b, p: [k.x1, k.y1] }, { s: b + h, p: [k.x1, k.y0] },
		{ s: 2 * b + h, p: [k.x0, k.y0] }, { s: 2 * b + 2 * h, p: [k.x0, k.y1] }
	];
}

function innen(p: P, ring: P[]) {
	let c = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i], [xj, yj] = ring[j];
		if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
}

/** Die Meeresflächen im Kasten, jede mit ihren Inseln als Löchern. */
export function meer(linien: P[][], k: Kasten): { ring: P[]; loecher: P[][] }[] {
	if (!linien.length) return [];
	const umfang = 2 * (k.x1 - k.x0) + 2 * (k.y1 - k.y0);
	const stuecke: P[][] = [];
	const inseln: P[][] = [];
	for (const kette of ketten(linien)) {
		const geschlossen = gleich(kette[0], kette[kette.length - 1]);
		if (geschlossen && kette.every((p) => drin(p, k))) { inseln.push(kette); continue; }
		const z = zerlegen(kette, k);
		if (!z) return [];
		stuecke.push(...z);
	}

	const ringe: P[][] = [];
	if (!stuecke.length) {
		// Keine Küste kreuzt den Kasten. Nur wenn Inseln darin liegen, ist
		// klar, dass rundherum Meer ist.
		if (!inseln.length) return [];
		ringe.push([[k.x0, k.y1], [k.x1, k.y1], [k.x1, k.y0], [k.x0, k.y0]]);
	} else {
		const frei = new Set(stuecke.map((_, i) => i));
		const eintritt = stuecke.map((s) => lage(s[0], k));
		while (frei.size) {
			const start = frei.values().next().value as number;
			let i = start;
			const ring: P[] = [];
			for (let schritt = 0; schritt <= stuecke.length; schritt++) {
				frei.delete(i);
				ring.push(...stuecke[i]);
				const aus = lage(stuecke[i][stuecke[i].length - 1], k);
				// Der nächste Eintritt im Uhrzeigersinn, auch der eigene.
				let naechster = -1, abstand = Infinity;
				for (let j = 0; j < stuecke.length; j++) {
					if (j !== start && !frei.has(j)) continue;
					const d = (eintritt[j] - aus + umfang) % umfang;
					if (d < abstand) { abstand = d; naechster = j; }
				}
				if (naechster < 0) return [];
				// Die Kastenecken auf dem Weg dorthin, in Laufrichtung.
				ring.push(...ecken(k)
					.map((e) => ({ d: (e.s - aus + umfang) % umfang, p: e.p }))
					.filter((e) => e.d > 0 && e.d < abstand)
					.sort((a, b) => a.d - b.d)
					.map((e) => e.p));
				if (naechster === start) break;
				i = naechster;
			}
			if (ring.length >= 3) ringe.push(ring);
		}
	}
	return ringe.map((ring) => ({ ring, loecher: inseln.filter((i) => innen(i[0], ring)) }));
}
