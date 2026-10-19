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
 * erzeugen kann. Seit dem 19.10.2026 kein eigener Ausgang mehr, sondern
 * `trees.obj` im Modellpaket neben `model.obj`, mit demselben Material. Das
 * kostet Platz — am HafenCity-Bestand 261 KB als Netz gegen 16 KB als
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

export function baeumeAlsObj(
	baeume: { x: number; y: number; krone: number; gemessen: boolean }[],
		r: Rahmen,
		gelaende: Gelaende | null = null,
		material: string | null = null
	): string {
	const zeilen: string[] = [
		'# Nolli — tree crowns',
		`# Icosahedra, ${FLAECHEN.length} triangles per crown`,
		`# Crown base ${BAUM.stammhoeheM} m, default diameter ${BAUM.vorgabeKroneM} m where not mapped`,
		// Z nach oben wie model.obj, damit beide im selben Paket aufeinander
		// passen. Bis zum 19.10.2026 stand hier Y nach oben, für Blender;
		// in Rhino lagen die Kronen dann quer zum Modell.
		'# Units metres, Z up, Y north. Origin at the lower-left frame corner.',
		...(gelaende ? ['# Z: metres above sea level, trees stand on the terrain'] : []),
		...(material ? [`mtllib ${material}`] : [])
	];
	let versatz = 0;
	let n = 0;
	for (const b of baeume) {
		if (b.x < r.x0 || b.x > r.x1 || b.y < r.y0 || b.y > r.y1) continue;
		const nenn = Math.max(0.5, b.krone / 2);
		const rad = nenn * BAUM.silhouetteFaktor;
		const mx = b.x - r.x0;
		const my = b.y - r.y0;
		const mz = (gelaende ? hoeheBei(gelaende, b.x, b.y) : 0) + BAUM.stammhoeheM + nenn;
		zeilen.push(`o ${objName(`baum_${++n}${b.gemessen ? '' : '_krone_vorgabe'}`)}`);
		if (material) zeilen.push('usemtl tree');
		for (const [ex, ey, ez] of ECKEN)
			// Ecken sind (x, y nach oben, z nach Süden) gerechnet: umstellen.
			zeilen.push(`v ${(mx + ex * rad).toFixed(3)} ${(my - ez * rad).toFixed(3)} ${(mz + ey * rad).toFixed(3)}`);
		for (const [a, b2, c] of FLAECHEN)
			zeilen.push(`f ${a + versatz} ${b2 + versatz} ${c + versatz}`);
		versatz += ECKEN.length;
	}
	return zeilen.join('\n') + '\n';
}
