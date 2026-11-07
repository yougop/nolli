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

/**
 * Was man an den Bäumen einstellen kann (Volker, 06.11.2026): Form der Krone,
 * Größe als Faktor auf das Nennmaß (ab Werk 1,2 wie `BAUM_BILD.groesser`,
 * von 0,9 bis 1,4), Höhe der Krone als Verhältnis von Höhe zu Breite (1 ist
 * rund, ab Werk `BAUM_BILD.hoch`), Variation als Vielfaches von
 * `BAUM_BILD.streuung`, Sättigung und Helligkeit der Kronenfarbe. Form und
 * Größe gelten für Ansicht, OBJ und 3DM, die Farbe für Ansicht und 3D-Bild.
 *
 * Nadelbäume (`Baum.nadel`) sind in jeder Form Kegel, schlanker und höher.
 * Eine dritte Form „natürlich“ aus drei Kugeln je Krone gab es am 06.11.2026
 * kurz; sie sah nicht gut aus (Volker) und ist wieder entfernt.
 */
export type Baumart = 'ikosaeder' | 'kugel';
/** Wie Bäume einer Herkunft aussehen. */
export type Baumwahl = {
	art: Baumart; groesse: number; hoehe: number; streuung: number;
	saettigung: number; helligkeit: number; farbStreuung: number;
};
/**
 * Drei Herkünfte (Volker, 07.11.2026: „die ganzen Bäume und Baumgebiete
 * zusammenbekommen“, „drei Zonen im 3D einstellen“): Bestand aus OSM samt
 * Baumreihen, Wald aus Waldflächen, Ergänzt von Hand. Jede hat ihr eigenes
 * Aussehen, in zwei Sätzen: einer für alle Pläne, einer für das 3D-Modell.
 */
export type Herkunft = 'bestand' | 'wald' | 'natur' | 'ergaenzt';
export const HERKUENFTE: Herkunft[] = ['bestand', 'wald', 'natur', 'ergaenzt'];
export type Baumsatz = Record<Herkunft, Baumwahl>;
export const herkunftVon = (b: Baum): Herkunft => (b.busch ? 'natur' : b.wald ? 'wald' : b.ergaenzt ? 'ergaenzt' : 'bestand');

/** 3D ab Werk wie von Volker am 06.11.2026 eingestellt: Kugel, 110 %, rund, ±30 %, Sättigung 55 %. */
const RAUM: Baumwahl = { art: 'kugel', groesse: 1.1, hoehe: 1, streuung: 1, saettigung: 0.55, helligkeit: 1, farbStreuung: 0.3 };
/** Pläne ab Werk wie bisher: Kreis im Kronendurchmesser, ohne Variation, Farbe der Darstellung. */
const PLAN: Baumwahl = { art: 'kugel', groesse: 1, hoehe: 1, streuung: 0, saettigung: 1, helligkeit: 1, farbStreuung: 0 };
export const SATZ_RAUM: Baumsatz = { bestand: { ...RAUM }, wald: { ...RAUM }, natur: { ...RAUM, streuung: 0, saettigung: 0.5, helligkeit: 1.1, farbStreuung: 0.4 }, ergaenzt: { ...RAUM } };
/** Der Wald in den Plänen etwas heller, damit erfundene Bäume nicht wie eingetragene wirken. */
export const SATZ_PLAN: Baumsatz = { bestand: { ...PLAN }, wald: { ...PLAN, helligkeit: 1.15 }, natur: { ...PLAN, helligkeit: 1.15 }, ergaenzt: { ...PLAN } };
export const satzKopie = (s: Baumsatz): Baumsatz => ({ bestand: { ...s.bestand }, wald: { ...s.wald }, natur: { ...s.natur }, ergaenzt: { ...s.ergaenzt } });
/** Einen gespeicherten Satz einlesen, Fehlendes aus der Vorgabe. */
export function satzAus(roh: Partial<Record<Herkunft, Partial<Baumwahl>>> | undefined, vorgabe: Baumsatz): Baumsatz {
	const s = satzKopie(vorgabe);
	for (const h of HERKUENFTE) {
		s[h] = { ...s[h], ...(roh?.[h] ?? {}) };
		if (s[h].art !== 'kugel') s[h].art = 'ikosaeder';
	}
	return s;
}
/**
 * Der gültige Satz des 3D-Modells. Die Seite setzt ihn, sobald sich etwas
 * ändert; so muss nicht jeder Ausgang (OBJ, 3DM) ihn durchreichen.
 */
let aktiv: Baumsatz = satzKopie(SATZ_RAUM);
export const baumSatzSetzen = (s: Baumsatz) => { aktiv = satzAus(s, SATZ_RAUM); };

/** Nadelbäume: so viel schmaler und so viel höher als ein Laubbaum gleicher Krone. */
const NADEL = { breit: 0.8, hoch: 1.6 };

/** Eine feste Zahl zwischen −1 und 1 je Ort; `n` gibt eine zweite, unabhängige. */
function zufall(x: number, y: number, n = 0) {
	const v = Math.sin(x * 12.9898 + y * 78.233 + n * 39.425) * 43758.5453;
	return (v - Math.floor(v)) * 2 - 1;
}

/**
 * Die Form eines Baums, vom Fuß aus gemessen: Kronenradius `rx` (waagerecht)
 * und `rz` (senkrecht), Kronenmitte `mitte` über dem Fuß, Stamm mit Radius
 * `stammR` bis `stammH`, Drehung `dreh` um die Hochachse im Bogenmaß,
 * `nadel` für Kegel. Der Kronenansatz wächst mit
 * dem Baum. Führt OSM eine Höhe, reicht die Krone bis dorthin, in
 * vernünftigen Grenzen; führt es den Stammumfang, gilt er, sonst ein Stamm
 * passend zur Krone.
 */
export function baumForm(b: Baum, satz: Baumsatz = aktiv) {
	const w = satz[herkunftVon(b)];
	const nenn = Math.max(0.5, b.krone / 2);
	const nadel = !!b.nadel;
	const s = b.gemessen ? 1 : Math.max(0.3, 1 + BAUM_BILD.streuung * w.streuung * zufall(b.x, b.y));
	const rx = nenn * BAUM.silhouetteFaktor * w.groesse * s * (nadel ? NADEL.breit : 1);
	const verh = w.hoehe * (nadel ? NADEL.hoch : 1);
	let rz = rx * verh, ansatz = BAUM.stammhoeheM * s;
	// Busch: flach und ohne sichtbaren Stamm, die Krone sitzt fast auf dem Boden.
	// Gehölz in Naturflächen: Kugel ohne Stamm, liegt dem Boden auf.
	if (b.busch) { rz = rx * w.hoehe; ansatz = 0; }
	if (b.hoehe !== undefined && b.hoehe > 2) {
		// Mit gemessener Höhe bleibt die Spitze, wo OSM sie hat; die Regler
		// verändern die Krone relativ zur bisherigen Form.
		rz = Math.max(rx * 0.8, Math.min(rx * 2, (b.hoehe - ansatz) / 2)) * (verh / BAUM_BILD.hoch);
		ansatz = Math.max(1, b.hoehe - 2 * rz);
	}
	/**
	 * Der gemessene Stamm nie dünner als der gezeichnete (Volker, 06.11.2026):
	 * Die Kronen sind zeichnerisch vergrößert, ein Stamm in echter Stärke
	 * (HafenCity: 0,7 bis 1,1 m Umfang, also 11 bis 17 cm Radius) stand
	 * darunter wie ein Strich. `data/trees.json` trägt weiter den Messwert.
	 */
	// Nadelbäume mindestens 12 % des Kronenradius: Unter dem schmalen Kegel wirkte der Stamm sonst verloren.
	const gezeichnet = Math.max(Math.min(0.6, Math.max(0.18, nenn * s * BAUM_BILD.stamm)), nadel ? rx * 0.12 : 0);
	const stammR = b.busch ? 0.05 : b.stamm !== undefined ? Math.max(gezeichnet, b.stamm / (2 * Math.PI)) : gezeichnet;
	return { rx, rz, mitte: ansatz + rz * (b.busch ? 0.8 : 1), stammR, stammH: b.busch ? 0 : ansatz + rz * 0.5, dreh: Math.PI * zufall(b.x, b.y, 1), nadel, art: b.busch ? 'kugel' as const : w.art };
}

/** Ein Netz mit Y nach oben, Flächen eins-basiert, nach außen gewunden. */
type Netz3 = { ecken: [number, number, number][]; flaechen: [number, number, number][] };

/** Kugel aus Ringen: `seg` um die Hochachse, `ringe` von Pol zu Pol. */
function kugelNetz(seg: number, ringe: number): Netz3 {
	const ecken: [number, number, number][] = [[0, 1, 0]];
	for (let j = 1; j < ringe; j++) {
		const t = (j / ringe) * Math.PI;
		for (let i = 0; i < seg; i++) {
			const w = (i / seg) * 2 * Math.PI;
			ecken.push([Math.sin(t) * Math.cos(w), Math.cos(t), Math.sin(t) * Math.sin(w)]);
		}
	}
	ecken.push([0, -1, 0]);
	const flaechen: [number, number, number][] = [];
	const ring = (j: number, i: number) => 2 + (j - 1) * seg + (i % seg);
	for (let i = 0; i < seg; i++) flaechen.push([1, ring(1, i + 1), ring(1, i)]);
	for (let j = 1; j < ringe - 1; j++)
		for (let i = 0; i < seg; i++) {
			flaechen.push([ring(j, i), ring(j, i + 1), ring(j + 1, i + 1)]);
			flaechen.push([ring(j, i), ring(j + 1, i + 1), ring(j + 1, i)]);
		}
	for (let i = 0; i < seg; i++) flaechen.push([ecken.length, ring(ringe - 1, i), ring(ringe - 1, i + 1)]);
	return { ecken, flaechen };
}

/** Ein Kegel mit Boden: Grundkreis `rb` auf Höhe `yb`, Spitze auf `yt`. */
function kegelNetz(seg: number, yb: number, yt: number, rb: number): Netz3 {
	const ecken: [number, number, number][] = [[0, yt, 0]];
	for (let i = 0; i < seg; i++) { const w = (i / seg) * 2 * Math.PI; ecken.push([rb * Math.cos(w), yb, rb * Math.sin(w)]); }
	ecken.push([0, yb, 0]);
	const flaechen: [number, number, number][] = [];
	const k = (i: number) => 2 + (i % seg);
	for (let i = 0; i < seg; i++) { flaechen.push([1, k(i + 1), k(i)]); flaechen.push([ecken.length, k(i), k(i + 1)]); }
	return { ecken, flaechen };
}

/**
 * Die Kugel als zweite Kronenform: 12 Segmente um die Hochachse, 7 Ringe,
 * also 144 Dreiecke statt zwanzig.
 */
const KUGEL = kugelNetz(12, 7);
/** Nadelbäume: ein Kegel, kantig mit 6, rund mit 12 Seiten. */
const NADEL_KANTIG = kegelNetz(6, -1, 1, 1);
const NADEL_RUND = kegelNetz(12, -1, 1, 1);
/** Ecken und Flächen der Krone für Form und Laub oder Nadel. Einheitsmaß, Y nach oben. */
export function kronenForm(art: Baumart = 'kugel', nadel = false): Netz3 {
	if (nadel) return art === 'kugel' ? NADEL_RUND : NADEL_KANTIG;
	return art === 'kugel' ? KUGEL : { ecken: ECKEN, flaechen: FLAECHEN };
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
	/**
	 * Zwei Körperpaare: die Bäume aus den Daten (`trees`, `trunks`) und die
	 * von Hand gepflanzten (`trees_added`, `trunks_added`, 07.11.2026), damit
	 * man sie im Zielprogramm getrennt ein- und ausblenden kann.
	 */
	for (const [name, liste] of [['', formen.filter((f) => !f.b.ergaenzt)], ['_added', formen.filter((f) => f.b.ergaenzt)]] as const) {
		if (!liste.length) continue;
		zeilen.push(`o trees${name}`);
		if (material) zeilen.push('usemtl tree');
		for (const { b, f, fuss } of liste) {
			kronen++;
			const m: [number, number, number] = [b.x - r.x0, b.y - r.y0, fuss + f.mitte];
			// Ecken sind (x, y nach oben, z nach Süden) gerechnet: umstellen auf
			// Z nach oben, Y nach Norden wie das Modell.
			const c = Math.cos(f.dreh), d = Math.sin(f.dreh);
			const kf = kronenForm(f.art, f.nadel);
			koerper(kf.ecken.map(([ex, ey, ez]) => [m[0] + (ex * c + ez * d) * f.rx, m[1] + (ex * d - ez * c) * f.rx, m[2] + ey * f.rz]), kf.flaechen, m);
		}
		zeilen.push('', `o trunks${name}`);
		if (material) zeilen.push('usemtl trunk');
		for (const { b, f, fuss } of liste) {
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
