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
import type { Objekt } from '../osm';
import type { Rahmen } from '../geo/rahmen';
import { type Gelaende, tiefsteUnter, feldImRahmen, hoeheBei } from '../geo/gelaende';
import { amRahmen, drin } from '../schneiden';
import { MATERIALIEN, materialFuer } from '../material';
import { planZuege } from './dxf';
import { STIFTE } from '../stifte';
import { dxfEbene, objName, WERTE } from '../vertrag';
import { BAUM } from '$lib/analysedaten';
import { ECKEN, FLAECHEN } from './baeume';

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
const flaeche = (r: P[]) => {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
	return s / 2;
};
const farbe = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
};

export type Rhino3dmEingabe = {
	objekte: Objekt[];
	r: Rahmen;
	gelaende: Gelaende | null;
	baeume: { x: number; y: number; krone: number; gemessen: boolean }[];
	/** Kopfdaten für die Datei: Vertrag in Kurzform, Herkunft, Georeferenz. */
	kopf: Record<string, unknown>;
};

export async function als3dm(e: Rhino3dmEingabe): Promise<Uint8Array> {
	const rh = await rhinoLaden();
	const { objekte, r, gelaende, baeume } = e;
	const f = new rh.File3dm();
	f.settings().modelUnitSystem = rh.UnitSystem.Meters;
	f.applicationName = 'Nolli';
	f.applicationUrl = 'https://zinssmeister.info/app/nolli/';
	f.strings().set('ucx', JSON.stringify(e.kopf));

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
	const BAU = dxfEbene('N_GEBAEUDE');
	const DRAUSSEN = 'N_OUTSIDE';

	// ---- Körper -------------------------------------------------------------
	const ring = (roh: P[]) => {
		const p = roh.map(([x, y]) => [x - r.x0, y - r.y0] as P);
		if (p.length > 1) {
			const a = p[0], b = p[p.length - 1];
			if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.pop();
		}
		return p;
	};
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
	const koerperSchreiben = (o: Objekt, aussenteile: P[][], loecherAlle: P[][], fuss: number, h: number,
		ebeneIndex: number, name: string) => {
		for (const aussen of aussenteile) {
			const loecher = loecherAlle.filter((l) => drin(l[0], aussen));
			const a = new rh.ObjectAttributes();
			a.layerIndex = ebeneIndex;
			a.name = name;
			a.setUserString('body_id', o.id);
			if (!o.herkunft) a.setUserString('osm_id', o.id);
			if (o.herkunft) a.setUserString('origin', o.herkunft);
			a.setUserString('height_m', h.toFixed(2));
			a.setUserString('height_source', !o.hoeheGeschaetzt ? 'measured' : o.geschosse ? 'storeys'
				: o.herkunft && o.hoeheM !== undefined ? 'imagery' : 'assumed');
			if (o.geschosse) a.setUserString('storeys', String(o.geschosse));
			if (o.klasse) a.setUserString('use_class', WERTE.klasse[o.klasse] ?? o.klasse);
			a.setUserString('material', materialFuer(o));
			if (gelaende) a.setUserString('base_m', fuss.toFixed(2));
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
	for (const o of objekte) {
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') continue;
		if (o.zustand === 'gestrichen' || !o.ringe.length) continue;
		const h = o.hoeheM ?? 8;
		const fuss = gelaende ? tiefsteUnter(gelaende, o.ringe) : 0;
		const zer = o.ringe.map((x) => amRahmen(x, r.x0, r.y0, r.x1, r.y1));
		const lzer = (o.loecher ?? []).map((x) => amRahmen(x, r.x0, r.y0, r.x1, r.y1));
		const ccw = (a: P[]) => (flaeche(a) < 0 ? a.slice().reverse() : a);
		const cw = (a: P[]) => (flaeche(a) > 0 ? a.slice().reverse() : a);
		const innen = zer.filter((t) => t.innen.length >= 3).map((t) => ccw(ring(t.innen))).filter((a) => a.length >= 3);
		const linnen = lzer.filter((t) => t.innen.length >= 3).map((t) => cw(ring(t.innen))).filter((a) => a.length >= 3);
		const mat = materialFuer(o);
		const klasseEbene = o.herkunft === 'overture'
			? ebene('overture', { eltern: BAU, farbe: '#D2D2D2', material: mat })
			: ebene(mat, { eltern: BAU, farbe: MATERIALIEN.find((m) => m.id === mat)?.color, material: mat });
		const marke = o.hoeheGeschaetzt ? '_hoehe_geschaetzt' : '';
		koerperSchreiben(o, innen, linnen, fuss, h, klasseEbene, objName(`${o.ebene}_${o.id}${marke}`));
		const draussen = zer.flatMap((t) => t.aussen).map((a) => ccw(ring(a))).filter((a) => a.length >= 3);
		if (draussen.length) {
			const dl = lzer.flatMap((t) => t.aussen).map((a) => cw(ring(a))).filter((a) => a.length >= 3);
			koerperSchreiben(o, draussen, dl, fuss, h, ebene(DRAUSSEN, { farbe: '#9E9E9E', sichtbar: false }),
				objName(`${o.ebene}_${o.id}${marke}_ausserhalb`));
		}
	}

	// ---- Gelände ------------------------------------------------------------
	if (gelaende) {
		const g = feldImRahmen(gelaende, r);
		const m = new rh.Mesh();
		for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) m.vertices().add(i * g.dx, j * g.dy, g.z[j * g.nx + i]);
		const ecke = (i: number, j: number) => j * g.nx + i;
		for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
			m.faces().addTriFace(ecke(i, j), ecke(i + 1, j), ecke(i + 1, j + 1));
			m.faces().addTriFace(ecke(i, j), ecke(i + 1, j + 1), ecke(i, j + 1));
		}
		m.normals().computeNormals();
		const a = new rh.ObjectAttributes();
		a.layerIndex = ebene('terrain', { farbe: '#F4F4F4', material: 'ground' });
		a.name = 'terrain';
		f.objects().addMesh(m, a);
	}

	// ---- Bäume: Kronen als ein Netz, wie `trees` im OBJ ------------------
	const drinnen = baeume.filter((b) => b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1);
	if (drinnen.length) {
		const m = new rh.Mesh();
		for (const b of drinnen) {
			const nenn = Math.max(0.5, b.krone / 2), rad = nenn * BAUM.silhouetteFaktor;
			const mz = (gelaende ? hoeheBei(gelaende, b.x, b.y) : 0) + BAUM.stammhoeheM + nenn;
			const basis = m.vertices().count;
			for (const [ex, ey, ez] of ECKEN) m.vertices().add(b.x - r.x0 + ex * rad, b.y - r.y0 - ez * rad, mz + ey * rad);
			for (const [p, q, s] of FLAECHEN) m.faces().addTriFace(basis + p - 1, basis + q - 1, basis + s - 1);
		}
		m.normals().computeNormals();
		const a = new rh.ObjectAttributes();
		a.layerIndex = ebene('trees', { farbe: '#9A9A9A', material: 'tree' });
		a.name = 'trees';
		f.objects().addMesh(m, a);
	}

	// ---- Kurven der Zeichnung ---------------------------------------------
	const { zuege, texte } = planZuege(objekte, r, gelaende, !!gelaende);
	const gebaeudeEbenen = new Set(['N_GEBAEUDE', 'N_ERHALT', 'N_OVERTURE'].map(dxfEbene));
	const stiftFarbe = new Map(STIFTE.map((s) => [dxfEbene(s.dxf), s.hell]));
	for (const zg of zuege) {
		// Die Gebäudeumrisse stehen schon als Körper da.
		if (gebaeudeEbenen.has(zg.ebene) || zg.punkte.length < 2) continue;
		const pk = zg.zu ? [...zg.punkte, zg.punkte[0]] : zg.punkte;
		const a = new rh.ObjectAttributes();
		a.layerIndex = ebene(zg.ebene, { farbe: stiftFarbe.get(zg.ebene) ?? '#8C8C8C' });
		f.objects().addCurve(new rh.PolylineCurve(pk), a);
	}
	if (texte.length) {
		const li = ebene(dxfEbene('N_BESCHRIFTUNG'), { farbe: '#6A6A6A' });
		for (const t of texte) {
			const a = new rh.ObjectAttributes();
			a.layerIndex = li;
			f.objects().addTextDot(t.text, [t.x, t.y, t.z], a);
		}
	}

	const bytes: Uint8Array = f.toByteArray();
	f.delete?.();
	return bytes;
}
