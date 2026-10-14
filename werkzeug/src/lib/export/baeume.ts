import { objName } from '../vertrag';
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
 * erzeugen kann. Ins Paket gehoert sie nicht: Gemessen am HafenCity-Bestand
 * sind es 16 KB gepackt als Daten gegen 261 KB als Netz, das 16,8-Fache, und
 * das Baumnetz allein waere 2,4-mal so gross wie das ganze Gebaeudemodell.
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

export function baeumeAlsObj(
	baeume: { x: number; y: number; krone: number; gemessen: boolean }[],
		r: Rahmen,
		gelaende: Gelaende | null = null
	): string {
	const zeilen: string[] = [
		'# Nolli — tree crowns',
		`# Icosahedra, ${FLAECHEN.length} triangles per crown`,
		`# Crown base ${BAUM.stammhoeheM} m, default diameter ${BAUM.vorgabeKroneM} m where not mapped`,
		'# X east, Y up, Z south. Origin at the lower-left frame corner.',
		...(gelaende ? ['# Y: metres above sea level, trees stand on the terrain'] : [])
	];
	let versatz = 0;
	let n = 0;
	for (const b of baeume) {
		if (b.x < r.x0 || b.x > r.x1 || b.y < r.y0 || b.y > r.y1) continue;
		const nenn = Math.max(0.5, b.krone / 2);
		const rad = nenn * BAUM.silhouetteFaktor;
		const mx = b.x - r.x0;
		const my = (gelaende ? hoeheBei(gelaende, b.x, b.y) : 0) + BAUM.stammhoeheM + nenn;
		const mz = -(b.y - r.y0);
		zeilen.push(`o ${objName(`baum_${++n}${b.gemessen ? '' : '_krone_vorgabe'}`)}`);
		for (const [ex, ey, ez] of ECKEN)
			zeilen.push(`v ${(mx + ex * rad).toFixed(3)} ${(my + ey * rad).toFixed(3)} ${(mz + ez * rad).toFixed(3)}`);
		for (const [a, b2, c] of FLAECHEN)
			zeilen.push(`f ${a + versatz} ${b2 + versatz} ${c + versatz}`);
		versatz += ECKEN.length;
	}
	return zeilen.join('\n') + '\n';
}
