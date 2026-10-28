/**
 * Die Stifttabelle. Jede Ebene hat einen Stift: Wert, Strichbreite in
 * Millimetern auf DIN A1, und einen DXF-Ebenennamen.
 *
 * Farbe traegt hier keine Bedeutung. Die Welt ist eine Grauleiter mit
 * einem einzigen Akzent, und der Akzent gehoert dem, was gerade lebt:
 * dem Rahmen und dem Plangebiet. Alles andere wird ueber den Wert
 * unterschieden, wie in einem Schwarzplan.
 *
 * Auch Wasser und Gruen sind deshalb reine Grauwerte. Sollte sich in
 * Schritt 5 zeigen, dass das Bildmodell einen Farbton braucht, um Wasser
 * als Wasser zu lesen, ist das hier eine Zeile.
 *
 * `bau` ist kein Gebaeude, sondern eine Baustelle. OSM fuehrt grosse
 * Entwicklungsgebiete als `landuse=construction`, ohne dass dort schon
 * Gebaeude erfasst waeren. Wer das nicht zeigt, hat im Plan ein weisses
 * Loch und weiss nicht, warum.
 */
export type StiftId =
	| 'gruen' | 'wasser' | 'bahn' | 'strasse' | 'bau' | 'gebaeude' | 'overture' | 'baum'
	| 'erhalt' | 'gestrichen' | 'plangebiet' | 'rahmen';

export type Stift = {
	id: StiftId;
	name: string;
	dxf: string;
	mm: number;              // Strichbreite auf A1
	hell: string; dunkel: string;
	fuellung: boolean;
	akzent?: boolean;
	dxfFarbe: number;        // ACI-Nummer fuer die DXF-Ebene
};

export const STIFTE: Stift[] = [
	{ id: 'gruen',      name: 'Grün',           dxf: 'N_GRUEN',      mm: 0.13, hell: '#F0F0F0', dunkel: '#262626', fuellung: true,  dxfFarbe: 3 },
	{ id: 'wasser',     name: 'Wasser',         dxf: 'N_WASSER',     mm: 0.13, hell: '#E6E6E6', dunkel: '#2E2E2E', fuellung: true,  dxfFarbe: 4 },
	{ id: 'bahn',       name: 'Bahn',           dxf: 'N_BAHN',       mm: 0.35, hell: '#A6A6A6', dunkel: '#6E7276', fuellung: false, dxfFarbe: 8 },
	{ id: 'strasse',    name: 'Straßen',        dxf: 'N_STRASSE',    mm: 0.18, hell: '#CFCFCF', dunkel: '#4A4E52', fuellung: false, dxfFarbe: 9 },
	{ id: 'bau',        name: 'Im Bau',          dxf: 'N_BAU',        mm: 0.18, hell: '#BDBDBD', dunkel: '#4E5255', fuellung: true,  dxfFarbe: 2 },
	{ id: 'gebaeude',   name: 'Gebäude',        dxf: 'N_GEBAEUDE',   mm: 0.25, hell: '#111111', dunkel: '#E8EAE7', fuellung: true,  dxfFarbe: 7 },
	/**
	 * Gebäude aus Overture (`overture.ts`). Am Objekt bleiben sie Gebäude —
	 * Höhe, Modell und Vertrag behandeln sie wie jedes andere. Nur sichtbar
	 * und in der Zeichnung sind sie eine eigene Ebene, damit man sie an- und
	 * ausschalten kann (Volker, 28.10.2026). Siehe `sichtEbene`.
	 */
	{ id: 'overture',   name: 'Overture',       dxf: 'N_OVERTURE',   mm: 0.25, hell: '#111111', dunkel: '#E8EAE7', fuellung: true,  dxfFarbe: 30 },
	{ id: 'erhalt',     name: 'Erhalt',         dxf: 'N_ERHALT',     mm: 0.50, hell: '#111111', dunkel: '#E8EAE7', fuellung: true,  dxfFarbe: 7 },
	{ id: 'gestrichen', name: 'Gestrichen',     dxf: 'N_GESTRICHEN', mm: 0.18, hell: '#C3C3C3', dunkel: '#44484C', fuellung: false, dxfFarbe: 9 },
	{ id: 'plangebiet', name: 'Plangebiet',     dxf: 'N_PLANGEBIET', mm: 0.70, hell: '#8CA82F', dunkel: '#A6C23F', fuellung: false, akzent: true, dxfFarbe: 1 },
	{ id: 'rahmen',     name: 'Rahmen',         dxf: 'N_RAHMEN',     mm: 0.70, hell: '#8CA82F', dunkel: '#A6C23F', fuellung: false, akzent: true, dxfFarbe: 1 }
];

export const stift = (id: StiftId) => STIFTE.find((s) => s.id === id)!;

/** Fahrbahnbreiten in Metern. Strassen werden massstaeblich breit gezeichnet. */
export const FAHRBAHN: Record<string, number> = {
	motorway: 22, motorway_link: 12, trunk: 18, trunk_link: 11,
	primary: 16, primary_link: 10, secondary: 13, secondary_link: 9,
	tertiary: 10, tertiary_link: 8, residential: 8, unclassified: 8,
	living_street: 7, pedestrian: 5, service: 4.5, track: 3,
	footway: 2, path: 1.8, cycleway: 2.2, steps: 1.8
};
