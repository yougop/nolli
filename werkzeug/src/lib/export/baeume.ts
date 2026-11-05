import { type Gelaende, hoeheBei } from '../geo/gelaende';
import type { Rahmen } from '$lib/geo/rahmen';
import { BAUM, type Baum } from '$lib/analysedaten';

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
 * Koerper ist. Die Form steht in `baumForm`, an einer Stelle fuer alle drei.
 */

/** Die zwoelf Ecken des Ikosaeders, Einheitsradius. */
const PHI = (1 + Math.sqrt(5)) / 2;
const ROH: [number, number, number][] = [
	[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
	[0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
	[PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
];
const L = Math.hypot(1, PHI);
export const ECKEN = ROH.map(([x, y, z]) => [x / L, y / L, z / L] as [number, number, number]);

/** Die zwanzig Dreiecke, Ecken eins-basiert wie in OBJ. */
export const FLAECHEN: [number, number, number][] = [
	[1, 12, 6], [1, 6, 2], [1, 2, 8], [1, 8, 11], [1, 11, 12],
	[2, 6, 10], [6, 12, 5], [12, 11, 3], [11, 8, 7], [8, 2, 9],
	[4, 10, 5], [4, 5, 3], [4, 3, 7], [4, 7, 9], [4, 9, 10],
	[5, 10, 6], [3, 5, 12], [7, 3, 11], [9, 7, 8], [10, 9, 2]
];

/**
 * Wie die Bäume gezeichnet werden, über das Nennmaß hinaus (Volker,
 * 05.11.2026: etwas größer, etwas hochkant, nicht alle gleich, mit Stamm;
 * danach noch einen Tick mehr, je Baum gedreht, Stamm dicker).
 *
 * - `groesser`: alle Kronen um diesen Faktor breiter als das Nennmaß.
 * - `hoch`: die Krone so viel höher als breit.
 * - `streuung`: Bäume ohne gemessene Krone (alle mit `vorgabeKroneM`) werden
 *   um bis zu diesen Anteil größer oder kleiner, je Ort fest, damit dasselbe
 *   Paket immer dieselben Bäume zeigt. Gemessene Kronen bleiben, wie sie sind.
 * - `stamm`: Stammradius als Anteil des Kronenradius, wo OSM keinen Umfang führt.
 * - Jeder Baum ist um die Hochachse gedreht, je Ort fest, damit die Kronen
 *   nicht alle dieselbe Kante zeigen.
 *
 * Das betrifft nur die Körper in Ansicht, OBJ und 3DM. `data/trees.json`
 * trägt weiter das Nennmaß; wer selbst Bäume baut, wie Umbra, rechnet damit.
 */
export const BAUM_BILD = { groesser: 1.2, hoch: 1.45, streuung: 0.3, stamm: 0.09 };

/** Eine feste Zahl zwischen −1 und 1 je Ort; `n` gibt eine zweite, unabhängige. */
function zufall(x: number, y: number, n = 0) {
	const v = Math.sin(x * 12.9898 + y * 78.233 + n * 39.425) * 43758.5453;
	return (v - Math.floor(v)) * 2 - 1;
}

/**
 * Die Form eines Baums, vom Fuß aus gemessen: Kronenradius `rx` (waagerecht)
 * und `rz` (senkrecht), Kronenmitte `mitte` über dem Fuß, Stamm mit Radius
 * `stammR` bis `stammH`, Drehung `dreh` um die Hochachse im Bogenmaß. Der Kronenansatz wächst mit dem Baum. Führt OSM eine
 * Höhe, reicht die Krone bis dorthin, in vernünftigen Grenzen; führt es den
 * Stammumfang, gilt er, sonst ein Stamm passend zur Krone.
 */
export function baumForm(b: Baum) {
	const nenn = Math.max(0.5, b.krone / 2);
	const s = b.gemessen ? 1 : 1 + BAUM_BILD.streuung * zufall(b.x, b.y);
	const rx = nenn * BAUM.silhouetteFaktor * BAUM_BILD.groesser * s;
	let rz = rx * BAUM_BILD.hoch, ansatz = BAUM.stammhoeheM * s;
	if (b.hoehe !== undefined && b.hoehe > 2) {
		rz = Math.max(rx * 0.8, Math.min(rx * 2, (b.hoehe - ansatz) / 2));
		ansatz = Math.max(1, b.hoehe - 2 * rz);
	}
	const stammR = b.stamm !== undefined ? b.stamm / (2 * Math.PI) : Math.min(0.6, Math.max(0.18, nenn * s * BAUM_BILD.stamm));
	return { rx, rz, mitte: ansatz + rz, stammR, stammH: ansatz + rz * 0.5, dreh: Math.PI * zufall(b.x, b.y, 1) };
}

/** Der Stamm als sechseckiges Prisma mit Deckeln, Einheitsradius und -höhe, Z nach oben. */
const SEITEN = 6;
export const STAMM_ECKEN: [number, number, number][] = [];
for (let i = 0; i < SEITEN; i++) {
	const w = (i / SEITEN) * 2 * Math.PI;
	STAMM_ECKEN.push([Math.cos(w), Math.sin(w), 0], [Math.cos(w), Math.sin(w), 1]);
}
/** Dreiecke nach außen, Ecken eins-basiert wie in OBJ. */
export const STAMM_FLAECHEN: [number, number, number][] = [];
for (let i = 0; i < SEITEN; i++) {
	const a = 2 * i + 1, b = a + 1, c = ((2 * i + 2) % (2 * SEITEN)) + 1, d = c + 1;
	STAMM_FLAECHEN.push([a, c, d], [a, d, b]);
}
for (let i = 1; i + 1 < SEITEN; i++) {
	STAMM_FLAECHEN.push([1, 2 * (i + 1) + 1, 2 * i + 1]);       // unten
	STAMM_FLAECHEN.push([2, 2 * i + 2, 2 * (i + 1) + 2]);       // oben
}

/**
 * Die Kronen als ein Körper `trees` für `model.obj`, die Stämme als
 * `trunks`.
 *
 * Volker am 19.10.2026: Die Bäume gehören ins Modell, als ein einzelnes
 * Objekt, nicht in eine eigene Datei. Die Punkt- und Normalenzähler des
 * Modells kommen herein, damit die Verweise stimmen; zurück kommt, wie viele
 * dazugekommen sind.
 *
 * Jede Dreiecksfläche bekommt ihre Normale, aus der Mitte des Körpers zur
 * Flächenmitte. Ohne sie mittelt Rhino und die Kronen werden Kugeln.
 */
export function kronenKoerper(
	baeume: Baum[],
	r: Rahmen,
	gelaende: Gelaende | null,
	material: boolean,
	punktBasis: number,
	normalBasis: number
): { zeilen: string[]; punkte: number; normalen: number; kronen: number } {
	const zeilen: string[] = [];
	let punkte = 0, normalen = 0, kronen = 0;
	const drin = baeume.filter((b) => b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1);
	const formen = drin.map((b) => ({ b, f: baumForm(b), fuss: gelaende ? hoeheBei(gelaende, b.x, b.y) : 0 }));
	/** Ein Körper aus Ecken (schon in Modellkoordinaten) und Flächen, Normalen von `innen` aus. */
	const koerper = (ecken: [number, number, number][], flaechen: [number, number, number][], innen: [number, number, number]) => {
		for (const [x, y, z] of ecken) zeilen.push(`v ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`);
		for (const [a, b2, c] of flaechen) {
			const [pa, pb, pc] = [ecken[a - 1], ecken[b2 - 1], ecken[c - 1]];
			const m = [0, 1, 2].map((k) => (pa[k] + pb[k] + pc[k]) / 3 - innen[k]);
			const l = Math.hypot(m[0], m[1], m[2]) || 1;
			zeilen.push(`vn ${(m[0] / l).toFixed(5)} ${(m[1] / l).toFixed(5)} ${(m[2] / l).toFixed(5)}`);
			const nn = normalBasis + ++normalen;
			// Umlaufsinn passend zur Normale
			const u = [0, 1, 2].map((k) => pb[k] - pa[k]), v = [0, 1, 2].map((k) => pc[k] - pa[k]);
			const kreuz = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
			const dreh = kreuz[0] * m[0] + kreuz[1] * m[1] + kreuz[2] * m[2] < 0;
			const [x, y, z] = (dreh ? [a, c, b2] : [a, b2, c]).map((k) => punktBasis + punkte + k);
			zeilen.push(`f ${x}//${nn} ${y}//${nn} ${z}//${nn}`);
		}
		punkte += ecken.length;
	};
	if (formen.length) {
		zeilen.push('o trees');
		if (material) zeilen.push('usemtl tree');
		for (const { b, f, fuss } of formen) {
			kronen++;
			const m: [number, number, number] = [b.x - r.x0, b.y - r.y0, fuss + f.mitte];
			// Ecken sind (x, y nach oben, z nach Süden) gerechnet: umstellen auf
			// Z nach oben, Y nach Norden wie das Modell.
			const c = Math.cos(f.dreh), d = Math.sin(f.dreh);
			koerper(ECKEN.map(([ex, ey, ez]) => [m[0] + (ex * c + ez * d) * f.rx, m[1] + (ex * d - ez * c) * f.rx, m[2] + ey * f.rz]), FLAECHEN, m);
		}
		zeilen.push('', 'o trunks');
		if (material) zeilen.push('usemtl trunk');
		for (const { b, f, fuss } of formen) {
			const mx = b.x - r.x0, my = b.y - r.y0;
			// Der Fuß einen halben Meter im Grund, damit er am Hang nicht in der Luft steht.
			const z0 = fuss - 0.5, h = f.stammH + 0.5;
			const c = Math.cos(f.dreh), d = Math.sin(f.dreh);
			koerper(STAMM_ECKEN.map(([ex, ey, ez]) => [mx + (ex * c - ey * d) * f.stammR, my + (ex * d + ey * c) * f.stammR, z0 + ez * h]), STAMM_FLAECHEN, [mx, my, z0 + h / 2]);
		}
		zeilen.push('');
	}
	return { zeilen, punkte, normalen, kronen };
}
