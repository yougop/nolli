import earcut from 'earcut';
import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import { zipSync, strToU8 } from 'fflate';
import { unterkante, umrisseMitTeilen, type Objekt } from '../osm';
import { hatDach, dachKoerper, rechteck } from '../dach';
import { amRahmen, drin, gegenUhr, mitUhr } from '../schneiden';
import { type Gelaende, tiefsteUnter, feldImRahmen, netzHoehe, type Feld } from '../geo/gelaende';
import type { Rahmen } from '../geo/rahmen';

/**
 * Ein Modell für den 3D-Druck (Volker, 05.11.2026).
 *
 * Anders als `model.obj` muss jeder Körper geschlossen sein, sonst weiß der
 * Slicer nicht, was innen ist. Deshalb:
 *
 * - **Grundplatte** als eigener Körper: unten eben auf null, oben das
 *   Gelände (überhöht, wenn gewünscht) oder eben, dazwischen die Seiten.
 *   Oben und unten dasselbe Raster, damit jede Kante genau zwei Dreiecke hat.
 * - **Häuser** mit Boden, einen halben Millimeter in die Platte versenkt,
 *   damit sie beim Druck mit ihr verschmelzen. Die Höhe der Häuser wird nicht
 *   überhöht, nur das Gelände, auf dem sie stehen.
 * - **Schwebende Teile** (London Eye, Brücken, Auskragungen) brauchten
 *   Stützen. Ab Werk werden sie bis zum Boden durchgezogen, wahlweise
 *   weggelassen.
 * - **Kacheln:** Ist der Rahmen im gewählten Maßstab größer als das
 *   Druckbett, wird er in gleich große Kacheln geteilt, je Kachel ein Satz
 *   Körper. Häuser über einer Kachelgrenze werden dort geschnitten.
 *
 * Einheit ist der Millimeter. Ursprung ist die linke untere Ecke der Kachel.
 */
export type Druckwahl = {
	/** `massstab`: fester Maßstab, `bett`: längere Seite genau `bettMm`. */
	groesse: 'massstab' | 'bett';
	massstab: number;
	bettMm: number;
	sockelMm: number;
	ueberhoehung: number;
	schwebend: 'durchziehen' | 'weglassen';
	/** `ein`: ein Objekt; `mehr`: Platte, Häuser und Straßen getrennt, für mehrere Farben. */
	farben: 'ein' | 'mehr';
	/** Straßen als flache Streifen über der Platte, damit man sie auch einfarbig erkennt. */
	strassen: boolean;
	/** Grünflächen als eigener Körper in der Platte, 0,2 mm erhaben. */
	gruen: boolean;
	/** Wasserflächen `WASSER_MM` in die Platte gesenkt, mit senkrechtem Ufer. */
	wasser: boolean;
	/**
	 * Was gedruckt wird, als Bruchteil des Rahmens (0 bis 1, y von Süden).
	 * Ab Werk alles; ein Teil, wenn der ganze Rahmen nicht druckbar ist.
	 */
	ausschnitt: { x0: number; y0: number; x1: number; y1: number };
	/** Was mit zu kleinen Teilen geschieht (`zuKlein`): drin lassen oder weglassen. */
	klein: 'behalten' | 'weglassen';
};
export const DRUCK_VORGABE: Druckwahl = {
	groesse: 'bett', massstab: 1000, bettMm: 200, sockelMm: 3, ueberhoehung: 1, schwebend: 'durchziehen',
	farben: 'mehr', strassen: true, gruen: true, wasser: true, ausschnitt: { x0: 0, y0: 0, x1: 1, y1: 1 }, klein: 'behalten'
};

/**
 * Zu kleine Teile (Volker, 05.11.2026: Antennen, Anschnitte). Geprüft wird
 * jedes Stück, wie es gedruckt wird, also nach dem Schnitt an der Kachel:
 *
 * - **Anschnitt**: ein Haus, das die Kachelkante schneidet und dort einen
 *   Rest schmaler als 0,8 mm lässt.
 * - **Antenne**: schmaler als 1,5 mm und mehr als achtmal so hoch wie breit,
 *   also Masten, Schornsteine, schlanke Türme. Bricht beim Druck oder beim
 *   Abnehmen vom Bett.
 * - **Schmal**: sonst schmaler als 0,8 mm, das legt eine 0,4-mm-Düse nicht.
 *
 * Breite ist die kurze Seite des kleinsten umschreibenden Rechtecks.
 */
type Klein = 'anschnitt' | 'antenne' | 'schmal';
function zuKlein(teile: [number, number][][], ganz: boolean, hoeheM: number, k: number): Klein | null {
	let b = Infinity;
	for (const t of teile) b = Math.min(b, 2 * rechteck(t).hv * k);
	if (!Number.isFinite(b)) return null;
	if (b < 1.5 && (hoeheM * k) / Math.max(b, 1e-6) > 8) return 'antenne';
	if (b < MINDEST_MM) return ganz ? 'schmal' : 'anschnitt';
	return null;
}
const GRUEN_MM = 0.2;

/** Der Ausschnitt im Ortsgitter. */
function druckBereich(r: Rahmen, w: Druckwahl) {
	const a = w.ausschnitt ?? DRUCK_VORGABE.ausschnitt, B = r.x1 - r.x0, H = r.y1 - r.y0;
	return { x0: r.x0 + a.x0 * B, y0: r.y0 + a.y0 * H, x1: r.x0 + a.x1 * B, y1: r.y0 + a.y1 * H };
}
/** Wie hoch die Straßen über der Platte stehen, und wie schmal sie höchstens werden. */
const STRASSE_MM = 0.4, STRASSE_MIN_MM = 0.6, STRASSE_WEG_MM = 0.4;
/**
 * So tief liegt Wasser unter dem Land, höchstens bis 0,8 mm über dem Boden
 * der Platte (Volker, 05.11.2026: In der HafenCity fehlte das Wasser, Elbe
 * und Fleete lagen auf Höhe der Kais).
 */
const WASSER_MM = 0.8;
/**
 * Mehrfarbig füllt ein eigener Körper die Senke, für blaues Filament, so weit
 * unter dem Land, dass das Ufer als Kante stehen bleibt (Volker, 05.11.2026:
 * „Das Wasser muss natürlich in Blau gedruckt werden").
 */
const WASSER_UNTER_LAND_MM = 0.3;
/** Was ein Drucker mit 0,4-mm-Düse noch sauber legt. */
const MINDEST_MM = 0.8;
const VERSENKT_MM = 0.5;

type Netz = number[];   // x y z je Ecke, drei Ecken je Dreieck, außen gegen den Uhrzeigersinn

/**
 * Ende eines Körpers: ein „Dreieck“ aus NaN. Wer schreibt, legt gleiche
 * Ecken nur innerhalb eines Körpers zusammen. Über Körper hinweg teilten sich
 * Reihenhäuser und angrenzende Grünflächen sonst Kanten mit vier Dreiecken,
 * und Bambu Studio meldete „non-manifold edges“ (Volker, 05.11.2026). Wer
 * zeichnet oder zählt, überspringt die Marke (`istSchnitt`).
 */
const SCHNITT = [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
const istSchnitt = (q: Netz, i: number) => Number.isNaN(q[i]);
const schnitt = (q: Netz) => { q.push(...SCHNITT); };
/** Die Marken entfernen, für die Vorschau. */
export const ohneSchnitte = (q: Netz) => { const a: number[] = []; for (let i = 0; i < q.length; i += 9) if (!istSchnitt(q, i)) for (let j = 0; j < 9; j++) a.push(q[i + j]); return a; };

/**
 * Ein Ring ohne doppelte Punkte. OSM schließt Ringe mit dem ersten Punkt,
 * und manche Wege tragen denselben Punkt zweimal hintereinander. Daraus
 * würden Wände der Länge null, und der Körper wäre für den Slicer offen.
 */
function sauber(ring: [number, number][]): [number, number][] {
	const aus: [number, number][] = [];
	for (const p of ring) {
		const q = aus[aus.length - 1];
		if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3) aus.push(p);
	}
	while (aus.length > 1 && Math.hypot(aus[0][0] - aus[aus.length - 1][0], aus[0][1] - aus[aus.length - 1][1]) <= 1e-3) aus.pop();
	return aus;
}

/** Die Stücke eines Körpers in einer Kachel, einen Hauch innerhalb ihrer Kante geschnitten. */
function stuecke(o: Objekt, x0: number, y0: number, x1: number, y1: number, k: number) {
	// Einen Hauch innerhalb der Kachel schneiden: Sonst fällt die Wand eines
	// angeschnittenen Hauses mit der Seite der Platte zusammen und flimmert.
	const d = 0.05 / k, c = [x0 + d, y0 + d, x1 - d, y1 - d] as const;
	const zer = o.ringe.map((x) => amRahmen(x, ...c));
	const teile = zer.map((z) => sauber(z.innen)).filter((x) => x.length >= 3);
	const ganz = o.ringe.length === 1 && teile.length === 1 && zer[0].aussen.length === 0;
	return { teile, ganz, c };
}

/** Die Größe allein, ohne Zählung: Millimeter je Meter, Maße, Kacheln. Billig, läuft beim Ziehen des Rechtecks. */
export function druckGroesse(r: Rahmen, w: Druckwahl) {
	const g = druckBereich(r, w);
	const B = g.x1 - g.x0, H = g.y1 - g.y0;
	const k = w.groesse === 'bett' ? w.bettMm / Math.max(B, H) : 1000 / w.massstab;
	const breiteMm = B * k, hoeheMm = H * k;
	const nx = w.groesse === 'bett' ? 1 : Math.max(1, Math.ceil(breiteMm / w.bettMm - 1e-6));
	const ny = w.groesse === 'bett' ? 1 : Math.max(1, Math.ceil(hoeheMm / w.bettMm - 1e-6));
	return { g, k, breiteMm, hoeheMm, nx, ny, kb: B / nx, kh: H / ny, massstab: Math.round(1000 / k) };
}

/** Maße samt Zählung der zu kleinen Teile je Kachel, so wie sie gedruckt würden. */
export function druckMasse(objekte: Objekt[], r: Rahmen, w: Druckwahl) {
	const m = druckGroesse(r, w);
	const { g, k, nx, ny, kb, kh } = m;
	const zahl: Record<Klein, number> = { anschnitt: 0, antenne: 0, schmal: 0 };
	let gesamt = 0;
	const ersetzt = umrisseMitTeilen(objekte);
	for (const o of objekte) {
		if ((o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') || o.zustand === 'gestrichen' || !o.ringe.length || ersetzt.has(o.id)) continue;
		if (unterkante(o) > 0 && w.schwebend === 'weglassen') continue;
		// Hülle über alle Außenringe, nicht nur den ersten: ein Anbau als zweiter
		// Ring läge sonst in einer Kachel, die die Zählung nie ansieht.
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const ring of o.ringe) for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
		if (x1 < g.x0 || x0 > g.x1 || y1 < g.y0 || y0 > g.y1) continue;
		for (let j = 0; j < ny; j++)
			for (let i = 0; i < nx; i++) {
				const tx0 = g.x0 + i * kb, ty0 = g.y0 + j * kh, tx1 = tx0 + kb, ty1 = ty0 + kh;
				if (x1 < tx0 || x0 > tx1 || y1 < ty0 || y0 > ty1) continue;
				const st = stuecke(o, tx0, ty0, tx1, ty1, k);
				if (!st.teile.length) continue;
				gesamt++;
				const art = zuKlein(st.teile, st.ganz, o.hoeheM ?? 8, k);
				if (art) zahl[art]++;
			}
	}
	return { ...m, gesamt, klein: zahl.anschnitt + zahl.antenne + zahl.schmal, kleinArt: zahl };
}

/** Das Rechteck auf eine Größe in Millimetern setzen, um seine Mitte; nur im Maßstab sinnvoll. */
export function ausschnittGroesse(r: Rahmen, w: Druckwahl, bMm: number, hMm: number): Druckwahl['ausschnitt'] {
	const k = 1000 / w.massstab, a = w.ausschnitt;
	const wb = Math.min(1, Math.max(0.02, bMm / k / (r.x1 - r.x0))), wh = Math.min(1, Math.max(0.02, hMm / k / (r.y1 - r.y0)));
	const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
	const x0 = Math.min(1 - wb, Math.max(0, cx - wb / 2)), y0 = Math.min(1 - wh, Math.max(0, cy - wh / 2));
	return { x0, y0, x1: x0 + wb, y1: y0 + wh };
}

/**
 * Der Vorschlag beim ersten Öffnen (Impeccable, 05.11.2026): Vorher stand ab
 * Werk der ganze Rahmen aufs Bett, und das Erste, was das Fenster sagte, war
 * „93 Bauten schmaler als 0,8 mm“. Jetzt ein bettgroßer Ausschnitt in der
 * Rahmenmitte, im gröbsten Maßstab, bei dem weniger als 5 % der Bauten zu
 * schmal für die Düse sind — also so viel Stadt, wie sauber druckbar ist.
 */
export function druckVorschlag(objekte: Objekt[], r: Rahmen, w: Druckwahl): Druckwahl {
	for (const m of [5000, 2000, 1000, 500]) {
		const k = 1000 / m, B = r.x1 - r.x0, H = r.y1 - r.y0;
		const wb = Math.min(1, w.bettMm / k / B), wh = Math.min(1, w.bettMm / k / H);
		const probe: Druckwahl = { ...w, groesse: 'massstab', massstab: m, ausschnitt: { x0: (1 - wb) / 2, y0: (1 - wh) / 2, x1: (1 + wb) / 2, y1: (1 + wh) / 2 } };
		const z = druckMasse(objekte, r, probe);
		// Antennen zählen hier nicht: Sie sind eine Warnung („bricht ab“), kein
		// Hindernis, und an der HafenCity drückten vier davon den Vorschlag auf
		// 1:500, ein 100-m-Stück Stadt. Entscheidend ist, was die Düse nicht legt.
		const zuEng = z.kleinArt.anschnitt + z.kleinArt.schmal;
		if (!z.gesamt || zuEng / z.gesamt < 0.05 || m === 500) return probe;
	}
	return w;
}

/** Die Körper je Kachel, in Millimetern. */
export function druckModell(objekte: Objekt[], r: Rahmen, gelaende: Gelaende | null, w: Druckwahl) {
	const m = druckGroesse(r, w);
	const feld = gelaende ? feldImRahmen(gelaende, r) : null;
	const g0 = m.g;
	/**
	 * Bezug ist der tiefste Punkt im Ausschnitt, nicht im ganzen Rahmen.
	 * Sonst stand ein kleiner Ausschnitt über einem tiefen Flussufer auf einer
	 * Platte von mehreren Zentimetern (Volker, 1:500, 05.11.2026). Gemeinsam
	 * für alle Kacheln, damit sie aneinanderpassen.
	 */
	let zRef = 0;
	if (feld) {
		zRef = Infinity;
		const n = Math.max(2, Math.ceil(Math.max(g0.x1 - g0.x0, g0.y1 - g0.y0) / feld.dx) + 1);
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++)
				zRef = Math.min(zRef, netzHoehe(feld, g0.x0 - r.x0 + ((g0.x1 - g0.x0) * i) / (n - 1), g0.y0 - r.y0 + ((g0.y1 - g0.y0) * j) / (n - 1)));
	}
	const ue = feld ? w.ueberhoehung : 1;
	/** Geländehöhe in mm über der Plattenunterseite. */
	const plattenZ = (zGelaende: number) => w.sockelMm + (zGelaende - zRef) * m.k * ue;
	const ersetzt = umrisseMitTeilen(objekte);
	const { g, kb, kh } = m;
	/** `kleine`: zu kleine Teile, die behalten werden; gehören beim Schreiben zu den Häusern. */
	const kacheln: { name: string; i: number; j: number; bMm: number; hMm: number; platte: Netz; wasser: Netz; see: Netz; haeuser: Netz; kleine: Netz; strassen: Netz; gruen: Netz }[] = [];

	for (let j = 0; j < m.ny; j++)
		for (let i = 0; i < m.nx; i++) {
			const x0 = g.x0 + i * kb, y0 = g.y0 + j * kh, x1 = x0 + kb, y1 = y0 + kh;
			const mm = (x: number, y: number): [number, number] => [(x - x0) * m.k, (y - y0) * m.k];
			const rs = plattenRaster(feld, r, x0, y0, x1, y1, plattenZ);
			const see = w.wasser ? seeIn(objekte, x0, y0, x1, y1) : null;
			const tief = see ? Math.min(WASSER_MM, Math.max(0, w.sockelMm - 0.8)) : 0;
			const flaeche = rs.hoehe;
			const { netz: platte, wasser } = grundplatte(rs, m.k, see && tief > 0 ? see : null, tief, x0, y0, x1, y1);
			const haeuser: Netz = [], kleine: Netz = [];
			for (const roh of objekte) {
				if (roh.ebene !== 'gebaeude' && roh.ebene !== 'erhalt') continue;
				if (roh.zustand === 'gestrichen' || !roh.ringe.length || ersetzt.has(roh.id)) continue;
				const schwebt = unterkante(roh) > 0;
				if (schwebt && w.schwebend === 'weglassen') continue;
				const o: Objekt = schwebt ? { ...roh, unterM: undefined } : roh;
				const { teile, ganz, c } = stuecke(o, x0, y0, x1, y1, m.k);
				if (!teile.length) continue;
				const [cx0, cy0, cx1, cy1] = c;
				// Zu kleine Teile: weglassen, oder behalten und in der Vorschau rot.
				const klein = zuKlein(teile, ganz, o.hoeheM ?? 8, m.k);
				if (klein && w.klein === 'weglassen') continue;
				const ziel = klein ? kleine : haeuser;
				const boden = gelaende ? tiefsteUnter(gelaende, o.ringe) : 0;
				// Fuß in mm, versenkt; darüber zählen die Meter des Hauses unverzerrt.
				const fussMm = plattenZ(boden) - VERSENKT_MM;
				/**
				 * Die Unterseite folgt der Platte, einen halben Millimeter darin;
				 * alles darüber steht auf dem tiefsten Punkt unter dem Grundriss wie
				 * im Modell. Vorher reichte ein Haus am Hang auf der Bergseite tief
				 * in die Platte und schaute an ihrer Seite heraus (Volker, 05.11.2026).
				 */
				// Steht ein Haus auch nur mit einer Ecke im Wasser, reicht sein Fuß bis
				// auf den Wassergrund, damit dort nichts über der Senke schwebt.
				const nass = !!see && tief > 0 && teile.some((t) => t.some(([x, y]) => see.nass(x, y)));
				const hinein = (q: number[]) => {
					for (let a = 0; a < q.length; a += 3) {
						const [x, y] = mm(q[a], q[a + 1]);
						// Fuß und Boden liegen genau auf null, alles darüber ist Wand oder Dach.
						const unten = q[a + 2] <= 0;
						const f = flaeche(q[a], q[a + 1]) - (nass && unten ? tief : 0);
						// Oben mindestens knapp über der Platte, auch an einem steilen Hang.
						ziel.push(x, y, unten ? f - VERSENKT_MM : Math.max(f + 0.2, fussMm + q[a + 2] * m.k));
					}
				};
				const hMm = Math.max(VERSENKT_MM + 0.4, (o.hoeheM ?? 8) * m.k + VERSENKT_MM);
				if (hatDach(o)) {
					hinein(dachKoerper({ ...o, hoeheM: hMm / m.k }, teile, 0, 0, ganz, 20, true).dreiecke);
				} else {
					const loecher = (o.loecher ?? []).map((x) => sauber(amRahmen(x, cx0, cy0, cx1, cy1).innen)).filter((x) => x.length >= 3);
					hinein(quader(teile, loecher, hMm / m.k));
				}
				schnitt(ziel);
			}
			const strassen: Netz = w.strassen ? strassenStreifen(objekte, x0, y0, x1, y1, m.k, rs) : [];
			/**
			 * Das Wasser als Körper: von 0,6 mm unter dem Wassergrund bis knapp
			 * unters Land, wie das Grün einen Hauch innerhalb der Kachel, damit
			 * seine Wand nicht mit der Seite der Platte zusammenfällt.
			 */
			const seeKoerper: Netz = [];
			if (see && tief > 0 && w.farben === 'mehr') {
				const d = 0.05 / m.k;
				const innen = polygonClipping.intersection(see.wasser, [[[x0 + d, y0 + d], [x1 - d, y0 + d], [x1 - d, y1 - d], [x0 + d, y1 - d], [x0 + d, y0 + d]]]);
				aufPlatte(seeKoerper, dreieckeAus(innen), rs, x0, y0, m.k, -Math.min(WASSER_UNTER_LAND_MM, tief / 2), tief + 0.6);
			}
			const gruen: Netz = w.gruen ? gruenFlaechen(objekte, x0, y0, x1, y1, m.k, rs, see && tief > 0 ? see : null) : [];
			kacheln.push({ name: m.nx * m.ny > 1 ? `kachel_${String.fromCharCode(65 + j)}${i + 1}` : 'modell', i, j, bMm: kb * m.k, hMm: kh * m.k, platte, wasser, see: seeKoerper, haeuser, kleine, strassen, gruen });
		}
	return { kacheln, masse: m };
}

/**
 * Ein Körper auf der Platte: Dreiecke (gegen den Uhrzeigersinn, Meter) oben
 * `hoch` über ihr, unten `tief` in ihr. Mit Gelände wird jedes Dreieck an den
 * Maschen und Diagonalen der Platte geteilt (`aufsRaster`); so liegt jedes
 * Stück in einem Dreieck der Platte, und der Körper ist überall genau so dick
 * wie gewollt. Vorher wurde nur gleichmäßig verfeinert; auf einer Kuppe
 * stach die Platte dann durch Grün und Straßen (Volker, 05.11.2026). Die
 * Wände entstehen aus den Rändern der Zerlegung, so passen sie Ecke an Ecke,
 * und der Körper ist geschlossen.
 */
function aufPlatte(aus: Netz, dreiecke: [number, number][][], rs: Raster, x0: number, y0: number, k: number, hoch: number, tief: number) {
	if (!rs.eben) dreiecke = dreiecke.flatMap((t) => aufsRaster(t, rs, x0, y0));
	const p = (q: [number, number], z: number) => [(q[0] - x0) * k, (q[1] - y0) * k, z];
	const oben = (q: [number, number]) => p(q, rs.hoehe(q[0], q[1]) + hoch);
	const unten = (q: [number, number]) => p(q, rs.hoehe(q[0], q[1]) - tief);
	const kante = new Map<string, number>();
	const sch = (q: [number, number]) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`;
	for (const t of dreiecke) {
		aus.push(...oben(t[0]), ...oben(t[1]), ...oben(t[2]));
		aus.push(...unten(t[0]), ...unten(t[2]), ...unten(t[1]));
		for (let e = 0; e < 3; e++) { const key = `${sch(t[e])}>${sch(t[(e + 1) % 3])}`; kante.set(key, (kante.get(key) ?? 0) + 1); }
	}
	// Wände an den Kanten, die nur ein Dreieck hat: dort ist der Rand.
	for (const t of dreiecke)
		for (let e = 0; e < 3; e++) {
			const a = t[e], b = t[(e + 1) % 3];
			if (kante.has(`${sch(b)}>${sch(a)}`)) continue;
			aus.push(...unten(a), ...unten(b), ...oben(b), ...unten(a), ...oben(b), ...oben(a));
		}
	schnitt(aus);
}

/**
 * Straßen als Streifen, `STRASSE_MM` über der Platte und ebenso tief in sie
 * hinein. Jeder Weg ein Körper mit Gehrung an den Knicken; wo Wege sich
 * treffen, ein Achteck, damit die Ecken nicht aufklaffen. Der Slicer
 * verschmilzt, was sich überlappt. Breite wie im Plan, mindestens 0,6 mm;
 * was schmaler als 0,4 mm würde (Fußwege bei kleinem Maßstab), fällt weg.
 */
function strassenStreifen(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number, k: number, rs: Raster): Netz {
	const aus: Netz = [];
	const d = 0.05 / k, cx0 = x0 + d, cy0 = y0 + d, cx1 = x1 - d, cy1 = y1 - d;
	const innen = (q: number[]): [number, number] => [Math.max(cx0, Math.min(cx1, q[0])), Math.max(cy0, Math.min(cy1, q[1]))];
	/** Konvexe Vielecke gegen den Uhrzeigersinn als ein Körper, in der Kachel gehalten. */
	const koerper = (vielecke: number[][][]) => {
		const f: [number, number][][] = [];
		for (const eck of vielecke) {
			const e = eck.map(innen);
			for (let n = 1; n + 1 < e.length; n++) f.push([e[0], e[n], e[n + 1]]);
		}
		if (f.length) aufPlatte(aus, f, rs, x0, y0, k, STRASSE_MM, STRASSE_MM);
	};
	const drin = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
	const gelenke = new Set<string>();
	const pk = (q: number[]) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
	// Wie oft ein Punkt als Ende oder Knick eines Wegs vorkommt: Wo sich Wege treffen, kommt ein Gelenk hin.
	const treffen = new Map<string, number>();
	for (const o of objekte)
		if (o.ebene === 'strasse' && o.art === 'linie' && o.zustand !== 'gestrichen')
			for (const zug of o.ringe) for (const q of zug) treffen.set(pk(q), (treffen.get(pk(q)) ?? 0) + 1);
	/** Gelenk um einen Punkt, um 11,25° gedreht: So teilt es keine Ecke mit einem Streifen. Je Punkt nur einmal. */
	const gelenk = (x: number, y: number, halb: number) => {
		const g = `${x.toFixed(2)},${y.toFixed(2)},${halb.toFixed(2)}`;
		if (!drin(x, y) || gelenke.has(g)) return;
		gelenke.add(g);
		const acht: number[][] = [];
		for (let e = 0; e < 8; e++) acht.push([x + halb * Math.cos(((e + 0.125) * Math.PI) / 4), y + halb * Math.sin(((e + 0.125) * Math.PI) / 4)]);
		koerper([acht]);
	};
	for (const o of objekte) {
		if (o.ebene !== 'strasse' || o.art !== 'linie' || o.zustand === 'gestrichen') continue;
		const bMm = (o.breiteM ?? 6) * k;
		if (bMm < STRASSE_WEG_MM) continue;
		const halb = Math.max(bMm, STRASSE_MIN_MM) / 2 / k;   // halbe Breite in Metern
		for (const zug of o.ringe) {
			// Jede Strecke auf die Kachel kürzen (Liang–Barsky), einen Hauch innerhalb
			// der Kante wie die Häuser. Gemerkt wird, welche Kante sie schneidet.
			const st: { i: number; a: number[]; b: number[]; u: number[]; l: number; k0: number; k1: number }[] = [];
			for (let i = 0; i + 1 < zug.length; i++) {
				const [ax, ay] = zug[i], [bx, by] = zug[i + 1];
				const dx = bx - ax, dy = by - ay;
				let t0 = 0, t1 = 1, k0 = -1, k1 = -1;
				const kanten = [[-dx, ax - cx0], [dx, cx1 - ax], [-dy, ay - cy0], [dy, cy1 - ay]] as [number, number][];
				kanten.forEach(([p, q], e) => {
					if (p === 0) { if (q < 0) { t0 = 1; t1 = 0; } return; }
					const t = q / p;
					if (p < 0) { if (t > t0) { t0 = t; k0 = e; } } else if (t < t1) { t1 = t; k1 = e; }
				});
				if (t1 - t0 <= 1e-9) continue;
				const a = [ax + dx * t0, ay + dy * t0], b = [ax + dx * t1, ay + dy * t1];
				const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
				if (l < 1e-6) continue;
				st.push({ i, a, b, u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], l, k0, k1 });
			}
			/**
			 * Ein Weg ist ein Körper: Die Strecken stoßen an jedem Knick auf Gehrung
			 * aneinander und teilen dort genau eine Kante. Vorher war jede Strecke
			 * ein eigener Quader und jeder Knick ein Achteck darüber; in Rhino sah
			 * das zerstückelt aus (Volker, 05.11.2026). Ist der Knick zu spitz oder
			 * die Strecke zu kurz für die Gehrung, beginnt dort ein neuer Körper,
			 * und ein Achteck schließt die Ecke.
			 */
			const gehrung = (s1: (typeof st)[0], s2: (typeof st)[0]) => {
				if (s2.i !== s1.i + 1 || s1.k1 >= 0 || s2.k0 >= 0) return null;
				const n1 = [-s1.u[1], s1.u[0]], n2 = [-s2.u[1], s2.u[0]];
				const m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(m[0], m[1]);
				if (ml < 1e-9) return null;
				const c = (m[0] * n1[0] + m[1] * n1[1]) / ml;        // cos des halben Knickwinkels
				if (c < 0.5) return null;                              // spitzer als 120°
				const lang = halb / c, weit = halb * Math.sqrt(Math.max(0, 1 - c * c)) / c;
				if (weit > 0.45 * Math.min(s1.l, s2.l)) return null;
				const p = s1.b;
				return { l: [p[0] + (m[0] / ml) * lang, p[1] + (m[1] / ml) * lang], r: [p[0] - (m[0] / ml) * lang, p[1] - (m[1] / ml) * lang] };
			};
			/**
			 * Am Kachelrand endet der Streifen bündig mit der Kante statt
			 * rechtwinklig zu sich selbst: Jede Ecke der Kappe rückt längs der
			 * Strecke auf die Kante, höchstens fast bis zur Mitte, damit das
			 * Viereck nicht umklappt. Vorher endeten die Streifen eine halbe
			 * Breite vor dem Rand und schräg zu ihm (Volker, 05.11.2026).
			 */
			const aufKante = (q: number[], e: number, s1: (typeof st)[0]) => {
				if (e < 0) return q;
				const s = e < 2 ? ((e === 0 ? cx0 : cx1) - q[0]) / s1.u[0] : ((e === 2 ? cy0 : cy1) - q[1]) / s1.u[1];
				const t = Math.max(-0.45 * s1.l, Math.min(0.45 * s1.l, s));
				return [q[0] + s1.u[0] * t, q[1] + s1.u[1] * t];
			};
			// Offene Enden 0,01 mm über den Punkt hinaus, damit sie andere Wege überlappen statt sie genau zu berühren.
			const ue = 0.01 / k;
			let lauf: number[][][] = [];
			let vorne: { l: number[]; r: number[] } | null = null;
			for (let n = 0; n < st.length; n++) {
				const s1 = st[n], [ux, uy] = s1.u, nx = -uy * halb, ny = ux * halb;
				if (!vorne) {
					const e0 = s1.k0 < 0 ? ue : 0, sx = s1.a[0] - ux * e0, sy = s1.a[1] - uy * e0;
					vorne = { l: aufKante([sx + nx, sy + ny], s1.k0, s1), r: aufKante([sx - nx, sy - ny], s1.k0, s1) };
					if (s1.k0 < 0 && (treffen.get(pk(s1.a)) ?? 0) > 1) gelenk(s1.a[0], s1.a[1], halb);
				}
				const g = n + 1 < st.length ? gehrung(s1, st[n + 1]) : null;
				let hinten: { l: number[]; r: number[] };
				if (g) hinten = g;
				else {
					const e1 = s1.k1 < 0 ? ue : 0, ex = s1.b[0] + ux * e1, ey = s1.b[1] + uy * e1;
					hinten = { l: aufKante([ex + nx, ey + ny], s1.k1, s1), r: aufKante([ex - nx, ey - ny], s1.k1, s1) };
				}
				lauf.push([vorne.r, hinten.r, hinten.l, vorne.l]);
				vorne = g ? hinten : null;
				if (!g) {
					koerper(lauf);
					lauf = [];
					// Knick ohne Gehrung, oder ein Weg trifft hier andere: ein Achteck schließt die Ecke.
					const weiter = n + 1 < st.length && st[n + 1].i === s1.i + 1 && s1.k1 < 0;
					if (s1.k1 < 0 && (weiter || (treffen.get(pk(s1.b)) ?? 0) > 1)) gelenk(s1.b[0], s1.b[1], halb);
				}
			}
		}
	}
	return aus;
}

/**
 * Grünflächen als eigener Körper: oben `GRUEN_MM` über der Platte, unten
 * 0,6 mm in ihr, damit sie im Mehrfarbdruck als eigene Farbe oben liegen.
 * Wie Häuser und Straßen einen Hauch innerhalb der Kachel geschnitten: Sonst
 * fällt die Wand des Grüns mit der Seite der Platte zusammen, in der Vorschau
 * schimmert das Grün dort durch, und der Slicer hat zwei Flächen
 * aufeinander (Volker, 05.11.2026).
 */
function gruenFlaechen(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number, k: number, rs: Raster,
	see: { wasser: MultiPolygon } | null): Netz {
	// Je Wasserfläche ihr Umriss als Kasten: Grün wird nur gegen das Wasser geschnitten, das es berührt.
	const kaesten = (see?.wasser ?? []).map((poly) => {
		const xs = poly[0].map((q) => q[0]), ys = poly[0].map((q) => q[1]);
		return { poly, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
	});
	const aus: Netz = [];
	const d = 0.05 / k, c = [x0 + d, y0 + d, x1 - d, y1 - d] as const;
	for (const o of objekte) {
		if (o.ebene !== 'gruen' || o.art !== 'flaeche' || o.zustand === 'gestrichen') continue;
		const hoefe = (o.loecher ?? []).map((l) => sauber(amRahmen(l, ...c).innen)).filter((l) => l.length >= 3);
		for (const roh of o.ringe) {
			const aussen = sauber(amRahmen(roh, ...c).innen);
			if (aussen.length < 3) continue;
			// Über Wasser kein Grün: Es läge über der Senke in der Luft.
			const gx = aussen.map((q) => q[0]), gy = aussen.map((q) => q[1]);
			const gx0 = Math.min(...gx), gx1 = Math.max(...gx), gy0 = Math.min(...gy), gy1 = Math.max(...gy);
			const nass = kaesten.filter((w) => w.x0 < gx1 && w.x1 > gx0 && w.y0 < gy1 && w.y1 > gy0).map((w) => w.poly);
			const flaeche: MultiPolygon = [[zu(aussen), ...hoefe.map(zu)]];
			const dreiecke = dreieckeAus(nass.length ? polygonClipping.difference(flaeche, ...nass) : flaeche);
			if (!dreiecke.length) continue;
			aufPlatte(aus, dreiecke, rs, x0, y0, k, GRUEN_MM, 0.6);
		}
	}
	return aus;
}

/** Das Raster der Plattenoberseite einer Kachel, Ecken in mm über der Unterseite. */
type Raster = { eben: boolean; nx: number; ny: number; cw: number; ch: number; z: number[][]; hoehe: (x: number, y: number) => number };

/**
 * Die Oberseite der Platte als Raster im Abstand des Geländenetzes, jede
 * Masche längs derselben Diagonale geteilt. `hoehe` liest genau diese
 * Dreiecke ab, nicht das Geländenetz: Das Raster der Kachel liegt gegen das
 * Netz verschoben, und was auf der Platte liegen soll, muss ihr folgen.
 */
function plattenRaster(feld: Feld | null, r: Rahmen, x0: number, y0: number, x1: number, y1: number,
	plattenZ: (z: number) => number): Raster {
	const weite = feld ? feld.dx : Infinity;
	const nx = Math.max(1, Math.ceil((x1 - x0) / weite)), ny = Math.max(1, Math.ceil((y1 - y0) / weite));
	const cw = (x1 - x0) / nx, ch = (y1 - y0) / ny;
	const z: number[][] = [];
	for (let j = 0; j <= ny; j++) {
		z.push([]);
		for (let i = 0; i <= nx; i++) z[j].push(feld ? plattenZ(netzHoehe(feld, x0 + cw * i - r.x0, y0 + ch * j - r.y0)) : plattenZ(0));
	}
	const hoehe = (x: number, y: number) => {
		const fx = Math.max(0, Math.min(nx, (x - x0) / cw)), fy = Math.max(0, Math.min(ny, (y - y0) / ch));
		const i = Math.min(nx - 1, Math.floor(fx)), j = Math.min(ny - 1, Math.floor(fy));
		const a = fx - i, b = fy - j;
		return a >= b
			? z[j][i] + a * (z[j][i + 1] - z[j][i]) + b * (z[j + 1][i + 1] - z[j][i + 1])
			: z[j][i] + b * (z[j + 1][i] - z[j][i]) + a * (z[j + 1][i + 1] - z[j + 1][i]);
	};
	return { eben: !feld, nx, ny, cw, ch, z, hoehe };
}

/**
 * Ein Dreieck (gegen den Uhrzeigersinn, Meter) in die Stücke zerlegen, die je
 * in einem Dreieck der Platte liegen: Schnitt mit jeder berührten Masche und
 * ihren beiden Hälften, dann als Fächer. Benachbarte Dreiecke werden an
 * denselben Linien geteilt, die Teilpunkte auf gemeinsamen Kanten fallen
 * zusammen. Flache Fächerstücke bleiben, damit keine Kante offen bleibt.
 */
function aufsRaster(t: [number, number][], rs: Raster, x0: number, y0: number): [number, number][][] {
	const xs = t.map((q) => (q[0] - x0) / rs.cw), ys = t.map((q) => (q[1] - y0) / rs.ch);
	const i0 = Math.max(0, Math.min(rs.nx - 1, Math.floor(Math.min(...xs)))), i1 = Math.max(i0, Math.min(rs.nx - 1, Math.ceil(Math.max(...xs)) - 1));
	const j0 = Math.max(0, Math.min(rs.ny - 1, Math.floor(Math.min(...ys)))), j1 = Math.max(j0, Math.min(rs.ny - 1, Math.ceil(Math.max(...ys)) - 1));
	/** Sutherland–Hodgman gegen die Halbebene a·x + b·y + c ≥ 0. */
	const halb = (poly: [number, number][], a: number, b: number, c: number) => {
		const aus: [number, number][] = [];
		for (let n = 0; n < poly.length; n++) {
			const p = poly[n], q = poly[(n + 1) % poly.length];
			const fp = a * p[0] + b * p[1] + c, fq = a * q[0] + b * q[1] + c;
			if (fp >= 0) aus.push(p);
			if ((fp >= 0) !== (fq >= 0)) { const s = fp / (fp - fq); aus.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s]); }
		}
		return aus;
	};
	const stuecke: [number, number][][] = [];
	for (let j = j0; j <= j1; j++)
		for (let i = i0; i <= i1; i++) {
			const ax = x0 + i * rs.cw, ay = y0 + j * rs.ch, bx = ax + rs.cw, by = ay + rs.ch;
			let zelle = halb(halb(halb(halb(t, 1, 0, -ax), -1, 0, bx), 0, 1, -ay), 0, -1, by);
			if (zelle.length < 3) continue;
			// Diagonale von (ax, ay) nach (bx, by), in Maschenanteilen: unter ihr a ≥ b.
			const da = 1 / rs.cw, db = 1 / rs.ch, dc = -(ax / rs.cw) + ay / rs.ch;
			for (const seite of [1, -1]) {
				const poly = halb(zelle, seite * da, -seite * db, seite * dc).filter((q, n, a) => {
					const v = a[(n + a.length - 1) % a.length];
					return a.length < 2 || Math.abs(q[0] - v[0]) > 1e-9 || Math.abs(q[1] - v[1]) > 1e-9;
				});
				for (let n = 1; n + 1 < poly.length; n++) stuecke.push([poly[0], poly[n], poly[n + 1]]);
			}
		}
	return stuecke;
}

/** Ein Ring als geschlossener Zug für `polygon-clipping`. */
const zu = (r: [number, number][]): [number, number][] => [...r, r[0]];

/** Dreiecke gegen den Uhrzeigersinn aus einem Multipolygon (Ringe geschlossen, wie `polygon-clipping` sie liefert). */
function dreieckeAus(mp: MultiPolygon): [number, number][][] {
	const aus: [number, number][][] = [];
	for (const poly of mp) {
		const ringe = poly.map((r) => r.slice(0, -1) as [number, number][]).filter((r) => r.length >= 3);
		if (!ringe.length) continue;
		const flach: number[] = [], grenzen: number[] = [];
		ringe.forEach((r, i) => { if (i) grenzen.push(flach.length / 2); for (const [x, y] of r) flach.push(x, y); });
		const alle = ringe.flat();
		const idx = earcut(flach, grenzen);
		for (let n = 0; n < idx.length; n += 3) {
			let t = [alle[idx[n]], alle[idx[n + 1]], alle[idx[n + 2]]];
			if ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]) < 0) t = [t[0], t[2], t[1]];
			aus.push(t);
		}
	}
	return aus;
}

/**
 * Das Wasser einer Kachel: alle Wasserflächen vereinigt, Inseln ausgespart,
 * auf die Kachel geschnitten; dazu das Land als Rest und ein schneller Test
 * für einzelne Punkte (eine Maske im Meterraster).
 */
const seeSchon = new WeakMap<Objekt[], Map<string, ReturnType<typeof seeRechnen>>>();
/**
 * Gemerkt je Datenstand und Kachel: In Lower Manhattan kostet das Vereinigen
 * von Hudson, East River und Hafen Sekunden, und die Vorschau rechnet bei
 * jeder Einstellung neu, die am Wasser nichts ändert.
 */
function seeIn(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number) {
	let m = seeSchon.get(objekte);
	if (!m) seeSchon.set(objekte, (m = new Map()));
	const k = `${x0},${y0},${x1},${y1}`;
	if (!m.has(k)) m.set(k, seeRechnen(objekte, x0, y0, x1, y1));
	return m.get(k)!;
}
function seeRechnen(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number) {
	const aussen: MultiPolygon = [], innen: MultiPolygon = [];
	for (const o of objekte) {
		if (o.ebene !== 'wasser' || o.art !== 'flaeche' || o.zustand === 'gestrichen') continue;
		for (const r of o.ringe) if (r.length >= 3) aussen.push([zu(r)]);
		for (const r of o.loecher ?? []) if (r.length >= 3) innen.push([zu(r)]);
	}
	if (!aussen.length) return null;
	const kachel: MultiPolygon = [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]];
	let wasser = polygonClipping.intersection(kachel, polygonClipping.union(aussen[0], ...aussen.slice(1)));
	if (innen.length) wasser = polygonClipping.difference(wasser, ...innen);
	if (!wasser.length) return null;
	const land = polygonClipping.difference(kachel, wasser);
	// Maske: je Zeile die Schnittpunkte aller Ränder, dazwischen abwechselnd Wasser.
	const Z = 1, nx = Math.ceil((x1 - x0) / Z), ny = Math.ceil((y1 - y0) / Z);
	const maske = new Uint8Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		const y = y0 + (j + 0.5) * Z, xs: number[] = [];
		for (const poly of wasser) for (const ring of poly)
			for (let n = 0; n + 1 < ring.length; n++) {
				const [ax, ay] = ring[n], [bx, by] = ring[n + 1];
				if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
			}
		xs.sort((a, b) => a - b);
		for (let n = 0; n + 1 < xs.length; n += 2)
			for (let i = Math.max(0, Math.ceil((xs[n] - x0) / Z - 0.5)); i < nx && x0 + (i + 0.5) * Z < xs[n + 1]; i++) maske[j * nx + i] = 1;
	}
	const nass = (x: number, y: number) => {
		const i = Math.floor((x - x0) / Z), j = Math.floor((y - y0) / Z);
		return i >= 0 && j >= 0 && i < nx && j < ny && maske[j * nx + i] === 1;
	};
	return { wasser, land, nass };
}

/**
 * Die Platte: oben Land und, `tief` darunter, Wasser, unten null, Seiten
 * dazwischen. Beide Flächen werden an den Maschen der Platte geteilt
 * (`aufsRaster`) und teilen am Ufer genau dieselben Kanten; dort steht eine
 * senkrechte Wand vom Wasser zum Land, am Rand eine bis auf null. Alles
 * geschlossen. `wasser` ist nur die Oberseite des Wassers, für die Vorschau:
 * Die Senke allein sieht man aus der Ferne nicht (Volker, 05.11.2026).
 */
function grundplatte(rs: Raster, k: number, see: { wasser: MultiPolygon; land: MultiPolygon } | null, tief: number,
	x0: number, y0: number, x1: number, y1: number): { netz: Netz; wasser: Netz } {
	const aus: Netz = [], wasser: Netz = [];
	const kachel: MultiPolygon = [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]];
	const teile: { dreiecke: [number, number][][]; ab: number }[] = see
		? [{ dreiecke: dreieckeAus(see.land), ab: 0 }, { dreiecke: dreieckeAus(see.wasser), ab: tief }]
		: [{ dreiecke: dreieckeAus(kachel), ab: 0 }];
	for (const t of teile) if (!rs.eben) t.dreiecke = t.dreiecke.flatMap((d) => aufsRaster(d, rs, x0, y0));
	const p = (q: [number, number], z: number) => [(q[0] - x0) * k, (q[1] - y0) * k, z];
	const sch = (q: [number, number]) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`;
	// Welche gerichtete Kante zu welcher Fläche gehört.
	const kante = new Map<string, number>();
	teile.forEach((t, n) => { for (const d of t.dreiecke) for (let e = 0; e < 3; e++) kante.set(`${sch(d[e])}>${sch(d[(e + 1) % 3])}`, n); });
	teile.forEach((t, n) => {
		const oben = (q: [number, number]) => p(q, rs.hoehe(q[0], q[1]) - t.ab);
		const null0 = (q: [number, number]) => p(q, 0);
		for (const d of t.dreiecke) {
			aus.push(...oben(d[0]), ...oben(d[1]), ...oben(d[2]));
			if (t.ab > 0) wasser.push(...oben(d[0]), ...oben(d[1]), ...oben(d[2]));
			aus.push(...null0(d[0]), ...null0(d[2]), ...null0(d[1]));
			for (let e = 0; e < 3; e++) {
				const a = d[e], b = d[(e + 1) % 3];
				const gegen = kante.get(`${sch(b)}>${sch(a)}`);
				if (gegen === n) continue;
				// Am Rand bis null; am Ufer nur vom höheren Land aus, bis auf das Wasser.
				// Die Randwand des Landes ist auf Wasserhöhe geteilt: Wo das Ufer den
				// Rand erreicht, trifft ihre senkrechte Kante sonst auf zwei Kanten
				// (Wasserwand und Uferwand) und bliebe offen.
				if (gegen === undefined) {
					const tiefer = teile.length > 1 && t.ab < tief;
					const mitte = (q: [number, number]) => p(q, rs.hoehe(q[0], q[1]) - tief);
					if (tiefer) {
						aus.push(...null0(a), ...null0(b), ...mitte(b), ...null0(a), ...mitte(b), ...mitte(a));
						aus.push(...mitte(a), ...mitte(b), ...oben(b), ...mitte(a), ...oben(b), ...oben(a));
					} else aus.push(...null0(a), ...null0(b), ...oben(b), ...null0(a), ...oben(b), ...oben(a));
				} else if (t.ab < teile[gegen].ab) {
					const unten = (q: [number, number]) => p(q, rs.hoehe(q[0], q[1]) - teile[gegen].ab);
					aus.push(...unten(a), ...unten(b), ...oben(b), ...unten(a), ...oben(b), ...oben(a));
				}
			}
		}
	});
	schnitt(aus);
	return { netz: aus, wasser };
}

/** Ein flacher Körper mit Boden und Höfen, im Ortsgitter, Fuß auf null. */
function quader(teile: [number, number][][], loecher: [number, number][][], h: number): Netz {
	const aus: Netz = [];
	for (const roh of teile) {
		const aussen = gegenUhr(roh);
		const hoefe = loecher.filter((l) => drin(l[0], aussen)).map(mitUhr);
		for (const kette of [aussen, ...hoefe])
			for (let i = 0; i < kette.length; i++) {
				const [ax, ay] = kette[i], [bx, by] = kette[(i + 1) % kette.length];
				aus.push(ax, ay, 0, bx, by, 0, bx, by, h, ax, ay, 0, bx, by, h, ax, ay, h);
			}
		const flach: number[] = [], grenzen: number[] = [];
		for (const [x, y] of aussen) flach.push(x, y);
		for (const l of hoefe) { grenzen.push(flach.length / 2); for (const [x, y] of l) flach.push(x, y); }
		const alle = [aussen, ...hoefe].flat();
		const idx = earcut(flach, grenzen);
		for (let k = 0; k < idx.length; k += 3) {
			const A = alle[idx[k]], B = alle[idx[k + 1]], C = alle[idx[k + 2]];
			const ccw = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0;
			const [P, Q] = ccw ? [B, C] : [C, B];
			aus.push(A[0], A[1], h, P[0], P[1], h, Q[0], Q[1], h);   // Dach nach oben
			aus.push(A[0], A[1], 0, Q[0], Q[1], 0, P[0], P[1], 0);   // Boden nach unten
		}
	}
	return aus;
}

/** Binäres STL, alle Körper zusammen. */
export function alsStl(netze: Netz[], kopf = 'Nolli 3D print, mm'): Uint8Array {
	let n = 0;
	for (const q of netze) for (let i = 0; i < q.length; i += 9) if (!istSchnitt(q, i)) n++;
	const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
	const k = strToU8(kopf.slice(0, 79));
	new Uint8Array(buf, 0, 80).set(k);
	dv.setUint32(80, n, true);
	let o = 84;
	for (const q of netze)
		for (let i = 0; i < q.length; i += 9) {
			if (istSchnitt(q, i)) continue;
			const ux = q[i + 3] - q[i], uy = q[i + 4] - q[i + 1], uz = q[i + 5] - q[i + 2];
			const wx = q[i + 6] - q[i], wy = q[i + 7] - q[i + 1], wz = q[i + 8] - q[i + 2];
			const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
			dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
			for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + j * 4, q[i + j], true);
			o += 50;
		}
	return new Uint8Array(buf);
}

/** Die Druckplatte der Bambu Lab X1 Carbon, auf deren Mitte das Modell gelegt wird. */
const BETT_MITTE_MM = 128;

/**
 * 3MF: ein Objekt aus Teilen (Platte, Häuser, Straßen, Grün), damit jedem
 * Teil eine Spule zugeordnet werden kann. Als vier eigene Objekte fragte
 * Bambu Studio „Mehrteiliges Objekt erkannt“ (Volker, 05.11.2026); mit
 * `components` lädt es sie ohne Rückfrage als ein Objekt mit Teilen.
 * Das Modell liegt mittig auf der Druckplatte der X1 Carbon. Die Ecken
 * werden zusammengelegt (auf 1 µm), sonst sieht der Slicer keine
 * geschlossenen Kanten.
 */
export function als3mf(objekte: { name: string; netz: Netz }[]): Uint8Array {
	const teile: string[] = [];
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const ob of objekte) for (let i = 0; i < ob.netz.length; i += 3) {
		if (Number.isNaN(ob.netz[i])) continue;
		x0 = Math.min(x0, ob.netz[i]); x1 = Math.max(x1, ob.netz[i]); y0 = Math.min(y0, ob.netz[i + 1]); y1 = Math.max(y1, ob.netz[i + 1]);
	}
	const tx = Number.isFinite(x0) ? BETT_MITTE_MM - (x0 + x1) / 2 : 0, ty = Number.isFinite(y0) ? BETT_MITTE_MM - (y0 + y1) / 2 : 0;
	objekte.forEach((ob, n) => {
		const index = new Map<string, number>(), ecken: string[] = [], dreiecke: string[] = [];
		const ecke = (x: number, y: number, z: number) => {
			const s = `${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`;
			let i = index.get(s);
			if (i === undefined) { i = ecken.length; index.set(s, i); const [a, b, c] = s.split(' '); ecken.push(`<vertex x="${a}" y="${b}" z="${c}"/>`); }
			return i;
		};
		for (let i = 0; i < ob.netz.length; i += 9) {
			// Neuer Körper: gleiche Ecken nicht mit dem vorigen zusammenlegen.
			if (istSchnitt(ob.netz, i)) { index.clear(); continue; }
			const a = ecke(ob.netz[i], ob.netz[i + 1], ob.netz[i + 2]);
			const b = ecke(ob.netz[i + 3], ob.netz[i + 4], ob.netz[i + 5]);
			const c = ecke(ob.netz[i + 6], ob.netz[i + 7], ob.netz[i + 8]);
			if (a !== b && b !== c && a !== c) dreiecke.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
		}
		teile.push(`<object id="${n + 1}" name="${ob.name}" type="model"><mesh><vertices>${ecken.join('')}</vertices><triangles>${dreiecke.join('')}</triangles></mesh></object>`);
	});
	const modell = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Nolli</metadata>
<resources>${teile.join('\n')}
<object id="${objekte.length + 1}" name="nolli" type="model"><components>${objekte.map((_, n) => `<component objectid="${n + 1}"/>`).join('')}</components></object></resources>
<build><item objectid="${objekte.length + 1}" transform="1 0 0 0 1 0 0 0 1 ${tx.toFixed(3)} ${ty.toFixed(3)} 0"/></build>
</model>`;
	return zipSync({
		'[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
		'_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
		'3D/3dmodel.model': strToU8(modell)
	});
}
