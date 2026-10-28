/**
 * Overture Maps als zweite Quelle.
 *
 * Am 28.10.2026 in Upper Saddle River (New Jersey) gemessen: OpenStreetMap
 * kennt dort 13 Gebäude, Overture in derselben Kachel 718 — 705 davon aus
 * den Umrissen, die Microsoft mit maschinellem Lernen aus Luftbildern gewonnen
 * hat. In vielen US-Vororten hat niemand die Häuser in OSM eingetragen.
 *
 * Gelesen wird aus den Vektorkacheln, die Overture als eine große PMTiles-
 * Datei je Thema auf S3 legt. Der Server erlaubt Bereichsabfragen aus dem
 * Browser (CORS offen); Nolli braucht also weiter keinen eigenen Server.
 * Kacheln gibt es bis Zoomstufe 14: 4096 Einheiten auf rund 2,4 km mal
 * cos(Breite), also gut ein halber Meter — genug für den Masterplan.
 *
 * OSM geht vor. Overture enthält selbst einen OSM-Stand, der Wochen alt sein
 * kann; von dort kommt nichts. Übernommen wird nur, was aus anderen Quellen
 * stammt und nicht schon in einem OSM-Gebäude von Nolli liegt.
 */
import { PMTiles, FetchSource } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { nachGitter, type Gitter } from './geo/utm';
import { ringflaeche, istTeil, KLASSEN, type Objekt } from './osm';

/** Rückfall, wenn der Katalog nicht antwortet. Am 28.10.2026 der neueste. */
const RELEASE_RUECKFALL = '2026-10-21.0';
const KATALOG = 'https://stac.overturemaps.org/catalog.json';
const KACHELN = (release: string, thema: string) =>
	`https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/${release}/${thema}.pmtiles`;
const Z = 14;
/** Wie bei Overpass: etwas Nachbarschaft über den Rahmen hinaus. */
const RAND_M = 150;

export type Ecken = { sued: number; west: number; nord: number; ost: number };

let release: string | null = null;
async function aktuellerRelease(stop?: AbortSignal): Promise<string> {
	if (release) return release;
	try {
		const a = await fetch(KATALOG, { signal: stop ?? AbortSignal.timeout(8000) });
		const k = await a.json();
		if (typeof k.latest === 'string' && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(k.latest)) release = k.latest;
	} catch { /* Rückfall unten */ }
	return release ?? RELEASE_RUECKFALL;
}

/** Eine PMTiles-Quelle, deren Abrufe sich abbrechen lassen. */
class Abbrechbar extends FetchSource {
	constructor(url: string, private stop?: AbortSignal) { super(url); }
	async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
		const s = this.stop && signal ? AbortSignal.any([this.stop, signal]) : (this.stop ?? signal);
		return super.getBytes(offset, length, s, etag);
	}
}

function kachelVon(lon: number, lat: number) {
	const n = 2 ** Z, r = (lat * Math.PI) / 180;
	return {
		x: Math.floor(((lon + 180) / 360) * n),
		y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
	};
}

export type Merkmal = { props: Record<string, unknown>; geo: GeoJSON.Geometry };

/**
 * Alle Merkmale eines Themas um den Rahmen, je Kachel, mit Längen und Breiten.
 * `melde` bekommt den Fortschritt als „k von n Kacheln“.
 */
export async function holeOverture(thema: 'buildings' | 'places', roh: Ecken,
	melde: (k: number, n: number, bytes: number) => void = () => {}, stop?: AbortSignal) {
	const dLat = RAND_M / 111320;
	const dLon = RAND_M / (111320 * Math.cos(((roh.nord + roh.sued) / 2) * Math.PI / 180));
	const a = kachelVon(roh.west - dLon, roh.nord + dLat), b = kachelVon(roh.ost + dLon, roh.sued - dLat);
	const rel = await aktuellerRelease(stop);
	const p = new PMTiles(new Abbrechbar(KACHELN(rel, thema), stop));
	const liste: { x: number; y: number }[] = [];
	for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) liste.push({ x, y });
	let fertig = 0, bytes = 0;
	melde(0, liste.length, 0);
	const je = await Promise.all(liste.map(async ({ x, y }) => {
		const k = await p.getZxy(Z, x, y);
		fertig++; bytes += k?.data.byteLength ?? 0;
		melde(fertig, liste.length, bytes);
		if (!k) return [];
		const vt = new VectorTile(new Pbf(new Uint8Array(k.data)));
		const aus: Merkmal[] = [];
		for (const l of Object.values(vt.layers))
			for (let i = 0; i < l.length; i++) {
				const f = l.feature(i);
				aus.push({ props: f.properties, geo: f.toGeoJSON(x, y, Z).geometry });
			}
		return aus;
	}));
	if (stop?.aborted) throw new DOMException('abgebrochen', 'AbortError');
	return { release: rel, merkmale: je.flat(), kacheln: liste.length, bytes };
}

const innen = (p: [number, number], ring: [number, number][]) => {
	let c = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i], [xj, yj] = ring[j];
		if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
};

function schwerpunkt(ring: [number, number][]): [number, number] {
	let sx = 0, sy = 0;
	for (const [x, y] of ring) { sx += x; sy += y; }
	return [sx / ring.length, sy / ring.length];
}

/**
 * Overture-Gebäude, die Nolli fehlen, als Objekte im Ortsgitter.
 *
 * Ein Haus über einer Kachelgrenze kommt in beiden Kacheln vor, jeweils mit
 * Puffer abgeschnitten. Je `id` bleibt die größere Fassung — bei Häusern,
 * die kleiner sind als der Puffer, ist das das ganze Haus.
 */
export function gebaeudeErgaenzen(merkmale: Merkmal[], gitter: Gitter, osm: Objekt[]) {
	const zu = (r: number[][]): [number, number][] =>
		r.map(([lon, lat]) => { const q = nachGitter(lon, lat, gitter); return [q.x, q.y]; });
	const besteJeId = new Map<string, { f: Merkmal; ringe: [number, number][][]; loecher: [number, number][][]; flaeche: number }>();
	for (const f of merkmale) {
		const q = f.props;
		if (q['@geometry_source'] === 'OpenStreetMap' || q.is_underground === true || q.is_underground === 'true') continue;
		const polys = f.geo.type === 'Polygon' ? [f.geo.coordinates]
			: f.geo.type === 'MultiPolygon' ? f.geo.coordinates : [];
		if (!polys.length) continue;
		const ringe = polys.map((p) => zu(p[0]));
		const loecher = polys.flatMap((p) => p.slice(1).map(zu));
		const flaeche = ringe.reduce((s, r) => s + Math.abs(ringflaeche(r)), 0);
		const id = String(q.id ?? '');
		const alt = besteJeId.get(id);
		if (!alt || flaeche > alt.flaeche) besteJeId.set(id, { f, ringe, loecher, flaeche });
	}

	// OSM-Gebäude mit ihrer Hülle, damit der Punkttest nicht jedes Haus prüft.
	// Baustellen zählen mit: Wo OSM eine führt, gilt sie, auch wenn das
	// Luftbild dort schon ein Haus sieht (HafenCity, 28.10.2026).
	const haeuser = osm.filter((o) => (o.ebene === 'gebaeude' || o.ebene === 'erhalt' || o.ebene === 'bau') && !istTeil(o))
		.flatMap((o) => o.ringe.map((r) => {
			let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
			for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
			return { r, x0, y0, x1, y1 };
		}));
	const besetzt = (p: [number, number]) =>
		haeuser.some((h) => p[0] >= h.x0 && p[0] <= h.x1 && p[1] >= h.y0 && p[1] <= h.y1 && innen(p, h.r));

	const aus: Objekt[] = [];
	const quellen = new Map<string, number>();
	for (const [id, { f, ringe, loecher }] of besteJeId) {
		if (besetzt(schwerpunkt(ringe[0]))) continue;
		const q = f.props;
		const h = Number(q.height);
		const quelle = String(q['@geometry_source'] ?? 'Overture');
		const klasse = typeof q.class === 'string' ? q.class : '';
		quellen.set(quelle, (quellen.get(quelle) ?? 0) + 1);
		aus.push({
			id: `ov${id}`, ebene: 'gebaeude', art: 'flaeche', ringe, loecher: loecher.length ? loecher : undefined,
			tiefe: 0, teil: false,
			hoeheM: Number.isFinite(h) && h > 0 ? Math.round(h * 10) / 10 : undefined,
			// Gemessen ist eine Höhe nur, wenn sie aus OSM kommt. Die von
			// Microsoft ist aus Luftbildern geschätzt.
			hoeheGeschaetzt: q['@height_source'] !== 'OpenStreetMap',
			name: typeof q['@name'] === 'string' ? q['@name'] : undefined,
			nutzung: klasse || 'yes',
			klasse: KLASSEN[klasse] ?? 'unbestimmt',
			herkunft: 'overture', quelleGeometrie: quelle,
			zustand: 'normal'
		});
	}
	return { objekte: aus, quellen: Object.fromEntries(quellen) };
}
