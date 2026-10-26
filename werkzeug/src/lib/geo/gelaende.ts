/**
 * Gelände: Höhen aus einem offenen Höhenmodell, im Ortsgitter.
 *
 * Quelle sind die Terrain Tiles bei AWS im Terrarium-Format: frei, ohne
 * Schlüssel, aus dem Browser abrufbar, weltweit. Die Höhe steckt in den
 * Farbkanälen einer PNG-Kachel, `(R·256 + G + B/256) − 32768` Meter. Das
 * passt zu Nolli, das ohne Server läuft — dieselbe Abwägung wie bei Overpass.
 *
 * **Was die Daten sind und was nicht.** Die Kacheln sind eine Mischung aus
 * mehreren Höhenmodellen, je nach Gegend. In Europa meist EU-DEM mit rund
 * 25 m Raster, sonst SRTM mit rund 30 m, in Teilen der USA feiner. Welche es
 * im Ausschnitt waren, schickt jede Kachel im Kopf `x-amz-meta-x-imagery-sources`
 * mit; das kommt in den Vertrag. Die meisten dieser Modelle messen die
 * Oberfläche, nicht den Boden: Dichte Bebauung und Wald heben sie an. Für
 * Hangneigung, Talform und Flusslage im Maßstab eines Masterplans reicht das;
 * für Böschungen, Kaimauern und Stufen nicht. Wer genauer braucht, setzt ein
 * amtliches Modell ein — die README im Paket sagt, wie.
 *
 * Die Höhen bleiben absolut, in Metern über dem Meer. Das ist die Zahl, die
 * auf einem Lageplan als Höhenkote steht.
 */
import type { Rahmen } from './rahmen';
import { nachGrad } from './utm';

const KACHELN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
/** Feinste Stufe, die es gibt. 15 heißt am 44. Breitengrad rund 3,4 m je Pixel. */
const ZOOM_MAX = 15;
/** Mehr Kacheln holen wir nicht; dann wird die Stufe gröber. */
const KACHELN_MAX = 16;
/** Rand um den Rahmen, damit Körper vor der Rahmenkante eine Fußhöhe haben. */
export const GELAENDE_RAND_M = 150;
/** Rasterweite im Gitter. Feiner als die Quelle, damit die Linien nicht eckig werden. */
export const RASTER_M = 10;

export type Gelaende = {
	/** Linke untere Ecke des Rasters im Ortsgitter. Liegt `GELAENDE_RAND_M` vor dem Rahmen. */
	x0: number; y0: number;
	dx: number; dy: number;
	nx: number; ny: number;
	/** Zeilenweise von Süd nach Nord, je Zeile von West nach Ost. */
	z: Float32Array;
	zoom: number;
	/** Bodenauflösung der Kacheln in der Rahmenmitte, Meter je Pixel. */
	kachelMProPx: number;
	/** Die Höhenmodelle, aus denen die Kacheln stammen, wie sie sie nennen. */
	quellen: string[];
	geholt: string;
};

export class GelaendeFehler extends Error {}

const kachelX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const kachelY = (lat: number, z: number) =>
	((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

/** Das Raster für den Rahmen holen. */
export async function holeGelaende(r: Rahmen, melde: (s: string) => void = () => {}): Promise<Gelaende> {
	const x0 = r.x0 - GELAENDE_RAND_M, y0 = r.y0 - GELAENDE_RAND_M;
	const x1 = r.x1 + GELAENDE_RAND_M, y1 = r.y1 + GELAENDE_RAND_M;
	const nx = Math.ceil((x1 - x0) / RASTER_M) + 1;
	const ny = Math.ceil((y1 - y0) / RASTER_M) + 1;

	// Die Ecken in Grad; das Gitter ist am Ort aufgespannt, die Ränder bleiben
	// damit fast gerade, aber zur Sicherheit alle vier.
	const ecken = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => nachGrad(x, y, r.gitter));
	const west = Math.min(...ecken.map((e) => e.lon)), ost = Math.max(...ecken.map((e) => e.lon));
	const sued = Math.min(...ecken.map((e) => e.lat)), nord = Math.max(...ecken.map((e) => e.lat));

	let zoom = ZOOM_MAX;
	const umfang = (z: number) => {
		const ax = Math.floor(kachelX(west, z)), bx = Math.floor(kachelX(ost, z));
		const ay = Math.floor(kachelY(nord, z)), by = Math.floor(kachelY(sued, z));
		return { ax, bx, ay, by, n: (bx - ax + 1) * (by - ay + 1) };
	};
	while (zoom > 8 && umfang(zoom).n > KACHELN_MAX) zoom--;
	const { ax, bx, ay, by, n } = umfang(zoom);

	// Alle Kacheln zu einem Mosaik.
	const breite = (bx - ax + 1) * 256, hoehe = (by - ay + 1) * 256;
	const mosaik = new Float32Array(breite * hoehe);
	const quellen = new Set<string>();
	let k = 0;
	await Promise.all(
		Array.from({ length: by - ay + 1 }, (_, j) => Array.from({ length: bx - ax + 1 }, (_, i) => [ax + i, ay + j]))
			.flat()
			.map(async ([tx, ty]) => {
				const { werte, quelle } = await kachel(zoom, tx, ty);
				if (quelle) for (const q of quelle.split(',')) quellen.add(q.trim());
				const ox = (tx - ax) * 256, oy = (ty - ay) * 256;
				for (let row = 0; row < 256; row++)
					mosaik.set(werte.subarray(row * 256, row * 256 + 256), (oy + row) * breite + ox);
				melde(`${++k} / ${n}`);
			})
	);

	entstoeren(mosaik, breite, hoehe);

	// Abtasten: je Rasterpunkt in Grad, dann bilinear im Mosaik. Die Werte
	// einer Kachel gelten für die Pixelmitte, daher das halbe Pixel.
	const z = new Float32Array(nx * ny);
	const skala = 256;
	for (let j = 0; j < ny; j++) {
		for (let i = 0; i < nx; i++) {
			const g = nachGrad(x0 + i * RASTER_M, y0 + j * RASTER_M, r.gitter);
			const px = (kachelX(g.lon, zoom) - ax) * skala - 0.5;
			const py = (kachelY(g.lat, zoom) - ay) * skala - 0.5;
			z[j * nx + i] = bilinear(mosaik, breite, hoehe, px, py);
		}
	}

	const mitte = nachGrad((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.gitter);
	return {
		x0, y0, dx: RASTER_M, dy: RASTER_M, nx, ny, z, zoom,
		kachelMProPx: (156543.03392 * Math.cos((mitte.lat * Math.PI) / 180)) / 2 ** zoom,
		quellen: [...quellen].sort(),
		geholt: new Date().toISOString()
	};
}

/**
 * Einzelne Fehlpixel nach unten durch den Median ihrer Nachbarn ersetzen.
 *
 * Am 26.10.2026 in Manhattan: Mitten im Hafen, wo das Höhenmodell um −3 m
 * liegt, standen einzelne Pixel auf bis zu −1.612 m. Im Netz wurden daraus
 * Wände von über einem Kilometer, und Piers auf diesen Pixeln standen tief
 * unter der Stadt. In der Kachel waren es 175 von 65.536 Pixeln.
 *
 * Ersetzt wird nur, was mehr als 30 m unter dem Median der 5 × 5 Nachbarn
 * liegt. In der Manhattan-Kachel traf das genau die 175 Fehlpixel und kein
 * anderes. Eine echte Kante — Kai, Steilhang — bleibt stehen, weil auf ihrer
 * tiefen Seite die Mehrheit der Nachbarn ebenfalls tief liegt. Nur nach
 * unten: Ausreißer nach oben sind nicht beobachtet, und ein Turm oder Fels
 * soll nicht abgetragen werden.
 */
function entstoeren(m: Float32Array, b: number, h: number, schwelle = 30) {
	const R = 2;
	const kopie = m.slice();
	const nb: number[] = [];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < b; x++) {
			const v = kopie[y * b + x];
			// Vorprüfung: Nur wer tiefer liegt als ein direkter Nachbar, kommt in Frage.
			const l = kopie[y * b + Math.max(0, x - 1)], r = kopie[y * b + Math.min(b - 1, x + 1)];
			const o = kopie[Math.max(0, y - 1) * b + x], u = kopie[Math.min(h - 1, y + 1) * b + x];
			if (v >= Math.max(l, r, o, u) - schwelle) continue;
			nb.length = 0;
			for (let yy = Math.max(0, y - R); yy <= Math.min(h - 1, y + R); yy++)
				for (let xx = Math.max(0, x - R); xx <= Math.min(b - 1, x + R); xx++)
					if (xx !== x || yy !== y) nb.push(kopie[yy * b + xx]);
			nb.sort((p, q) => p - q);
			const med = nb[nb.length >> 1];
			if (v < med - schwelle) m[y * b + x] = med;
		}
}

async function kachel(z: number, x: number, y: number): Promise<{ werte: Float32Array; quelle: string | null }> {
	let letzter: unknown;
	for (let versuch = 0; versuch < 3; versuch++) {
		try {
			const a = await fetch(`${KACHELN}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(20000) });
			if (!a.ok) throw new GelaendeFehler(`HTTP ${a.status}`);
			const quelle = a.headers.get('x-amz-meta-x-imagery-sources');
			// Ohne Farbumrechnung und ohne Vormultiplizieren: Die Farbe ist hier
			// eine Zahl, und jede Korrektur verfälscht sie.
			const bild = await createImageBitmap(await a.blob(), {
				colorSpaceConversion: 'none', premultiplyAlpha: 'none'
			});
			const c = new OffscreenCanvas(256, 256);
			const ctx = c.getContext('2d', { willReadFrequently: true });
			if (!ctx) throw new GelaendeFehler('no canvas');
			ctx.drawImage(bild, 0, 0);
			const d = ctx.getImageData(0, 0, 256, 256, { colorSpace: 'srgb' }).data;
			const werte = new Float32Array(256 * 256);
			for (let i = 0; i < werte.length; i++)
				werte[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
			return { werte, quelle };
		} catch (e) {
			letzter = e;
			await new Promise((f) => setTimeout(f, 800 * (versuch + 1)));
		}
	}
	throw new GelaendeFehler(String(letzter instanceof Error ? letzter.message : letzter));
}

function bilinear(a: Float32Array, b: number, h: number, x: number, y: number) {
	const x0 = Math.max(0, Math.min(b - 1, Math.floor(x))), y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
	const x1 = Math.min(b - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
	const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
	const o = a[y0 * b + x0] * (1 - fx) + a[y0 * b + x1] * fx;
	const u = a[y1 * b + x0] * (1 - fx) + a[y1 * b + x1] * fx;
	return o * (1 - fy) + u * fy;
}

/** Höhe an einem Punkt im Ortsgitter, bilinear im Raster. */
export function hoeheBei(g: Gelaende, x: number, y: number): number {
	const fx = Math.max(0, Math.min(g.nx - 1, (x - g.x0) / g.dx));
	const fy = Math.max(0, Math.min(g.ny - 1, (y - g.y0) / g.dy));
	const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fy));
	const u = fx - i, v = fy - j;
	const a = g.z[j * g.nx + i], b = g.z[j * g.nx + i + 1];
	const c = g.z[(j + 1) * g.nx + i], d = g.z[(j + 1) * g.nx + i + 1];
	return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Die tiefste Geländehöhe unter einem Grundriss.
 *
 * Der tiefste und nicht der mittlere Punkt: Am Hang bindet ein Haus dann
 * bergseitig ins Gelände ein und steht talseitig auf dem Boden. Mit dem
 * Mittel schwebte es talseitig, und ein schwebendes Haus fällt sofort auf,
 * ein eingebundenes nicht. So macht es auch CADMapper.
 *
 * Abgetastet werden die Ecken, Zwischenpunkte auf langen Kanten und die
 * Rasterpunkte im Innern — eine Mulde mitten unter einer Halle soll nicht
 * durchrutschen.
 */
export function tiefsteUnter(g: Gelaende, ringe: [number, number][][]): number {
	let tief = Infinity;
	for (const ring of ringe) {
		for (let k = 0; k < ring.length; k++) {
			const [ax, ay] = ring[k], [bx, by] = ring[(k + 1) % ring.length];
			const schritte = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / g.dx));
			for (let s = 0; s < schritte; s++) {
				const t = s / schritte;
				tief = Math.min(tief, hoeheBei(g, ax + (bx - ax) * t, ay + (by - ay) * t));
			}
		}
	}
	const aussen = ringe[0];
	if (aussen && aussen.length > 2) {
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		for (const [x, y] of aussen) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
		const i0 = Math.ceil((minx - g.x0) / g.dx), i1 = Math.floor((maxx - g.x0) / g.dx);
		const j0 = Math.ceil((miny - g.y0) / g.dy), j1 = Math.floor((maxy - g.y0) / g.dy);
		for (let j = Math.max(0, j0); j <= Math.min(g.ny - 1, j1); j++)
			for (let i = Math.max(0, i0); i <= Math.min(g.nx - 1, i1); i++) {
				const x = g.x0 + i * g.dx, y = g.y0 + j * g.dy;
				if (innen(x, y, aussen)) tief = Math.min(tief, g.z[j * g.nx + i]);
			}
	}
	return Number.isFinite(tief) ? tief : 0;
}

function innen(x: number, y: number, ring: [number, number][]) {
	let drin = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i], [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
	}
	return drin;
}

/** Ein Raster genau auf dem Rahmen, für Netz und Höhenlinien. Ursprung: linke untere Rahmenecke. */
export type Feld = { nx: number; ny: number; dx: number; dy: number; z: Float32Array; min: number; max: number };

export function feldImRahmen(g: Gelaende, r: Rahmen, weite = RASTER_M): Feld {
	const b = r.x1 - r.x0, h = r.y1 - r.y0;
	// Höchstens rund 250.000 Maschen. Bei 10 m reicht das für 25 km²; ein
	// größerer Rahmen bekommt ein gröberes Netz, sonst wüchse das OBJ in
	// die Größenordnung von hundert Megabyte — bei einer Quelle mit 25 m.
	weite = Math.max(weite, Math.sqrt((b * h) / 250000));
	const nx = Math.max(2, Math.round(b / weite) + 1), ny = Math.max(2, Math.round(h / weite) + 1);
	const dx = b / (nx - 1), dy = h / (ny - 1);
	const z = new Float32Array(nx * ny);
	let min = Infinity, max = -Infinity;
	for (let j = 0; j < ny; j++)
		for (let i = 0; i < nx; i++) {
			const v = hoeheBei(g, r.x0 + i * dx, r.y0 + j * dy);
			z[j * nx + i] = v;
			if (v < min) min = v;
			if (v > max) max = v;
		}
	return { nx, ny, dx, dy, z, min, max };
}

/**
 * Äquidistanz nach Spanne: so fein wie möglich, aber nicht mehr als rund
 * vierzig Linien. Jede fünfte ist eine Hauptlinie.
 */
export function aequidistanz(spanne: number): number {
	// Nicht feiner als ein Meter: Das Quellmodell rauscht in der Ebene um
	// mehr als einen halben, halbe Meter zeichneten Rauschen statt Gelände.
	for (const a of [1, 2, 5, 10, 20, 25, 50, 100]) if (spanne / a <= 40) return a;
	return 200;
}

export type Hoehenlinie = { hoehe: number; haupt: boolean; punkte: [number, number][]; geschlossen: boolean };

/**
 * Höhenlinien mit Marching Squares, zu Linienzügen verbunden.
 *
 * Die Punkte liegen in Rahmenmetern, Ursprung linke untere Rahmenecke — wie
 * alles andere in DXF und OBJ.
 */
export function hoehenlinien(f: Feld, abstand: number): Hoehenlinie[] {
	const aus: Hoehenlinie[] = [];
	const erste = Math.ceil(f.min / abstand) * abstand;
	for (let hoehe = erste; hoehe <= f.max; hoehe += abstand) {
		// Ein winziger Versatz, damit kein Rasterwert genau auf der Linie liegt.
		const lv = hoehe + 1e-4;
		const stuecke: [[number, number], [number, number]][] = [];
		const p = (i: number, j: number) => f.z[j * f.nx + i];
		const kante = (i0: number, j0: number, i1: number, j1: number): [number, number] => {
			const a = p(i0, j0), b = p(i1, j1);
			const t = (lv - a) / (b - a);
			return [(i0 + (i1 - i0) * t) * f.dx, (j0 + (j1 - j0) * t) * f.dy];
		};
		for (let j = 0; j < f.ny - 1; j++)
			for (let i = 0; i < f.nx - 1; i++) {
				const a = p(i, j) > lv ? 1 : 0, b = p(i + 1, j) > lv ? 2 : 0;
				const c = p(i + 1, j + 1) > lv ? 4 : 0, d = p(i, j + 1) > lv ? 8 : 0;
				const fall = a | b | c | d;
				if (fall === 0 || fall === 15) continue;
				const u = () => kante(i, j, i + 1, j), r = () => kante(i + 1, j, i + 1, j + 1);
				const o = () => kante(i, j + 1, i + 1, j + 1), l = () => kante(i, j, i, j + 1);
				switch (fall) {
					case 1: case 14: stuecke.push([l(), u()]); break;
					case 2: case 13: stuecke.push([u(), r()]); break;
					case 3: case 12: stuecke.push([l(), r()]); break;
					case 4: case 11: stuecke.push([r(), o()]); break;
					case 6: case 9: stuecke.push([u(), o()]); break;
					case 7: case 8: stuecke.push([l(), o()]); break;
					case 5: stuecke.push([l(), o()], [u(), r()]); break;
					case 10: stuecke.push([l(), u()], [r(), o()]); break;
				}
			}
		const haupt = Math.abs(Math.round(hoehe / (abstand * 5)) * abstand * 5 - hoehe) < 1e-6;
		for (const zug of verbinden(stuecke)) aus.push({ hoehe, haupt, ...zug });
	}
	return aus;
}

/** Einzelne Stücke an gleichen Enden zu Linienzügen verketten. */
function verbinden(stuecke: [[number, number], [number, number]][]) {
	const schl = ([x, y]: [number, number]) => `${x.toFixed(3)},${y.toFixed(3)}`;
	const an = new Map<string, number[]>();
	stuecke.forEach(([a, b], i) => {
		for (const k of [schl(a), schl(b)]) { const l = an.get(k); if (l) l.push(i); else an.set(k, [i]); }
	});
	const benutzt = new Uint8Array(stuecke.length);
	const zuege: { punkte: [number, number][]; geschlossen: boolean }[] = [];
	const weiter = (ende: [number, number], zug: [number, number][]) => {
		for (;;) {
			const kand = (an.get(schl(ende)) ?? []).find((i) => !benutzt[i]);
			if (kand === undefined) return;
			benutzt[kand] = 1;
			const [a, b] = stuecke[kand];
			ende = schl(a) === schl(ende) ? b : a;
			zug.push(ende);
		}
	};
	for (let i = 0; i < stuecke.length; i++) {
		if (benutzt[i]) continue;
		benutzt[i] = 1;
		const [a, b] = stuecke[i];
		const vor: [number, number][] = [b];
		weiter(b, vor);
		const zurueck: [number, number][] = [];
		weiter(a, zurueck);
		const punkte = [...zurueck.reverse(), a, ...vor];
		const geschlossen = punkte.length > 3 && schl(punkte[0]) === schl(punkte[punkte.length - 1]);
		if (geschlossen) punkte.pop();
		zuege.push({ punkte, geschlossen });
	}
	return zuege;
}
