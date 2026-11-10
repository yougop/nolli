/**
 * Entwürfe aus DXF und 3DM lesen (Volker, 10.11.2026).
 *
 * Geschlossene Umrisse werden normale Neubauten, die sich weiter bearbeiten
 * lassen. Netze, Flächenkörper und Extrusionen behalten dazu ihre 3D-Form
 * (`fest.ts`); ihr Umriss ist der Schatten ihrer nach oben zeigenden Flächen.
 *
 * Die Lage wird erkannt, wenn die Datei sie hergibt: ein Nolli-Export liegt in
 * Rahmenkoordinaten, eine georeferenzierte Datei im Ortsgitter oder in UTM.
 * Sonst landet alles in der Blattmitte, gewählt und bereit zum Schieben.
 */
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Ring } from 'polygon-clipping';
import { gegenUhr } from './schneiden';
import { ausMulti, neubau, ringFlaeche, type Entwurfswahl, type Gestalt, type Neubau, type Punkt } from './entwurf';
import { nachGitter, nachGrad, ortsgitter, utmGitter, zoneFuer } from './geo/utm';

/** Ein Körper aus der Datei: ein Umriss, wahlweise mit Höhe, oder Dreiecke. */
export type Roh = { ring?: Punkt[]; hoehe?: number; dreiecke?: number[] };
export type Gelesen = {
	koerper: Roh[];
	/** Meter je Zeicheneinheit; null, wenn die Datei es nicht sagt. */
	einheit: number | null;
	/** Die Datei ist ein Nolli-Export: Rahmenkoordinaten, seine Ebenen bleiben draußen. */
	nolli: boolean;
	ohneNetz: number;
	uebersprungen: number;
	/** Was Nolli selbst geschrieben hat und deshalb draußen bleibt. */
	aufNolli: number;
};
export type Lage = 'rahmen' | 'gitter' | 'utm' | 'mitte';
export type Eingeordnet = { koerper: Roh[]; lage: Lage; millimeterAngenommen: boolean };

/** Gelände und Bäume aus Nollis eigenem 3DM; sie tragen keine `body_id`. */
const NOLLI_NAME = /^(terrain|trees|trunks)/;

const INSUNITS: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };

/** DXF: LWPOLYLINE, POLYLINE samt Polyface und 3DFACE im Abschnitt ENTITIES. */
export function lesenDxf(text: string): Gelesen {
	const z = text.split(/\r?\n/);
	const paare: [number, string][] = [];
	for (let i = 0; i + 1 < z.length; i += 2) {
		const c = parseInt(z[i], 10);
		if (Number.isFinite(c)) paare.push([c, z[i + 1].trim()]);
	}
	let einheit: number | null = null, nolli = false, uebersprungen = 0, aufNolli = 0;
	const koerper: Roh[] = [];
	const flaechen = new Map<string, number[]>();
	const fremd = (e: string) => { if (/^N_/i.test(e)) { nolli = true; aufNolli++; return true; } return false; };
	let abschnitt = '';
	for (let i = 0; i < paare.length; i++) {
		const [c, w] = paare[i];
		if (c === 0 && w === 'SECTION') { abschnitt = paare[i + 1]?.[1] ?? ''; continue; }
		if (abschnitt === 'HEADER' && c === 9 && w === '$INSUNITS') { einheit = INSUNITS[Number(paare[i + 1]?.[1])] ?? null; continue; }
		if (abschnitt === 'TABLES' && c === 2 && /^N_/i.test(w)) nolli = true;
		if (abschnitt !== 'ENTITIES' || c !== 0) continue;
		// Die Gruppen dieses Elements, bis zum nächsten Code 0.
		let j = i + 1;
		const g: [number, string][] = [];
		while (j < paare.length && paare[j][0] !== 0) g.push(paare[j++]);
		const wert = (code: number) => g.find((p) => p[0] === code)?.[1];
		const zahl = (code: number, sonst = 0) => { const v = wert(code); return v === undefined ? sonst : Number(v); };
		const ebene = wert(8) ?? '0';
		if (w === 'LWPOLYLINE') {
			const ring: Punkt[] = [];
			for (let k = 0; k < g.length; k++) if (g[k][0] === 10) ring.push([Number(g[k][1]), Number(g[k + 1]?.[1] ?? 0)]);
			if (fremd(ebene)) continue;
			const dicke = Math.abs(zahl(39));
			if (zu(ring, (zahl(70) & 1) === 1)) koerper.push({ ring: offen(ring), ...(dicke ? { hoehe: dicke } : {}) });
			else uebersprungen++;
		} else if (w === 'POLYLINE') {
			const flags = zahl(70), ecken: [number, number, number][] = [], seiten: number[][] = [];
			let k = j;
			while (k < paare.length && paare[k][1] !== 'SEQEND') {
				if (paare[k][0] === 0 && paare[k][1] === 'VERTEX') {
					const v: Record<number, number> = {};
					let m = k + 1;
					for (; m < paare.length && paare[m][0] !== 0; m++) v[paare[m][0]] = Number(paare[m][1]);
					const f = v[70] ?? 0;
					if (f & 128 && !(f & 64)) seiten.push([v[71], v[72], v[73], v[74]].filter((x) => x).map((x) => Math.abs(x) - 1));
					else ecken.push([v[10] ?? 0, v[20] ?? 0, v[30] ?? 0]);
					k = m;
				} else k++;
			}
			j = k;
			if (fremd(ebene)) continue;
			if (flags & 64) {
				const d: number[] = [];
				for (const s of seiten) for (let t = 1; t + 1 < s.length; t++) if (ecken[s[0]] && ecken[s[t]] && ecken[s[t + 1]]) d.push(...ecken[s[0]], ...ecken[s[t]], ...ecken[s[t + 1]]);
				if (d.length) koerper.push({ dreiecke: d }); else uebersprungen++;
			} else {
				const ring = ecken.map(([x, y]) => [x, y] as Punkt), dicke = Math.abs(zahl(39));
				if (!(flags & 16) && zu(ring, (flags & 1) === 1)) koerper.push({ ring: offen(ring), ...(dicke ? { hoehe: dicke } : {}) });
				else uebersprungen++;
			}
		} else if (w === '3DFACE') {
			if (fremd(ebene)) continue;
			const p = [0, 1, 2, 3].map((n) => [zahl(10 + n), zahl(20 + n), zahl(30 + n)]);
			const d = flaechen.get(ebene) ?? [];
			d.push(...p[0], ...p[1], ...p[2]);
			if (p[3].some((v, n) => v !== p[2][n])) d.push(...p[0], ...p[2], ...p[3]);
			flaechen.set(ebene, d);
		} else if (!['VERTEX', 'SEQEND', 'ENDSEC', 'EOF', 'TEXT', 'MTEXT', 'POINT'].includes(w) && !fremd(ebene)) uebersprungen++;
	}
	// 3DFACE trägt keinen Körper: Alles auf einer Ebene ist einer.
	for (const d of flaechen.values()) koerper.push({ dreiecke: d });
	return { koerper, einheit, nolli, ohneNetz: 0, uebersprungen, aufNolli };
}

const zu = (r: Punkt[], geschlossen: boolean) => r.length >= 3 && (geschlossen || (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]));
const offen = (r: Punkt[]) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

/** 3DM: Netze, Flächenkörper, Extrusionen und geschlossene Kurven. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function lesen3dm(bytes: Uint8Array): Promise<Gelesen> {
	const { rhinoLaden } = await import('./export/rhino');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rh = (await rhinoLaden()) as any;
	const f = rh.File3dm.fromByteArray(bytes);
	if (!f) throw new Error('3dm');
	const EINHEIT: [unknown, number][] = [[rh.UnitSystem.Millimeters, 0.001], [rh.UnitSystem.Centimeters, 0.01], [rh.UnitSystem.Decimeters, 0.1],
		[rh.UnitSystem.Meters, 1], [rh.UnitSystem.Inches, 0.0254], [rh.UnitSystem.Feet, 0.3048]];
	const einheit = EINHEIT.find(([u]) => u === f.settings().modelUnitSystem)?.[1] ?? null;
	// Der oberste Name einer Ebene; alles unter N_… hat Nolli selbst geschrieben.
	const lagen = f.layers(), wurzel = new Map<string, string>(), namen = new Map<string, { name: string; eltern: string }>();
	const reihe: string[] = [];
	for (let i = 0; i < lagen.count; i++) { const l = lagen.get(i); namen.set(l.id, { name: l.name, eltern: l.parentLayerId }); reihe.push(l.id); }
	for (const id of reihe) { let a = namen.get(id)!; while (namen.has(a.eltern)) a = namen.get(a.eltern)!; wurzel.set(id, a.name); }
	const nolli = [...wurzel.values()].some((n) => /^N_/.test(n));

	const koerper: Roh[] = [];
	let ohneNetz = 0, uebersprungen = 0, aufNolli = 0;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const netzDazu = (m: any, d: number[]) => {
		const v = m.vertices(), fl = m.faces();
		for (let i = 0; i < fl.count; i++) {
			const [a, b, c, e] = fl.get(i);
			const p = [v.get(a), v.get(b), v.get(c)];
			d.push(...p[0], ...p[1], ...p[2]);
			if (e !== c) { const q = v.get(e); d.push(...p[0], ...p[2], ...q); }
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const quader = (g: any) => {
		const b = g.getBoundingBox(), [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
		koerper.push({ ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], hoehe: z1 - z0 });
		ohneNetz++;
	};
	const obj = f.objects();
	for (let i = 0; i < obj.count; i++) {
		const e = obj.get(i), g = e.geometry(), a = e.attributes();
		if (!a.visible) continue;
		/**
		 * Was Nolli geschrieben hat, trägt seine Kennung: Körper `body_id`, dazu
		 * Gelände und Bäume ihren Namen. Die Ebene allein sagt das nicht: Wer im
		 * Export zeichnet, landet schnell auf einer Ebene unter N_BUILDINGS
		 * (Volker, 10.11.2026). Nur die Planlinien erkennt man an der Ebene.
		 *
		 * Auch die Kennung reicht nicht: Rhino nimmt sie mit, wenn man ein
		 * Nolli-Gebäude ummodelliert. Deshalb zählt ein Körper nur als Nollis
		 * eigener, solange seine Höhe noch passt; ein Dach darf sie unterschreiten.
		 */
		const aufN = /^N_/.test(wurzel.get(lagen.get(a.layerIndex)?.id) ?? '');
		const koerperArt = g instanceof rh.Mesh || g instanceof rh.Brep || g instanceof rh.Extrusion;
		const id = a.getUserString('body_id');
		let unveraendert = false;
		if (id && koerperArt) {
			const bb = g.getBoundingBox(), dz = bb.max[2] - bb.min[2];
			const soll = Number(a.getUserString('height_m')) - (Number(a.getUserString('min_height_m')) || 0);
			const dach = Number(a.getUserString('roof_height_m')) || 0;
			unveraendert = Number.isFinite(soll) && dz <= soll + 0.3 && dz >= soll - dach - 0.3;
		}
		if ((id && !koerperArt) || unveraendert || (aufN && (NOLLI_NAME.test(a.name ?? '') || !koerperArt))) { aufNolli++; continue; }
		if (g instanceof rh.Mesh) { const d: number[] = []; netzDazu(g, d); if (d.length) koerper.push({ dreiecke: d }); else uebersprungen++; }
		else if (g instanceof rh.Brep) {
			const d: number[] = [], fl = g.faces();
			let fehlt = !fl.count;
			for (let k = 0; k < fl.count; k++) { const m = fl.get(k).getMesh(rh.MeshType.Any); if (m) netzDazu(m, d); else fehlt = true; }
			if (fehlt) quader(g); else koerper.push({ dreiecke: d });
		} else if (g instanceof rh.Extrusion) {
			const m = g.getMesh(rh.MeshType.Any), d: number[] = [];
			if (m) netzDazu(m, d);
			if (d.length) koerper.push({ dreiecke: d }); else quader(g);
		} else if (g instanceof rh.Curve) {
			if (!g.isClosed) { uebersprungen++; continue; }
			const ring: Punkt[] = [];
			const pl = g.tryGetPolyline?.();
			if (pl && pl.count >= 3) for (let k = 0; k < pl.count; k++) { const p = pl.get(k); ring.push([p[0], p[1]]); }
			else { const [t0, t1] = g.domain; for (let k = 0; k < 96; k++) { const p = g.pointAt(t0 + ((t1 - t0) * k) / 96); ring.push([p[0], p[1]]); } }
			koerper.push({ ring: offen(ring) });
		} else uebersprungen++;
	}
	f.delete?.();
	return { koerper, einheit, nolli, ohneNetz, uebersprungen, aufNolli };
}

/** Wo die Datei liegt: Einheit in Meter, Koordinaten ins Ortsgitter. */
export function einordnen(g: Gelesen, k: { lon0: number; x0: number; y0: number; x1: number; y1: number }): Eingeordnet {
	const box = (sk: number) => {
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		const p = (x: number, y: number) => { x *= sk; y *= sk; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
		for (const r of g.koerper) { for (const [x, y] of r.ring ?? []) p(x, y); const d = r.dreiecke ?? []; for (let i = 0; i < d.length; i += 3) p(d[i], d[i + 1]); }
		return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, weit: Math.max(x1 - x0, y1 - y0) };
	};
	const drin = (x: number, y: number) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1;
	let sk = g.einheit ?? 1, millimeterAngenommen = false;
	let b = box(sk);
	let lage: Lage, nach: (x: number, y: number) => Punkt;
	const gitter = ortsgitter(k.lon0);
	const blatt = nachGrad((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2, gitter);
	const utm = utmGitter(zoneFuer(blatt.lon, blatt.lat));
	const ausUtm = (x: number, y: number): Punkt => { const a = nachGrad(x, y, utm), q = nachGitter(a.lon, a.lat, gitter); return [q.x, q.y]; };
	if (g.nolli) { lage = 'rahmen'; nach = (x, y) => [x + k.x0, y + k.y0]; }
	else if (drin(b.cx, b.cy)) { lage = 'gitter'; nach = (x, y) => [x, y]; }
	else if (b.cx > 1e5 && b.cx < 9e5 && b.cy >= 0 && b.cy < 1e7 && drin(...ausUtm(b.cx, b.cy))) { lage = 'utm'; nach = ausUtm; }
	else {
		if (g.einheit === null && b.weit > 2000) { sk = 0.001; millimeterAngenommen = true; b = box(sk); }
		lage = 'mitte';
		const dx = (k.x0 + k.x1) / 2 - b.cx, dy = (k.y0 + k.y1) / 2 - b.cy;
		nach = (x, y) => [x + dx, y + dy];
	}
	const koerper = g.koerper.map((r): Roh => {
		if (r.dreiecke) {
			const d = new Array<number>(r.dreiecke.length);
			for (let i = 0; i < d.length; i += 3) { const [x, y] = nach(r.dreiecke[i] * sk, r.dreiecke[i + 1] * sk); d[i] = x; d[i + 1] = y; d[i + 2] = r.dreiecke[i + 2] * sk; }
			return { dreiecke: d };
		}
		return { ring: r.ring!.map(([x, y]) => nach(x * sk, y * sk)), ...(r.hoehe ? { hoehe: r.hoehe * sk } : {}) };
	});
	return { koerper, lage, millimeterAngenommen };
}

function huelle(p: Punkt[]): Punkt[] {
	const q = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const kreuz = (o: Punkt, a: Punkt, b: Punkt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const halb = (l: Punkt[]) => { const h: Punkt[] = []; for (const x of l) { while (h.length >= 2 && kreuz(h[h.length - 2], h[h.length - 1], x) <= 0) h.pop(); h.push(x); } h.pop(); return h; };
	return [...halb(q), ...halb(q.reverse())];
}
/** Punkte auf einer Geraden weg: Die Vereinigung der Dreiecke lässt sie stehen. */
function gerade(r: Punkt[]): Punkt[] {
	return r.filter((p, i) => {
		const a = r[(i + r.length - 1) % r.length], b = r[(i + 1) % r.length];
		const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l > 0.01;
	});
}

/** Der Umriss einer Dreiecksmenge: der Schatten ihrer nach oben zeigenden Flächen. */
export function umrissAus(d: number[]): { g: Gestalt; huelle: boolean } {
	const oben: MultiPolygon[] = [], alle: MultiPolygon[] = [];
	const runde = (v: number) => Math.round(v * 100) / 100;
	for (let i = 0; i < d.length; i += 9) {
		const a: Punkt = [runde(d[i]), runde(d[i + 1])], b: Punkt = [runde(d[i + 3]), runde(d[i + 4])], c: Punkt = [runde(d[i + 6]), runde(d[i + 7])];
		const s = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
		if (Math.abs(s) < 2e-3) continue;
		const ring: Ring = s > 0 ? [a, b, c, a] : [a, c, b, a];
		alle.push([[ring]]);
		if (s > 0) oben.push([[ring]]);
	}
	const liste = oben.length ? oben : alle;
	const alsHuelle = () => {
		const p: Punkt[] = [];
		for (let i = 0; i < d.length; i += 3) p.push([d[i], d[i + 1]]);
		return { g: { ringe: [gegenUhr(huelle(p))] }, huelle: true };
	};
	if (!liste.length || liste.length > 60000) return alsHuelle();
	const vereinen = (l: MultiPolygon[]): MultiPolygon => {
		if (l.length === 1) return l[0];
		const h = l.length >> 1;
		return polygonClipping.union(vereinen(l.slice(0, h)), vereinen(l.slice(h)));
	};
	try {
		const roh = ausMulti(vereinen(liste));
		const ringe = roh.ringe.map(gerade).filter((r) => r.length >= 3);
		if (!ringe.length) return alsHuelle();
		const loecher = (roh.loecher ?? []).map(gerade).filter((r) => r.length >= 3 && ringFlaeche(r) >= 0.5);
		return { g: { ringe, ...(loecher.length ? { loecher } : {}) }, huelle: false };
	} catch { return alsHuelle(); }
}

/** Ein eingeordneter Körper als Neubau. `huelle` meldet einen Umriss, der nur eine Näherung ist. */
export function neubauAus(id: string, r: Roh, w: Entwurfswahl, datei: string): { o: Neubau; huelle: boolean } | null {
	if (r.ring) {
		if (r.ring.length < 3 || ringFlaeche(r.ring) < 1) return null;
		const gesch = r.hoehe ? Math.max(1, Math.round(r.hoehe / w.geschossHoeheM)) : w.geschosse;
		// Eine Höhe aus der Datei bleibt genau: Die Geschosshöhe wird passend gemacht.
		const gh = r.hoehe ? Math.round((r.hoehe / gesch) * 1000) / 1000 : w.geschossHoeheM;
		return { o: neubau(id, r.ring, { ...w, geschosse: gesch, geschossHoeheM: gh }), huelle: false };
	}
	let d = r.dreiecke!;
	if (d.length < 9) return null;
	// Außen muss außen sein: Das 3D-Modell schneidet Rückseiten weg.
	let vol = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
	for (let i = 0; i < d.length; i += 3) { x0 = Math.min(x0, d[i]); x1 = Math.max(x1, d[i]); y0 = Math.min(y0, d[i + 1]); y1 = Math.max(y1, d[i + 1]); z0 = Math.min(z0, d[i + 2]); z1 = Math.max(z1, d[i + 2]); }
	const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
	for (let i = 0; i < d.length; i += 9) {
		const ax = d[i] - mx, ay = d[i + 1] - my, az = d[i + 2] - z0, bx = d[i + 3] - mx, by = d[i + 4] - my, bz = d[i + 5] - z0, cx = d[i + 6] - mx, cy = d[i + 7] - my, cz = d[i + 8] - z0;
		vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
	}
	if (vol < 0) {
		const n = [...d];
		for (let i = 0; i < n.length; i += 9) for (let j = 0; j < 3; j++) { const t = n[i + 3 + j]; n[i + 3 + j] = n[i + 6 + j]; n[i + 6 + j] = t; }
		d = n;
	}
	const { g, huelle: nurHuelle } = umrissAus(d);
	if (!g.ringe.length) return null;
	const hoehe = Math.round((z1 - z0) * 100) / 100;
	if (hoehe <= 0) return null;
	const p = new Array<number>(d.length);
	const r3 = (v: number) => Math.round(v * 1000) / 1000;
	for (let i = 0; i < d.length; i += 3) { p[i] = r3(d[i] - mx); p[i + 1] = r3(d[i + 1] - my); p[i + 2] = r3(d[i + 2] - z0); }
	const basis = neubau(id, g.ringe[0], { ...w, geschosse: Math.max(1, Math.round(hoehe / w.geschossHoeheM)) });
	const o: Neubau = { ...basis, ringe: g.ringe, ...(g.loecher ? { loecher: g.loecher } : {}), hoeheM: hoehe, fest: { p, mitte: [mx, my], grad: 0, datei } };
	return { o, huelle: nurHuelle };
}
