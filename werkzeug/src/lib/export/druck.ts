import earcut from 'earcut';
import { zipSync, strToU8 } from 'fflate';
import { unterkante, umrisseMitTeilen, type Objekt } from '../osm';
import { hatDach, dachKoerper } from '../dach';
import { amRahmen } from '../schneiden';
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
	/**
	 * Was gedruckt wird, als Bruchteil des Rahmens (0 bis 1, y von Süden).
	 * Ab Werk alles; ein Teil, wenn der ganze Rahmen nicht druckbar ist.
	 */
	ausschnitt: { x0: number; y0: number; x1: number; y1: number };
};
export const DRUCK_VORGABE: Druckwahl = {
	groesse: 'bett', massstab: 1000, bettMm: 200, sockelMm: 3, ueberhoehung: 1, schwebend: 'durchziehen',
	farben: 'mehr', strassen: true, gruen: true, ausschnitt: { x0: 0, y0: 0, x1: 1, y1: 1 }
};
/** Die Bambu X1 Carbon mit AMS fasst vier Spulen: Platte, Häuser, Straßen, Grün. */
export const DRUCK_FARBEN = 4;
const GRUEN_MM = 0.2;

/** Der Ausschnitt im Ortsgitter. */
export function druckBereich(r: Rahmen, w: Druckwahl) {
	const a = w.ausschnitt ?? DRUCK_VORGABE.ausschnitt, B = r.x1 - r.x0, H = r.y1 - r.y0;
	return { x0: r.x0 + a.x0 * B, y0: r.y0 + a.y0 * H, x1: r.x0 + a.x1 * B, y1: r.y0 + a.y1 * H };
}
/** Wie hoch die Straßen über der Platte stehen, und wie schmal sie höchstens werden. */
const STRASSE_MM = 0.4, STRASSE_MIN_MM = 0.6, STRASSE_WEG_MM = 0.4;
/** Was ein Drucker mit 0,4-mm-Düse noch sauber legt. */
export const MINDEST_MM = 0.8;
const VERSENKT_MM = 0.5;

type Netz = number[];   // x y z je Ecke, drei Ecken je Dreieck, außen gegen den Uhrzeigersinn

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

/** Maße vorab, für die Anzeige: Millimeter je Meter, Gesamtgröße, Kacheln, zu kleine Häuser. */
export function druckMasse(objekte: Objekt[], r: Rahmen, w: Druckwahl) {
	const g = druckBereich(r, w);
	const B = g.x1 - g.x0, H = g.y1 - g.y0;
	const k = w.groesse === 'bett' ? w.bettMm / Math.max(B, H) : 1000 / w.massstab;
	const breiteMm = B * k, hoeheMm = H * k;
	const nx = w.groesse === 'bett' ? 1 : Math.max(1, Math.ceil(breiteMm / w.bettMm - 1e-6));
	const ny = w.groesse === 'bett' ? 1 : Math.max(1, Math.ceil(hoeheMm / w.bettMm - 1e-6));
	let klein = 0;
	for (const o of objekte) {
		if ((o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') || o.zustand === 'gestrichen' || !o.ringe.length) continue;
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const [x, y] of o.ringe[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
		if (x1 < g.x0 || x0 > g.x1 || y1 < g.y0 || y0 > g.y1) continue;
		if (Math.min(x1 - x0, y1 - y0) * k < MINDEST_MM) klein++;
	}
	return { k, breiteMm, hoeheMm, nx, ny, massstab: Math.round(1000 / k), klein };
}

/** Die Körper je Kachel, in Millimetern. */
export function druckModell(objekte: Objekt[], r: Rahmen, gelaende: Gelaende | null, w: Druckwahl) {
	const m = druckMasse(objekte, r, w);
	const feld = gelaende ? feldImRahmen(gelaende, r) : null;
	const g0 = druckBereich(r, w);
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
	const g = druckBereich(r, w);
	const kb = (g.x1 - g.x0) / m.nx, kh = (g.y1 - g.y0) / m.ny;
	const kacheln: { name: string; i: number; j: number; bMm: number; hMm: number; platte: Netz; haeuser: Netz; strassen: Netz; gruen: Netz }[] = [];
	const flaeche = (xm: number, ym: number) => (feld ? plattenZ(netzHoehe(feld, xm - r.x0, ym - r.y0)) : plattenZ(0));

	for (let j = 0; j < m.ny; j++)
		for (let i = 0; i < m.nx; i++) {
			const x0 = g.x0 + i * kb, y0 = g.y0 + j * kh, x1 = x0 + kb, y1 = y0 + kh;
			const mm = (x: number, y: number): [number, number] => [(x - x0) * m.k, (y - y0) * m.k];
			const platte = grundplatte(feld, r, x0, y0, x1, y1, m.k, plattenZ);
			const haeuser: Netz = [];
			for (const roh of objekte) {
				if (roh.ebene !== 'gebaeude' && roh.ebene !== 'erhalt') continue;
				if (roh.zustand === 'gestrichen' || !roh.ringe.length || ersetzt.has(roh.id)) continue;
				const schwebt = unterkante(roh) > 0;
				if (schwebt && w.schwebend === 'weglassen') continue;
				const o: Objekt = schwebt ? { ...roh, unterM: undefined } : roh;
				// Einen Hauch innerhalb der Kachel schneiden: Sonst fällt die Wand eines
				// angeschnittenen Hauses mit der Seite der Platte zusammen und flimmert.
				const d = 0.05 / m.k, [cx0, cy0, cx1, cy1] = [x0 + d, y0 + d, x1 - d, y1 - d];
				const teile = o.ringe.map((x) => sauber(amRahmen(x, cx0, cy0, cx1, cy1).innen)).filter((x) => x.length >= 3);
				if (!teile.length) continue;
				const boden = gelaende ? tiefsteUnter(gelaende, o.ringe) : 0;
				// Fuß in mm, versenkt; darüber zählen die Meter des Hauses unverzerrt.
				const fussMm = plattenZ(boden) - VERSENKT_MM;
				/**
				 * Die Unterseite folgt der Platte, einen halben Millimeter darin;
				 * alles darüber steht auf dem tiefsten Punkt unter dem Grundriss wie
				 * im Modell. Vorher reichte ein Haus am Hang auf der Bergseite tief
				 * in die Platte und schaute an ihrer Seite heraus (Volker, 05.11.2026).
				 */
				const hinein = (q: number[]) => {
					for (let a = 0; a < q.length; a += 3) {
						const [x, y] = mm(q[a], q[a + 1]);
						const unten = Math.abs(q[a + 2]) < 1e-6;
						const f = flaeche(q[a], q[a + 1]);
						// Oben mindestens knapp über der Platte, auch an einem steilen Hang.
						haeuser.push(x, y, unten ? f - VERSENKT_MM : Math.max(f + 0.2, fussMm + q[a + 2] * m.k));
					}
				};
				const ganz = o.ringe.length === 1 && teile.length === 1 && amRahmen(o.ringe[0], cx0, cy0, cx1, cy1).aussen.length === 0;
				const hMm = Math.max(VERSENKT_MM + 0.4, (o.hoeheM ?? 8) * m.k + VERSENKT_MM);
				if (hatDach(o)) {
					// Boden über eine winzige Unterkante, damit `dachKoerper` ihn mitbaut.
					const eps = 1e-3 / m.k;
					hinein(dachKoerper({ ...o, hoeheM: hMm / m.k }, teile, -eps, eps, ganz).dreiecke);
				} else {
					const loecher = (o.loecher ?? []).map((x) => sauber(amRahmen(x, cx0, cy0, cx1, cy1).innen)).filter((x) => x.length >= 3);
					hinein(quader(teile, loecher, hMm / m.k));
				}
			}
			const strassen: Netz = w.strassen ? strassenStreifen(objekte, x0, y0, x1, y1, m.k, flaeche, feld ? feld.dx : Infinity) : [];
			const gruen: Netz = w.gruen ? gruenFlaechen(objekte, x0, y0, x1, y1, m.k, flaeche, feld ? feld.dx : Infinity) : [];
			kacheln.push({ name: m.nx * m.ny > 1 ? `kachel_${String.fromCharCode(65 + j)}${i + 1}` : 'modell', i, j, bMm: kb * m.k, hMm: kh * m.k, platte, haeuser, strassen, gruen });
		}
	return { kacheln, masse: m };
}

/**
 * Straßen als Streifen, `STRASSE_MM` über der Platte und ebenso tief in sie
 * hinein. Jede Strecke ein geschlossener Quader, an jedem Knick ein
 * Achteck, damit die Ecken nicht aufklaffen; der Slicer verschmilzt, was
 * sich überlappt. Mit Gelände wird jede Strecke im Rasterabstand geteilt
 * und folgt so der Platte. Breite wie im Plan, mindestens 0,6 mm; was
 * schmaler als 0,4 mm würde (Fußwege bei kleinem Maßstab), fällt weg.
 */
function strassenStreifen(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number, k: number,
	flaeche: (x: number, y: number) => number, schritt: number): Netz {
	const aus: Netz = [];
	const tri = (a: number[], b: number[], c: number[]) => aus.push(...a, ...b, ...c);
	/** Ein geschlossenes Prisma über einem Vieleck gegen den Uhrzeigersinn, Höhe je Ecke. */
	const prisma = (eck: [number, number][]) => {
		const o = eck.map(([x, y]) => { const f = flaeche(x, y); return { x: (x - x0) * k, y: (y - y0) * k, u: f - STRASSE_MM, h: f + STRASSE_MM }; });
		const n = o.length;
		for (let i = 0; i < n; i++) {
			const a = o[i], b = o[(i + 1) % n];
			tri([a.x, a.y, a.u], [b.x, b.y, b.u], [b.x, b.y, b.h]); tri([a.x, a.y, a.u], [b.x, b.y, b.h], [a.x, a.y, a.h]);
		}
		for (let i = 1; i + 1 < n; i++) {
			tri([o[0].x, o[0].y, o[0].h], [o[i].x, o[i].y, o[i].h], [o[i + 1].x, o[i + 1].y, o[i + 1].h]);
			tri([o[0].x, o[0].y, o[0].u], [o[i + 1].x, o[i + 1].y, o[i + 1].u], [o[i].x, o[i].y, o[i].u]);
		}
	};
	const drin = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
	for (const o of objekte) {
		if (o.ebene !== 'strasse' || o.art !== 'linie' || o.zustand === 'gestrichen') continue;
		const bMm = (o.breiteM ?? 6) * k;
		if (bMm < STRASSE_WEG_MM) continue;
		const halb = Math.max(bMm, STRASSE_MIN_MM) / 2 / k;   // halbe Breite in Metern
		for (const zug of o.ringe) {
			for (let i = 0; i + 1 < zug.length; i++) {
				// Strecke auf die Kachel kürzen (Liang–Barsky), halbe Breite Abstand zum Rand.
				let [ax, ay] = zug[i], [bx, by] = zug[i + 1];
				const dx = bx - ax, dy = by - ay;
				let t0 = 0, t1 = 1;
				const rx0 = x0 + halb, rx1 = x1 - halb, ry0 = y0 + halb, ry1 = y1 - halb;
				for (const [p, q] of [[-dx, ax - rx0], [dx, rx1 - ax], [-dy, ay - ry0], [dy, ry1 - ay]] as [number, number][]) {
					if (p === 0) { if (q < 0) { t0 = 1; t1 = 0; } continue; }
					const t = q / p;
					if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
				}
				if (t1 - t0 <= 1e-9) continue;
				[ax, ay, bx, by] = [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
				const l = Math.hypot(bx - ax, by - ay);
				if (l < 1e-6) continue;
				const nx = (-(by - ay) / l) * halb, ny = ((bx - ax) / l) * halb;
				const stuecke = Math.max(1, Math.ceil(l / schritt));
				for (let s = 0; s < stuecke; s++) {
					const p0 = [ax + ((bx - ax) * s) / stuecke, ay + ((by - ay) * s) / stuecke];
					const p1 = [ax + ((bx - ax) * (s + 1)) / stuecke, ay + ((by - ay) * (s + 1)) / stuecke];
					prisma([[p0[0] - nx, p0[1] - ny], [p1[0] - nx, p1[1] - ny], [p1[0] + nx, p1[1] + ny], [p0[0] + nx, p0[1] + ny]]);
				}
				// Gelenk am inneren Knick
				if (i > 0 && t0 === 0 && drin(ax, ay)) {
					const acht: [number, number][] = [];
					for (let e = 0; e < 8; e++) acht.push([ax + halb * Math.cos((e * Math.PI) / 4), ay + halb * Math.sin((e * Math.PI) / 4)]);
					prisma(acht);
				}
			}
		}
	}
	return aus;
}

/**
 * Grünflächen als eigener Körper: oben `GRUEN_MM` über der Platte, unten
 * 0,6 mm in ihr, damit sie im Mehrfarbdruck als eigene Farbe oben liegen.
 *
 * Mit Gelände folgt die Fläche der Platte. Dazu wird die Zerlegung jeder
 * Fläche gleichmäßig verfeinert, bis keine Kante länger als ein Rasterschritt
 * ist (höchstens dreimal geviertelt). Die Wände entstehen aus den Rändern der
 * verfeinerten Zerlegung, so passen sie Ecke an Ecke, und der Körper ist
 * geschlossen.
 */
function gruenFlaechen(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number, k: number,
	flaeche: (x: number, y: number) => number, schritt: number): Netz {
	const aus: Netz = [];
	for (const o of objekte) {
		if (o.ebene !== 'gruen' || o.art !== 'flaeche' || o.zustand === 'gestrichen') continue;
		const hoefe = (o.loecher ?? []).map((l) => sauber(amRahmen(l, x0, y0, x1, y1).innen)).filter((l) => l.length >= 3);
		for (const roh of o.ringe) {
			const aussen = sauber(amRahmen(roh, x0, y0, x1, y1).innen);
			if (aussen.length < 3) continue;
			const ringe = [aussen, ...hoefe];
			const flach: number[] = [], grenzen: number[] = [];
			for (const [x, y] of aussen) flach.push(x, y);
			for (const l of hoefe) { grenzen.push(flach.length / 2); for (const [x, y] of l) flach.push(x, y); }
			const alle = ringe.flat();
			const idx = earcut(flach, grenzen);
			if (!idx.length) continue;
			let dreiecke: [number, number][][] = [];
			let laengste = 0;
			for (let n = 0; n < idx.length; n += 3) {
				let t = [alle[idx[n]], alle[idx[n + 1]], alle[idx[n + 2]]];
				if ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]) < 0) t = [t[0], t[2], t[1]];
				dreiecke.push(t);
				for (let e = 0; e < 3; e++) laengste = Math.max(laengste, Math.hypot(t[e][0] - t[(e + 1) % 3][0], t[e][1] - t[(e + 1) % 3][1]));
			}
			const stufen = Number.isFinite(schritt) ? Math.min(3, Math.max(0, Math.ceil(Math.log2(laengste / schritt)))) : 0;
			for (let s = 0; s < stufen; s++) {
				const neu: [number, number][][] = [];
				const m = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
				for (const [a, b, c] of dreiecke) {
					const ab = m(a, b), bc = m(b, c), ca = m(c, a);
					neu.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
				}
				dreiecke = neu;
			}
			const p = (q: [number, number], z: number) => [(q[0] - x0) * k, (q[1] - y0) * k, z];
			const oben = (q: [number, number]) => p(q, flaeche(q[0], q[1]) + GRUEN_MM);
			const unten = (q: [number, number]) => p(q, flaeche(q[0], q[1]) - 0.6);
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
		}
	}
	return aus;
}

/** Die Platte: Raster oben (Gelände) und unten (null), Seiten dazwischen. Alles geschlossen. */
function grundplatte(feld: Feld | null, r: Rahmen, x0: number, y0: number, x1: number, y1: number,
	k: number, plattenZ: (z: number) => number): Netz {
	const aus: Netz = [];
	const weite = feld ? feld.dx : Infinity;
	const nx = Math.max(1, Math.ceil((x1 - x0) / weite)), ny = Math.max(1, Math.ceil((y1 - y0) / weite));
	const P = (i: number, j: number) => {
		const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / ny;
		const z = feld ? plattenZ(netzHoehe(feld, x - r.x0, y - r.y0)) : plattenZ(0);
		return [(x - x0) * k, (y - y0) * k, z];
	};
	const oben: number[][][] = [];
	for (let j = 0; j <= ny; j++) { oben.push([]); for (let i = 0; i <= nx; i++) oben[j].push(P(i, j)); }
	const unten = (p: number[]) => [p[0], p[1], 0];
	const tri = (a: number[], b: number[], c: number[]) => aus.push(...a, ...b, ...c);
	for (let j = 0; j < ny; j++)
		for (let i = 0; i < nx; i++) {
			const a = oben[j][i], b = oben[j][i + 1], c = oben[j + 1][i + 1], d = oben[j + 1][i];
			tri(a, b, c); tri(a, c, d);                                   // oben, nach oben
			tri(unten(a), unten(c), unten(b)); tri(unten(a), unten(d), unten(c));   // unten, nach unten
		}
	// Seiten: der Rand gegen den Uhrzeigersinn, je Stück eine Wand nach außen.
	const rand: number[][] = [];
	for (let i = 0; i < nx; i++) rand.push(oben[0][i]);
	for (let j = 0; j < ny; j++) rand.push(oben[j][nx]);
	for (let i = nx; i > 0; i--) rand.push(oben[ny][i]);
	for (let j = ny; j > 0; j--) rand.push(oben[j][0]);
	for (let n = 0; n < rand.length; n++) {
		const a = rand[n], b = rand[(n + 1) % rand.length];
		tri(unten(a), unten(b), b); tri(unten(a), b, a);
	}
	return aus;
}

/** Ein flacher Körper mit Boden und Höfen, im Ortsgitter, Fuß auf null. */
function quader(teile: [number, number][][], loecher: [number, number][][], h: number): Netz {
	const aus: Netz = [];
	const flaeche = (q: [number, number][]) => { let s = 0; for (let i = 0, j = q.length - 1; i < q.length; j = i++) s += q[j][0] * q[i][1] - q[i][0] * q[j][1]; return s / 2; };
	const drin = (p: [number, number], q: [number, number][]) => {
		let d = false;
		for (let i = 0, j = q.length - 1; i < q.length; j = i++) if (q[i][1] > p[1] !== q[j][1] > p[1] && p[0] < ((q[j][0] - q[i][0]) * (p[1] - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) d = !d;
		return d;
	};
	for (const roh of teile) {
		const aussen = flaeche(roh) < 0 ? roh.slice().reverse() : roh;
		const hoefe = loecher.filter((l) => drin(l[0], aussen)).map((l) => (flaeche(l) > 0 ? l.slice().reverse() : l));
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
	const n = netze.reduce((s, q) => s + q.length / 9, 0);
	const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
	const k = strToU8(kopf.slice(0, 79));
	new Uint8Array(buf, 0, 80).set(k);
	dv.setUint32(80, n, true);
	let o = 84;
	for (const q of netze)
		for (let i = 0; i < q.length; i += 9) {
			const ux = q[i + 3] - q[i], uy = q[i + 4] - q[i + 1], uz = q[i + 5] - q[i + 2];
			const wx = q[i + 6] - q[i], wy = q[i + 7] - q[i + 1], wz = q[i + 8] - q[i + 2];
			const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
			dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
			for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + j * 4, q[i + j], true);
			o += 50;
		}
	return new Uint8Array(buf);
}

/**
 * 3MF: Platte und Häuser als zwei Objekte, damit sie sich in zwei Farben
 * drucken lassen. Die Ecken werden zusammengelegt (auf 1 µm), sonst sieht
 * der Slicer keine geschlossenen Kanten.
 */
export function als3mf(objekte: { name: string; netz: Netz }[]): Uint8Array {
	const teile: string[] = [];
	objekte.forEach((ob, n) => {
		const index = new Map<string, number>(), ecken: string[] = [], dreiecke: string[] = [];
		const ecke = (x: number, y: number, z: number) => {
			const s = `${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`;
			let i = index.get(s);
			if (i === undefined) { i = ecken.length; index.set(s, i); const [a, b, c] = s.split(' '); ecken.push(`<vertex x="${a}" y="${b}" z="${c}"/>`); }
			return i;
		};
		for (let i = 0; i < ob.netz.length; i += 9) {
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
<resources>${teile.join('\n')}</resources>
<build>${objekte.map((_, n) => `<item objectid="${n + 1}"/>`).join('')}</build>
</model>`;
	return zipSync({
		'[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
		'_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
		'3D/3dmodel.model': strToU8(modell)
	});
}
