/**
 * Das Materialschema der Kette, Version 1.
 *
 * Beschrieben im Vault unter `Urban_Pipeline/00-Datenpaket _Datenvertrag/
 * 01-Materialschema.md`; diese Datei ist der Katalog, aus dem Nolli schreibt.
 * Pons und Obscura lesen ihn aus `data/materials.json` im Paket und erfinden
 * nichts selbst.
 *
 * Bewusst schmal (Volker, 03.11.2026): Graustufen statt Materialbibliothek,
 * eine einzige warme Farbe für den Entwurf.
 * Bäume grün wie im 3D-Modell (04.11.2026: graue Kronen lasen in Rhino als
 * Fehler). Rauheit, Reflexion und Albedo
 * kommen erst, wenn ein Werkzeug sie rechnet — dann als `schema_version: 2`.
 *
 * Die Namen sind englisch und gehen ungeändert ins Paket; die Tabellen in
 * `vertrag.ts` kennen sie nicht, damit Umbras Abschrift gleich bleibt.
 * `mask_index` wird einmal vergeben und nie neu belegt.
 */
import type { Objekt, Nutzungsklasse } from './osm';

export const MATERIAL_SCHEMA = 1;

export type Material = {
	id: string;
	name: { de: string; en: string };
	category: 'building' | 'ground' | 'vegetation' | 'water' | 'design';
	color: string;
	mask_index: number;
};

export const MATERIALIEN: Material[] = [
	{ id: 'residential',  name: { de: 'Wohnen', en: 'Residential' },       category: 'building',   color: '#BEBEBE', mask_index: 1 },
	{ id: 'commercial',   name: { de: 'Gewerbe', en: 'Commercial' },       category: 'building',   color: '#A6A6A6', mask_index: 2 },
	{ id: 'public',       name: { de: 'Öffentlich', en: 'Public' },        category: 'building',   color: '#8C8C8C', mask_index: 3 },
	{ id: 'ancillary',    name: { de: 'Nebengebäude', en: 'Ancillary' },   category: 'building',   color: '#E6E6E6', mask_index: 4 },
	{ id: 'undetermined', name: { de: 'Unbestimmt', en: 'Undetermined' },  category: 'building',   color: '#D2D2D2', mask_index: 5 },
	{ id: 'kept',         name: { de: 'Erhalt', en: 'Kept' },              category: 'building',   color: '#6E6E6E', mask_index: 6 },
	{ id: 'design',       name: { de: 'Entwurf', en: 'Design' },           category: 'design',     color: '#D4B483', mask_index: 7 },
	{ id: 'green',        name: { de: 'Grün', en: 'Green' },               category: 'vegetation', color: '#EEEEEE', mask_index: 10 },
	{ id: 'tree',         name: { de: 'Baum', en: 'Tree' },                category: 'vegetation', color: '#4F7F4A', mask_index: 11 },
	{ id: 'water',        name: { de: 'Wasser', en: 'Water' },             category: 'water',      color: '#DCDCDC', mask_index: 12 },
	{ id: 'street',       name: { de: 'Straße', en: 'Street' },            category: 'ground',     color: '#E8E8E8', mask_index: 13 },
	{ id: 'rail',         name: { de: 'Bahn', en: 'Rail' },                category: 'ground',     color: '#D0D0D0', mask_index: 14 },
	{ id: 'construction', name: { de: 'Baustelle', en: 'Construction' },   category: 'ground',     color: '#E6E6E6', mask_index: 15 },
	{ id: 'ground',       name: { de: 'Grund, Gelände', en: 'Ground, terrain' }, category: 'ground', color: '#F4F4F4', mask_index: 16 }
];

/** Die Regeln, wie sie im Paket stehen: der Reihe nach, die erste passende gilt. */
export const MATERIAL_REGELN = [
	{ if: { origin: 'design' }, material: 'design' },
	{ if: { state: 'kept' }, material: 'kept' },
	{ if: { use_class: '*' }, material: '<use_class>' },
	{ if: {}, material: 'undetermined' }
];

const NACH_KLASSE: Record<Nutzungsklasse, string> = {
	wohnen: 'residential', gewerbe: 'commercial', oeffentlich: 'public',
	neben: 'ancillary', unbestimmt: 'undetermined'
};

/** Die Vorgabe für einen Baukörper, nach `MATERIAL_REGELN`. */
export function materialFuer(o: Objekt): string {
	if (o.zustand === 'erhalt' || o.ebene === 'erhalt') return 'kept';
	return NACH_KLASSE[o.klasse ?? 'unbestimmt'] ?? 'undetermined';
}

/** `data/materials.json`. */
export const materialDatei = () => ({
	schema_version: MATERIAL_SCHEMA,
	description: 'Material schema of the Nolli pipeline. Every body carries its material in data/bodies.json; the rules only explain how Nolli chose the default. See the contract notes, 01-Materialschema.',
	rules: MATERIAL_REGELN,
	materials: MATERIALIEN
});

/** `Kd` in der MTL: sRGB-Werte als Bruch, wie Rhino sie liest. */
export const kd = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(4)).join(' ');
};
