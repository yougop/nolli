import { type Gelaende, hoeheBei } from '../geo/gelaende';
import type { Rahmen } from '$lib/geo/rahmen';
import { BAUM } from '$lib/analysedaten';

/**
 * Die Kronen als Wavefront OBJ.
 *
 * Warum ueberhaupt, wenn `daten/baeume.json` dieselben Baeume traegt: Das
 * Paket versorgt Werkzeuge, ein Ausgang versorgt einen Menschen, der etwas
 * woanders hin mitnimmt — nach Rhino, nach Blender, in eine Praesentation.
 * Dort ist fertige Geometrie richtig, weil das Zielprogramm sie nicht selbst
 * erzeugen kann. Seit dem 19.10.2026 kein eigener Ausgang mehr, sondern
 * ein Körper `trees` in `model.obj`, wenn die Bäume eingeschaltet sind. Das
 * kostet Platz — am HafenCity-Bestand rund 1 MB als Netz gegen 16 KB als
 * Daten —, aber wer das Modell holt, will die Bäume in derselben Lage.
 *
 * Ikosaeder ohne Unterteilung, dieselben zwanzig Dreiecke wie in der
 * Raumansicht, damit ein Baum in der Datei und auf dem Schirm derselbe
 * Koerper ist. Der Kronenansatz kommt aus `BAUM.stammhoeheM`; ein Stamm wird
 * nicht gezeichnet, weil OpenStreetMap keinen Stammdurchmesser fuehrt, den
 * man zeichnen koennte, ohne ihn zu erfinden.
 */

/** Die zwoelf Ecken des Ikosaeders, Einheitsradius. */
const PHI = (1 + Math.sqrt(5)) / 2;
const ROH: [number, number, number][] = [
	[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
	[0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
	[PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
];
const L = Math.hypot(1, PHI);
const ECKEN = ROH.map(([x, y, z]) => [x / L, y / L, z / L] as [number, number, number]);

/** Die zwanzig Dreiecke, Ecken eins-basiert wie in OBJ. */
const FLAECHEN: [number, number, number][] = [
	[1, 12, 6], [1, 6, 2], [1, 2, 8], [1, 8, 11], [1, 11, 12],
	[2, 6, 10], [6, 12, 5], [12, 11, 3], [11, 8, 7], [8, 2, 9],
	[4, 10, 5], [4, 5, 3], [4, 3, 7], [4, 7, 9], [4, 9, 10],
	[5, 10, 6], [3, 5, 12], [7, 3, 11], [9, 7, 8], [10, 9, 2]
];

/**
 * Die Kronen als ein Körper `trees` für `model.obj`.
 *
 * Volker am 19.10.2026: Die Bäume gehören ins Modell, als ein einzelnes
 * Objekt, nicht in eine eigene Datei. Die Punkt- und Normalenzähler des
 * Modells kommen herein, damit die Verweise stimmen; zurück kommt, wie viele
 * dazugekommen sind.
 *
 * Jede Dreiecksfläche bekommt ihre Normale, aus der Mitte der Krone zur
 * Flächenmitte. Ohne sie mittelt Rhino und die Kronen werden Kugeln.
 */
export function kronenKoerper(
	baeume: { x: number; y: number; krone: number; gemessen: boolean }[],
	r: Rahmen,
	gelaende: Gelaende | null,
	material: boolean,
	punktBasis: number,
	normalBasis: number
): { zeilen: string[]; punkte: number; normalen: number; kronen: number } {
	const zeilen: string[] = [];
	let punkte = 0, normalen = 0, kronen = 0;
	for (const b of baeume) {
		if (b.x < r.x0 || b.x > r.x1 || b.y < r.y0 || b.y > r.y1) continue;
		if (!kronen++) {
			zeilen.push('o trees');
			if (material) zeilen.push('usemtl tree');
		}
		const nenn = Math.max(0.5, b.krone / 2);
		const rad = nenn * BAUM.silhouetteFaktor;
		const mx = b.x - r.x0;
		const my = b.y - r.y0;
		const mz = (gelaende ? hoeheBei(gelaende, b.x, b.y) : 0) + BAUM.stammhoeheM + nenn;
		// Ecken sind (x, y nach oben, z nach Süden) gerechnet: umstellen auf
		// Z nach oben, Y nach Norden wie das Modell.
		const ecken = ECKEN.map(([ex, ey, ez]) => [ex, -ez, ey] as [number, number, number]);
		for (const [ex, ey, ez] of ecken)
			zeilen.push(`v ${(mx + ex * rad).toFixed(3)} ${(my + ey * rad).toFixed(3)} ${(mz + ez * rad).toFixed(3)}`);
		for (const [a, b2, c] of FLAECHEN) {
			const [pa, pb, pc] = [ecken[a - 1], ecken[b2 - 1], ecken[c - 1]];
			const m = [0, 1, 2].map((k) => (pa[k] + pb[k] + pc[k]) / 3);
			const l = Math.hypot(m[0], m[1], m[2]);
			zeilen.push(`vn ${(m[0] / l).toFixed(5)} ${(m[1] / l).toFixed(5)} ${(m[2] / l).toFixed(5)}`);
			const nn = normalBasis + ++normalen;
			// Umlaufsinn passend zur Normale
			const u = [0, 1, 2].map((k) => pb[k] - pa[k]), v = [0, 1, 2].map((k) => pc[k] - pa[k]);
			const kreuz = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
			const dreh = kreuz[0] * m[0] + kreuz[1] * m[1] + kreuz[2] * m[2] < 0;
			const [x, y, z] = (dreh ? [a, c, b2] : [a, b2, c]).map((k) => punktBasis + punkte + k);
			zeilen.push(`f ${x}//${nn} ${y}//${nn} ${z}//${nn}`);
		}
		punkte += ECKEN.length;
	}
	if (kronen) zeilen.push('');
	return { zeilen, punkte, normalen, kronen };
}
