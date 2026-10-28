/**
 * Datenvertrag v2: dieselben Inhalte, englische Namen.
 *
 * Nolli rechnet intern weiter mit seinen deutschen Namen. Erst beim Ausgeben
 * geht alles, was ein anderes Werkzeug liest, durch diese Tabellen: Feldnamen,
 * aufgezählte Werte, Dateipfade, Objektnamen im OBJ und Ebenen im DXF.
 *
 * Die Tabellen sind die einzige Stelle, an der die Umbenennung steht. Umbra
 * führt eine Abschrift für die Gegenrichtung, damit es v1- und v2-Pakete
 * gleichermaßen liest; `pruefung/vertrag.mjs` hält beide gegeneinander. Jede
 * Tabelle muss umkehrbar sein — zwei deutsche Namen auf denselben englischen
 * ließen die Gegenrichtung raten.
 *
 * Merkmale aus OpenStreetMap (`highway`, `surface`, alles unter `tags`)
 * bleiben, wie sie sind. Sie sind schon englisch und gehören nicht uns.
 */

export const VERTRAG_VERSION = 2;

/** Feldnamen, v1 → v2. Gilt in jeder Tiefe, außer unter `tags`. */
export const FELDER: Record<string, string> = {
	// frame.json, Rahmen
	schritt: 'step',
	gitter: 'grid',
	mittelmeridian: 'central_meridian',
	bbox_gitter: 'bbox_grid',
	sued: 'south',
	ost: 'east',
	nord: 'north',
	breite_m: 'width_m',
	hoehe_m: 'height_m',
	flaeche_ha: 'area_ha',
	seitenverhaeltnis: 'aspect_ratio',
	pixel_breite: 'pixel_width',
	pixel_hoehe: 'pixel_height',
	meter_pro_pixel: 'meters_per_pixel',
	restkonvergenz_grad: 'residual_convergence_deg',
	pruefpixel_12m: 'check_pixels_12m',
	mitte: 'center',
	karte: 'map',
	luftbild: 'satellite',
	gelaende: 'terrain',
	strassenansicht: 'street_view',
	suche: 'search',
	erde: 'earth',
	quelle: 'source',
	lizenz: 'license',
	erstellt: 'created',
	// frame.json, Bestand
	ort: 'place',
	wo: 'region',
	objekte: 'objects',
	gestrichen: 'removed',
	erhalt: 'kept',
	baeume: 'trees',
	vorgabe_krone_m: 'default_crown_m',
	stammhoehe_m: 'trunk_height_m',
	silhouette_faktor: 'silhouette_factor',
	baukoerper: 'body_count',
	gebaeude: 'buildings',
	teile: 'parts',
	hoehen_echt_anteil: 'measured_height_share',
	hoehen_herkunft: 'height_origin',
	hoehen_herkunft_gebaeude: 'height_origin_buildings',
	gemessen: 'measured',
	aus_geschossen: 'from_storeys',
	annahme_8m: 'assumed_8m',
	aus_luftbild: 'from_imagery',
	grundflaeche_m2: 'footprint_m2',
	dateien: 'files',
	paket: 'package',
	modell: 'model',
	zeichnung: 'drawing',
	aufsicht: 'image',
	aufsicht_grund_im_paket: 'top_view_bare_in_package',
	vorbehalte: 'caveats',
	flaechen_m2: 'areas_m2',
	wasser: 'water',
	gruen: 'green',
	bahn: 'rail',
	strasse: 'streets',
	bau: 'construction',
	verkehrsflaeche_m2_geschaetzt: 'traffic_area_m2_estimated',
	fahrbahn: 'carriageway',
	wege: 'paths',
	modell_namenszusaetze: 'model_name_suffixes',
	_hoehe_geschaetzt: '_height_estimated',
	_ausserhalb: '_outside',
	bildformat: 'image_format',
	bilder: 'images',
	daten: 'data',
	datei: 'file',
	darstellung: 'style',
	was: 'description',
	eintraege: 'entries',
	felder: 'fields',
	// frame.json ohne Paket: die Daten selbst
	koerper: 'bodies',
	netz: 'network',
	nutzflaechen: 'land_use',
	pois: 'pois',
	haltestellen: 'stops',
	linien: 'lines',
	rest: 'other',
	// Datendateien
	art: 'kind',
	kreuzt_rahmen: 'crosses_frame',
	geschosse: 'storeys',
	denkmal: 'heritage',
	adresse: 'address',
	nutzung: 'osm_building',
	klasse: 'use_class',
	zustand: 'state',
	knoten: 'nodes',
	von: 'from',
	bis: 'to',
	nach: 'towards',
	laenge_m: 'length_m',
	weg: 'way',
	punkte: 'points',
	gruppe: 'group',
	flaeche_m2: 'area_m2',
	ringe: 'rings',
	typ: 'type',
	krone_m: 'crown_m',
	fuss_m: 'base_m',
	// Gelände
	modelle: 'models',
	kachel_m_pro_px: 'tile_m_per_px',
	raster_m: 'grid_spacing_m',
	hoehenbezug: 'height_datum',
	aequidistanz_m: 'contour_interval_m',
	geholt: 'fetched',
	hoehen: 'heights',
	// Overture
	herkunft: 'origin',
	herkunft_umriss: 'geometry_source',
	ergaenzt: 'added',
	quellen: 'sources',
	namensnennung: 'attribution'
};

/** Aufgezählte Werte, je Feldname (dem deutschen). */
export const WERTE: Record<string, Record<string, string>> = {
	art: { gebaeude: 'building', teil: 'part' },
	quelle: { gemessen: 'measured', geschosse: 'storeys', luftbild: 'imagery', annahme: 'assumed', knoten: 'node', flaeche: 'area' },
	klasse: { wohnen: 'residential', gewerbe: 'commercial', oeffentlich: 'public', neben: 'ancillary', unbestimmt: 'undetermined' },
	zustand: { normal: 'normal', gestrichen: 'removed', erhalt: 'kept' },
	gruppe: {
		verkehr: 'transport', moeblierung: 'furniture', freizeit: 'leisure', versorgung: 'amenities',
		gastronomie: 'food_drink', verwaltung: 'administration', sonstiges: 'other', bildung: 'education',
		gesundheit: 'health'
	},
	typ: { punkt: 'point', flaeche: 'area', linie: 'line' },
	vorbehalte: {
		daecher_flach: 'roofs_flat',
		gelaende_eben: 'terrain_flat',
		gelaende_grob: 'terrain_coarse',
		gebaeude_luftbild: 'buildings_from_imagery'
	},
	lizenz: { 'ODbL, © OpenStreetMap-Mitwirkende': 'ODbL, © OpenStreetMap contributors' }
};

/** Die Darstellungen. Sie stehen im Vertrag als Wert und in den Bildnamen. */
export const DARSTELLUNGEN_V2: Record<string, string> = {
	schwarzplan: 'figure_ground',
	invertiert: 'inverted',
	linie: 'line',
	nutzung: 'use',
	modellaufsicht: 'top_view',
	weissmodell: 'white_model',
	datentiefe: 'data_depth',
	modell3d: 'model_3d'
};

/** Dateien im Paket, v1 → v2. Bilder folgen der Regel in `pfadV2`. */
export const DATEIEN: Record<string, string> = {
	'frame.json': 'frame.json',
	'modell.obj': 'model.obj',
	'zeichnung.dxf': 'drawing.dxf',
	'daten/koerper.json': 'data/bodies.json',
	'daten/netz.json': 'data/network.json',
	'daten/punkte.json': 'data/points.json',
	'daten/haltestellen.json': 'data/stops.json',
	'daten/linien.json': 'data/lines.json',
	'daten/flaechen.json': 'data/land_use.json',
	'daten/rest.json': 'data/other.json',
	'daten/baeume.json': 'data/trees.json',
	'daten/gelaende.json': 'data/terrain.json',
	'bilder/3d-modell.webp': 'images/model_3d.webp'
};

/** Namensteile der Körper im OBJ. */
export const OBJ_NAMEN: [string, string][] = [
	['gebaeude_', 'building_'],
	['erhalt_', 'kept_'],
	['_hoehe_geschaetzt', '_height_estimated'],
	['_ausserhalb', '_outside'],
	['baum_', 'tree_'],
	['_krone_vorgabe', '_crown_default'],
	['gelaende', 'terrain']
];

/** Ebenen im DXF. */
export const DXF_EBENEN: Record<string, string> = {
	N_GRUEN: 'N_GREEN',
	N_WASSER: 'N_WATER',
	N_BAHN: 'N_RAIL',
	N_STRASSE: 'N_STREETS',
	N_BAU: 'N_CONSTRUCTION',
	N_GEBAEUDE: 'N_BUILDINGS',
	N_ERHALT: 'N_KEPT',
	N_GESTRICHEN: 'N_REMOVED',
	N_PLANGEBIET: 'N_SITE',
	N_RAHMEN: 'N_FRAME',
	N_BAUM: 'N_TREES',
	N_BESCHRIFTUNG: 'N_LABELS',
	N_HOEHENLINIE: 'N_CONTOUR',
	N_HOEHENLINIE_HAUPT: 'N_CONTOUR_MAJOR'
};

export const darstellungV2 = (id: string) => DARSTELLUNGEN_V2[id] ?? id;
export const dxfEbene = (n: string) => DXF_EBENEN[n] ?? n;
export const objName = (n: string) => OBJ_NAMEN.reduce((s, [a, b]) => s.replace(a, b), n);

/** Ein Pfad im Paket, v1 → v2. Unbekanntes bleibt stehen. */
export function pfadV2(p: string): string {
	if (DATEIEN[p]) return DATEIEN[p];
	const bild = /^bilder\/([a-z0-9]+)(_grund)?\.(webp|png)$/.exec(p);
	if (bild) return `images/${darstellungV2(bild[1])}${bild[2] ? '_bare' : ''}.${bild[3]}`;
	return p;
}

/** Felder, deren Wert ein Pfad im Paket ist. */
const PFADFELDER = new Set(['datei', 'modell', 'zeichnung', 'aufsicht_grund_im_paket']);

/**
 * Einen Wert in v2 übersetzen, in jeder Tiefe.
 *
 * `feld` ist der deutsche Name, unter dem der Wert steht. Er entscheidet, ob
 * ein Text ein aufgezählter Wert, ein Pfad oder eine Darstellung ist.
 */
export function aufV2(wert: unknown, feld = ''): unknown {
	if (Array.isArray(wert)) return wert.map((w) => aufV2(w, feld));
	if (wert && typeof wert === 'object') {
		if (feld === 'tags') return wert;
		const aus: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(wert)) aus[FELDER[k] ?? k] = aufV2(v, k);
		return aus;
	}
	if (typeof wert === 'string') {
		if (PFADFELDER.has(feld)) return pfadV2(wert);
		if (feld === 'darstellung') return darstellungV2(wert);
		return WERTE[feld]?.[wert] ?? wert;
	}
	return wert;
}

/** Den ganzen Vertrag: dazu Kennung und Version an den Anfang. */
export function vertragV2(v: Record<string, unknown>) {
	const { nolli: _, ...rest } = v;
	return { contract: 'nolli', contract_version: VERTRAG_VERSION, ...(aufV2(rest) as Record<string, unknown>) };
}
