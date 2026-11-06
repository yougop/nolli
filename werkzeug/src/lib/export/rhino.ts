/**
 * Das Modell als Rhino-Datei, `model.3dm`.
 *
 * Volker, 04.11.2026: OBJ kennt keine Ebenen, keine Kurven und keine
 * Attribute; für den Weg nach Rhino und zurück reicht das nicht. Diese Datei
 * bringt alles mit, was der Import in Rhino sonst von Hand bräuchte:
 *
 * - Gebäude als echte Rhino-Extrusionen, Grundriss mit Höhe, auf ihrer
 *   Fußhöhe. Geschlossene Körper, die sich in Rhino weiterbearbeiten lassen.
 *   Mit Innenhof als Netz: Eine Extrusion nimmt hier kein Loch an.
 * - Ebenen nach Klasse (`N_BUILDINGS::residential` …), mit Farbe und
 *   Material aus dem Materialschema; Erhalt, Overture und die Teile vor der
 *   Rahmenkante (ausgeblendet) eigens.
 * - Die Kurven der Zeichnung auf ihren DXF-Ebenen, am Rahmen geschnitten und
 *   mit Gelände aufs Netz gelegt — dieselben Züge wie `drawing_terrain.dxf`.
 * - Mit Gelände die Fußlinie jedes Hauses: wo die Wand das Geländenetz
 *   schneidet, als Kurve auf dem Netz (Ebene `N_GEBAEUDE::foot_lines`).
 *   Jonathan, 05.11.2026: Make2D rechnet keine Schnitte zwischen Netzen,
 *   am Fuß der Häuser fehlte im Plan die Kante. Das Gelände bleibt ganz —
 *   ausgeschnittene Grundrisse hinterließen beim Abriss ein Loch.
 * - Je Körper UserText: `body_id`, `osm_id`, Höhe und ihre Herkunft,
 *   Nutzung, Material. Damit findet ein Rückweg jeden Körper wieder.
 *
 * Maßgeblich bleibt `data/*.json`; diese Datei ist daraus abgeleitet.
 *
 * rhino3dm (openNURBS als WebAssembly, MIT) wird erst beim ersten Export
 * geladen, rund 2,7 MB. Wer Nolli nur öffnet, lädt es nie.
 */
import wasmUrl from 'rhino3dm/rhino3dm.wasm?url';
import earcut from 'earcut';
import { unterkante, umrisseMitTeilen, type Objekt } from '../osm';
import { hatDach, dachKoerper, DACH_NAME } from '../dach';
import type { Rahmen } from '../geo/rahmen';
import { type Gelaende, tiefsteUnter, feldImRahmen, hoeheBei, aufsNetz } from '../geo/gelaende';
import { amRahmen, drin, gegenUhr, mitUhr, verschoben } from '../schneiden';
import { MATERIALIEN, materialFuer } from '../material';
import { planZuege } from './dxf';
import { dxfEbene, objName, WERTE } from '../vertrag';
import type { Baum } from '$lib/analysedaten';
import { ECKEN, FLAECHEN, STAMM_ECKEN, STAMM_FLAECHEN, baumForm } from './baeume';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rh = any;
let geladen: Promise<Rh> | null = null;
/** rhino3dm einmal laden, beim ersten Bedarf. */
export function rhinoLaden(): Promise<Rh> {
	return (geladen ??= import('rhino3dm').then((m) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const start = ((m as any).default ?? m) as (o: object) => Promise<Rh>;
		return start({ locateFile: () => wasmUrl });
	}));
}

type P = [number, number];
const farbe = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
};

export type Rhino3dmEingabe = {
	objekte: Objekt[];
	r: Rahmen;
	gelaende: Gelaende | null;
	baeume: Baum[];
	/** Kopfdaten für die Datei: Vertrag in Kurzform, Herkunft, Georeferenz. */
	kopf: Record<string, unknown>;
	/** Das Bodenbild als PNG, wird in die Datei eingebettet und aufs Gelände gelegt. */
	textur?: Uint8Array;
	/** Kantenfarbe aus „Gebäude": die Farbe der Gebäudeebenen, mit der Rhino Kanten zeichnet. */
	kantenHell?: boolean;
	/** Lage der linken unteren Rahmenecke, für den Erdanker. */
	ecke?: { lat: number; lon: number };
};

export async function als3dm(e: Rhino3dmEingabe): Promise<Uint8Array> {
	const rh = await rhinoLaden();
	const { objekte, r, gelaende, baeume } = e;
	const f = new rh.File3dm();
	f.settings().modelUnitSystem = rh.UnitSystem.Meters;
	f.applicationName = 'Nolli';
	f.applicationUrl = 'https://zinssmeister.info/app/nolli/';
	f.strings().set('ucx', JSON.stringify(e.kopf));
	/**
	 * Der Erdanker: Der Ursprung des Modells ist die linke untere Rahmenecke.
	 * Damit kennt Rhino die Lage, etwa für die Sonne. Gitternord ist Nord.
	 */
	if (e.ecke) {
		const ea = f.settings().earthAnchorPoint;
		ea.earthBasepointLatitude = e.ecke.lat;
		ea.earthBasepointLongitude = e.ecke.lon;
		ea.modelBasePoint = [0, 0, 0];
		ea.modelNorth = [0, 1, 0];
		ea.modelEast = [1, 0, 0];
		ea.name = 'UCX frame origin';
		f.settings().earthAnchorPoint = ea;
	}

	// ---- Materialien und Ebenen ------------------------------------------
	const stoff = new Map<string, number>();
	for (const m of MATERIALIEN) {
		const mm = new rh.Material();
		mm.name = m.id;
		mm.diffuseColor = farbe(m.color);
		stoff.set(m.id, f.materials().add(mm));
	}
	const ebenen = new Map<string, number>();
	const ebene = (name: string, opt: { eltern?: string; farbe?: string; material?: string; sichtbar?: boolean } = {}) => {
		const schluessel = opt.eltern ? `${opt.eltern}::${name}` : name;
		const da = ebenen.get(schluessel);
		if (da !== undefined) return da;
		const l = new rh.Layer();
		l.name = name;
		if (opt.eltern) l.parentLayerId = f.layers().get(ebene(opt.eltern)).id;
		if (opt.farbe) l.color = farbe(opt.farbe);
		if (opt.material && stoff.has(opt.material)) l.renderMaterialIndex = stoff.get(opt.material);
		if (opt.sichtbar === false) l.visible = false;
		const i = f.layers().add(l);
		ebenen.set(schluessel, i);
		return i;
	};
	/**
	 * Ordnung der Ebenen (Volker, 04.11.2026): ganz oben `Default`, aktiv,
	 * damit Gezeichnetes nicht auf einer Nolli-Ebene landet; dann die
	 * Gebäude, die Landschaft (Gelände, Bäume, Höhenlinien), die übrigen
	 * OSM-Ebenen, der Rahmen. Dunkle Farben, weil Rhino Kurven und Kanten
	 * in der Ebenenfarbe zeichnet und helle Töne auf dem Modell verschwinden.
	 */
	ebene('Default');
	const BAU = dxfEbene('N_GEBAEUDE');
	ebene(BAU, { farbe: '#2B2B29' });
	const LAND = 'N_LANDSCAPE', OSM = 'N_OSM';
	ebene(LAND, { farbe: '#4A4A48' });
	ebene(OSM, { farbe: '#4A4A48' });
	/** Wohin eine Kurvenebene gehört und in welcher Farbe. */
	const KURVEN: Record<string, { eltern?: string; farbe: string }> = {
		[dxfEbene('N_STRASSE')]: { eltern: OSM, farbe: '#5A5A58' },
		[dxfEbene('N_WASSER')]: { eltern: OSM, farbe: '#3F5866' },
		[dxfEbene('N_GRUEN')]: { eltern: OSM, farbe: '#55654A' },
		[dxfEbene('N_BAHN')]: { eltern: OSM, farbe: '#333331' },
		[dxfEbene('N_BAU')]: { eltern: OSM, farbe: '#6B5F4E' },
		[dxfEbene('N_BESCHRIFTUNG')]: { eltern: OSM, farbe: '#4A4A48' },
		[dxfEbene('N_HOEHENLINIE')]: { eltern: LAND, farbe: '#6E6E6B' },
		[dxfEbene('N_HOEHENLINIE_HAUPT')]: { eltern: LAND, farbe: '#4A4A48' },
		[dxfEbene('N_RAHMEN')]: { farbe: '#5D7A16' },
		[dxfEbene('N_PLANGEBIET')]: { farbe: '#5D7A16' }
	};
	/**
	 * Die Gebäudeebenen tragen die Kantenfarbe aus „Gebäude", nicht die
	 * Flächenfarbe: Rhino zeichnet Kanten und Drahtmodell in der Ebenenfarbe,
	 * die Fläche zeigt das Material (Volker, 04.11.2026).
	 */
	const KANTE = e.kantenHell ? '#F4F4F2' : '#2B2B29';
	const DRAUSSEN = 'outside';
	/** Das Geländenetz, wie es unten geschrieben wird; die Fußlinien liegen genau darauf. */
	const feld = gelaende ? feldImRahmen(gelaende, r) : null;
	/** Fußlinie eines Rings im Rahmen (lokal, geschlossen), aufs Netz gelegt. */
	const fussLinie = (o: Objekt, ringLokal: P[]) => {
		if (!feld || ringLokal.length < 3) return;
		const pz = aufsNetz(feld, [...ringLokal, ringLokal[0]]);
		const a = new rh.ObjectAttributes();
		a.layerIndex = ebene('foot_lines', { eltern: BAU, farbe: KANTE });
		a.name = objName(`foot_${o.id}`);
		a.setUserString('body_id', o.id);
		f.objects().addCurve(new rh.PolylineCurve(pz), a);
	};

	// ---- Körper -------------------------------------------------------------
	const ring = (roh: P[]) => verschoben(roh, r.x0, r.y0);
	/** Ein Teil mit Höfen als Netz: Wände und Dach, wie im OBJ. */
	const netzMitHoefen = (aussen: P[], loecher: P[][], fuss: number, h: number) => {
		const m = new rh.Mesh();
		const v = (x: number, y: number, z: number) => m.vertices().add(x, y, z);
		const wand = (a: P, b: P) => {
			const i = v(a[0], a[1], fuss), j = v(b[0], b[1], fuss), k = v(b[0], b[1], fuss + h), l = v(a[0], a[1], fuss + h);
			m.faces().addQuadFace(i, j, k, l);
		};
		for (const k of [aussen, ...loecher]) for (let i = 0; i < k.length; i++) wand(k[i], k[(i + 1) % k.length]);
		const flach: number[] = [], grenzen: number[] = [];
		for (const [x, y] of aussen) flach.push(x, y);
		for (const l of loecher) { grenzen.push(flach.length / 2); for (const [x, y] of l) flach.push(x, y); }
		const alle = [aussen, ...loecher].flat();
		const basis = m.vertices().count;
		for (const [x, y] of alle) v(x, y, fuss + h);
		const idx = earcut(flach, grenzen);
		for (let k = 0; k < idx.length; k += 3) m.faces().addTriFace(basis + idx[k], basis + idx[k + 1], basis + idx[k + 2]);
		m.normals().computeNormals();
		m.compact();
		return m;
	};
	/** UserText je Körper, wie die Felder in `data/bodies.json`. `boden`: Gelände unter dem Körper. */
	const merkmale = (o: Objekt, ebeneIndex: number, name: string, boden: number) => {
		const a = new rh.ObjectAttributes();
		a.layerIndex = ebeneIndex;
		a.name = name;
		a.setUserString('body_id', o.id);
		if (!o.herkunft) a.setUserString('osm_id', o.id);
		if (o.herkunft) a.setUserString('origin', o.herkunft);
		// Die Oberkante über dem Boden, wie `height_m` in den Daten.
		a.setUserString('height_m', (o.hoeheM ?? 8).toFixed(2));
		a.setUserString('height_source', !o.hoeheGeschaetzt ? 'measured' : o.geschosse ? 'storeys'
			: o.herkunft && o.hoeheM !== undefined ? 'imagery' : 'assumed');
		if (o.geschosse) a.setUserString('storeys', String(o.geschosse));
		if (o.klasse) a.setUserString('use_class', WERTE.klasse[o.klasse] ?? o.klasse);
		a.setUserString('material', materialFuer(o));
		if (gelaende) a.setUserString('base_m', boden.toFixed(2));
		if (unterkante(o) > 0) a.setUserString('min_height_m', unterkante(o).toFixed(2));
		if (o.dachform) {
			a.setUserString('roof_shape', DACH_NAME[o.dachform]);
			a.setUserString('roof_height_m', (o.dachHoeheM ?? 0).toFixed(2));
		}
		return a;
	};
	/** Ein Körper mit Dach als ein Netz aus den Dreiecken von `dach.ts`. */
	const dachNetz = (dreiecke: number[]) => {
		const m = new rh.Mesh();
		for (let k = 0; k < dreiecke.length; k += 9) {
			const i = m.vertices().count;
			for (let j = 0; j < 9; j += 3) m.vertices().add(dreiecke[k + j] - r.x0, dreiecke[k + j + 1] - r.y0, dreiecke[k + j + 2]);
			m.faces().addTriFace(i, i + 1, i + 2);
		}
		m.normals().computeNormals();
		m.compact();
		return m;
	};
	const koerperSchreiben = (o: Objekt, aussenteile: P[][], loecherAlle: P[][], fuss: number, h: number,
		ebeneIndex: number, name: string) => {
		for (const aussen of aussenteile) {
			const loecher = loecherAlle.filter((l) => drin(l[0], aussen));
			const a = merkmale(o, ebeneIndex, name, fuss - unterkante(o));
			if (loecher.length) {
				f.objects().addMesh(netzMitHoefen(aussen, loecher, fuss, h), a);
			} else {
				const kurve = new rh.PolylineCurve([...aussen, aussen[0]].map(([x, y]) => [x, y, fuss]));
				const ex = rh.Extrusion.create(kurve, h, true);
				if (ex) f.objects().addExtrusion(ex, a);
				else f.objects().addMesh(netzMitHoefen(aussen, [], fuss, h), a);
			}
		}
	};
	// Umrisse, die ihre Teile ersetzen: in Rhino auf eine eigene, ausgeblendete
	// Ebene, statt sie wegzulassen. Die Daten sind maßgeblich; wer den Umriss
	// als Hülle braucht, schaltet sie ein.
	const ersetzt = umrisseMitTeilen(objekte);
	for (const o of objekte) {
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') continue;
		if (o.zustand === 'gestrichen' || !o.ringe.length) continue;
		// Schwebende Teile beginnen an ihrer Unterkante; die Extrusion ist geschlossen.
		const u = unterkante(o);
		const h = (o.hoeheM ?? 8) - u;
		const fuss = (gelaende ? tiefsteUnter(gelaende, o.ringe) : 0) + u;
		const zer = o.ringe.map((x) => amRahmen(x, r.x0, r.y0, r.x1, r.y1));
		const lzer = (o.loecher ?? []).map((x) => amRahmen(x, r.x0, r.y0, r.x1, r.y1));
		const ccw = gegenUhr, cw = mitUhr;
		const innen = zer.filter((t) => t.innen.length >= 3).map((t) => ccw(ring(t.innen))).filter((a) => a.length >= 3);
		const linnen = lzer.filter((t) => t.innen.length >= 3).map((t) => cw(ring(t.innen))).filter((a) => a.length >= 3);
		const mat = materialFuer(o);
		// Nur was auf dem Boden steht; ein Umriss, den seine Teile ersetzen, nicht.
		if (feld && u === 0 && !ersetzt.has(o.id)) for (const k of [...innen, ...linnen]) fussLinie(o, k);
		const klasseEbene = ersetzt.has(o.id)
			? ebene('outlines_with_parts', { eltern: BAU, farbe: '#6E6E6B', sichtbar: false })
			: o.herkunft === 'overture'
			? ebene('overture', { eltern: BAU, farbe: KANTE, material: mat })
			: ebene(mat, { eltern: BAU, farbe: KANTE, material: mat });
		const marke = o.hoeheGeschaetzt ? '_hoehe_geschaetzt' : '';
		// Mit Dach als Netz: Eine Extrusion kann keine geneigten Flächen.
		if (hatDach(o)) {
			const boden = fuss - u, ganz = o.ringe.length === 1 && zer.every((t) => !t.aussen.length);
			const rein = zer.filter((t) => t.innen.length >= 3).map((t) => t.innen);
			if (rein.length) f.objects().addMesh(dachNetz(dachKoerper(o, rein, boden, u, ganz).dreiecke),
				merkmale(o, klasseEbene, objName(`${o.ebene}_${o.id}${marke}`), boden));
			const raus = zer.flatMap((t) => t.aussen).filter((a) => a.length >= 3);
			if (raus.length) f.objects().addMesh(dachNetz(dachKoerper(o, raus, boden, u, false).dreiecke),
				merkmale(o, ebene(DRAUSSEN, { eltern: BAU, farbe: '#6E6E6B', sichtbar: false }), objName(`${o.ebene}_${o.id}${marke}_ausserhalb`), boden));
			continue;
		}
		koerperSchreiben(o, innen, linnen, fuss, h, klasseEbene, objName(`${o.ebene}_${o.id}${marke}`));
		const draussen = zer.flatMap((t) => t.aussen).map((a) => ccw(ring(a))).filter((a) => a.length >= 3);
		if (draussen.length) {
			const dl = lzer.flatMap((t) => t.aussen).map((a) => cw(ring(a))).filter((a) => a.length >= 3);
			koerperSchreiben(o, draussen, dl, fuss, h, ebene(DRAUSSEN, { eltern: BAU, farbe: '#6E6E6B', sichtbar: false }),
				objName(`${o.ebene}_${o.id}${marke}_ausserhalb`));
		}
	}

	// ---- Gelände, oder eine ebene Platte, mit dem Bodenbild darauf ----------
	/**
	 * Das Bodenbild steckt in der Datei selbst (eingebettet als
	 * `model_texture.png`), damit die Karte mitkommt, auch wenn die 3DM allein
	 * weitergegeben wird. Ohne Gelände trägt eine ebene Platte auf null es,
	 * wie im OBJ.
	 */
	let bodenStoff: number | undefined;
	if (e.textur) {
		const ef = rh.EmbeddedFile.fromByteArray(e.textur);
		ef.fileName = 'model_texture.png';
		f.embeddedFiles().add(ef);
		const mm = new rh.Material();
		mm.name = 'ground_map';
		mm.diffuseColor = farbe('#FFFFFF');
		mm.setBitmapTextureFilename('model_texture.png');
		f.materials().add(mm);
		bodenStoff = f.materials().count - 1;
	}
	{
		const g = feld ??
			{ nx: 2, ny: 2, dx: r.x1 - r.x0, dy: r.y1 - r.y0, z: new Float32Array(4) };
		if (gelaende || e.textur) {
			const m = new rh.Mesh();
			for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
				m.vertices().add(i * g.dx, j * g.dy, g.z[j * g.nx + i]);
				m.textureCoordinates().add(i / (g.nx - 1), j / (g.ny - 1));
			}
			const ecke = (i: number, j: number) => j * g.nx + i;
			for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
				m.faces().addTriFace(ecke(i, j), ecke(i + 1, j), ecke(i + 1, j + 1));
				m.faces().addTriFace(ecke(i, j), ecke(i + 1, j + 1), ecke(i, j + 1));
			}
			m.normals().computeNormals();
			const a = new rh.ObjectAttributes();
			a.layerIndex = ebene('terrain', { eltern: LAND, farbe: '#5A5A58', material: 'ground' });
			a.name = 'terrain';
			if (bodenStoff !== undefined) {
				a.materialSource = rh.ObjectMaterialSource.MaterialFromObject;
				a.materialIndex = bodenStoff;
			}
			f.objects().addMesh(m, a);
		}
	}

	// ---- Bäume: Kronen und Stämme als je ein Netz, wie `trees` und `trunks` im OBJ
	const drinnen = baeume.filter((b) => b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1);
	if (drinnen.length) {
		const kronen = new rh.Mesh(), staemme = new rh.Mesh();
		for (const b of drinnen) {
			const form = baumForm(b), fuss = gelaende ? hoeheBei(gelaende, b.x, b.y) : 0;
			const mx = b.x - r.x0, my = b.y - r.y0, mz = fuss + form.mitte;
			const c = Math.cos(form.dreh), d = Math.sin(form.dreh);
			let basis = kronen.vertices().count;
			for (const [ex, ey, ez] of ECKEN) kronen.vertices().add(mx + (ex * c + ez * d) * form.rx, my + (ex * d - ez * c) * form.rx, mz + ey * form.rz);
			for (const [p, q, s] of FLAECHEN) kronen.faces().addTriFace(basis + p - 1, basis + q - 1, basis + s - 1);
			basis = staemme.vertices().count;
			const z0 = fuss - 0.5, h = form.stammH + 0.5;
			for (const [ex, ey, ez] of STAMM_ECKEN) staemme.vertices().add(mx + (ex * c - ey * d) * form.stammR, my + (ex * d + ey * c) * form.stammR, z0 + ez * h);
			for (const [p, q, s] of STAMM_FLAECHEN) staemme.faces().addTriFace(basis + p - 1, basis + q - 1, basis + s - 1);
		}
		for (const [m, name, farbe] of [[kronen, 'trees', '#3E4A3A'], [staemme, 'trunks', '#6B5B4B']] as const) {
			m.normals().computeNormals();
			const a = new rh.ObjectAttributes();
			a.layerIndex = ebene(name, { eltern: LAND, farbe, material: name === 'trees' ? 'tree' : 'trunk' });
			a.name = name;
			f.objects().addMesh(m, a);
		}
	}

	// ---- Kurven der Zeichnung ---------------------------------------------
	const { zuege, texte } = planZuege(objekte, r, gelaende, !!gelaende);
	const gebaeudeEbenen = new Set(['N_GEBAEUDE', 'N_ERHALT', 'N_OVERTURE'].map(dxfEbene));

	for (const zg of zuege) {
		// Die Gebäudeumrisse stehen schon als Körper da.
		if (gebaeudeEbenen.has(zg.ebene) || zg.punkte.length < 2) continue;
		const pk = zg.zu ? [...zg.punkte, zg.punkte[0]] : zg.punkte;
		const a = new rh.ObjectAttributes();
		const k = KURVEN[zg.ebene] ?? { eltern: OSM, farbe: '#5A5A58' };
		a.layerIndex = ebene(zg.ebene, k);
		f.objects().addCurve(new rh.PolylineCurve(pk), a);
	}
	if (texte.length) {
		// Ausgeblendet und klein: Im 3D-Raum stehen Hunderte Namen sonst
		// übereinander und verdecken das Modell (Volker, 04.11.2026).
		const li = ebene(dxfEbene('N_BESCHRIFTUNG'), { ...KURVEN[dxfEbene('N_BESCHRIFTUNG')], sichtbar: false });
		for (const t of texte) {
			const a = new rh.ObjectAttributes();
			a.layerIndex = li;
			const dot = new rh.TextDot(t.text, [t.x, t.y, t.z]);
			dot.fontHeight = 9;
			f.objects().add(dot, a);
		}
	}

	const bytes: Uint8Array = f.toByteArray();
	f.delete?.();
	return bytes;
}
