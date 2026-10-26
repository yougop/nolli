import type { StiftId } from './stifte';
import type { Nutzungsklasse } from './osm';

/**
 * Darstellungen des Blattes.
 *
 * Das Blatt ist ein Dokument, keine Bedienoberflaeche. Es folgt deshalb
 * nicht dem hellen oder dunklen Schema der Anwendung, sondern der hier
 * gewaehlten Darstellung. Die Oberflaeche drumherum bleibt monochrom, das
 * Blatt darf Farbe tragen, wenn die Darstellung sie braucht.
 */
export type Bauweise = 'flaeche' | 'linie' | 'weissmodell' | 'raum';

export type Darstellung = {
	id: string;
	name: string;
	zweck: string;
	bauweise: Bauweise;
	grund: string;
	farbe: Partial<Record<StiftId, string>>;
	kante?: Partial<Record<StiftId, string>>;
	nachNutzung?: Record<Nutzungsklasse, string>;
	/**
	 * Farbleiter fuer die Erfassungstiefe, von duenn nach dicht.
	 *
	 * Ist sie gesetzt, faerbt der Zeichner jedes Objekt nach der Zahl seiner
	 * Merkmale statt nach seiner Ebene.
	 */
	nachTiefe?: string[];
	schrift: string;       // Farbe der Beschriftung
	schriftFlor: string;   // Hinterlegung, damit Schrift auf jedem Grund liest
};

/**
 * Werte des Schwarzplans, von hell nach dunkel geordnet:
 * Grund, Gruen, Strassen, Baustellen, Wasser, Bahn, Gebaeude.
 *
 * Wasser liegt bewusst deutlich unter den Strassen. Es ist eine Flaeche mit
 * Gewicht, keine Aufhellung, und der Plan braucht diesen Sprung, damit die
 * Wasserkante als Kante liest und nicht als Rand einer helleren Zone.
 */
const GRAU = {
	gruen: '#EFEFEF', wasser: '#CDCDCD', bahn: '#9D9D9D', strasse: '#DCDCDC',
	bau: '#C3C3C3', gebaeude: '#111111', erhalt: '#111111', gestrichen: '#CACACA'
};

export const DARSTELLUNGEN: Darstellung[] = [
	{
		id: 'schwarzplan',
		name: 'Schwarzplan',
		zweck: 'Figur und Grund. Der Regelfall, und was ein Bildmodell am besten liest.',
		bauweise: 'flaeche',
		grund: '#FFFFFF',
		farbe: { ...GRAU },
		schrift: '#4A4A4A', schriftFlor: 'rgba(255,255,255,.85)'
	},
	{
		id: 'invertiert',
		name: 'Invertiert',
		zweck: 'Weiß auf Schwarz. Zeigt den öffentlichen Raum als Figur statt als Rest.',
		bauweise: 'flaeche',
		grund: '#111111',
		farbe: {
			gruen: '#212121', wasser: '#313131', bahn: '#545454', strasse: '#2A2A2A',
			bau: '#424242', gebaeude: '#FFFFFF', erhalt: '#FFFFFF', gestrichen: '#3A3A3A'
		},
		schrift: '#9A9A9A', schriftFlor: 'rgba(17,17,17,.85)'
	},
	{
		id: 'linie',
		name: 'Linie',
		zweck: 'Nur Konturen, weiß hinterlegt. Für Plots und für die Kantenerkennung.',
		bauweise: 'linie',
		grund: '#FFFFFF',
		farbe: {
			gruen: '#C3C3C3', wasser: '#9B9B9B', bahn: '#828282', strasse: '#BABABA',
			bau: '#AAAAAA', gebaeude: '#111111', erhalt: '#111111', gestrichen: '#C8C8C8'
		},
		schrift: '#6A6A6A', schriftFlor: 'rgba(255,255,255,.9)'
	},
	{
		id: 'nutzung',
		name: 'Nutzung',
		zweck: 'Gebäude nach Art eingefärbt. Arbeitet dem Programmschritt vor.',
		bauweise: 'flaeche',
		grund: '#F8F7F4',
		farbe: {
			gruen: '#D9E0D3', wasser: '#BCC4C9', bahn: '#B0AAA2', strasse: '#EBE8E3',
			bau: '#D6CFC4', gebaeude: '#9C9C9C', erhalt: '#9C9C9C', gestrichen: '#DCDCDC'
		},
		kante: { gebaeude: 'rgba(40,36,30,.55)', erhalt: 'rgba(40,36,30,.8)' },
		// Sättigung um gut vierzig Prozent zurückgenommen. Die Klassen sollen
		// sich unterscheiden lassen, nicht um Aufmerksamkeit streiten.
		nachNutzung: {
			wohnen:      '#BA9B68',
			gewerbe:     '#84929E',
			oeffentlich: '#9C6658',
			neben:       '#C6C3BD',
			unbestimmt:  '#A6A39F'
		},
		schrift: '#5A544C', schriftFlor: 'rgba(248,247,244,.85)'
	},
	{
		id: 'modellaufsicht',
		name: 'Aufsicht',
		zweck: 'Das 3D-Modell von oben. Farben und Kontraste der Raumansicht, Baukörper plastisch mit Schlagschatten aus der Geschosszahl.',
		bauweise: 'weissmodell',
		// Dieselben Werte wie im 3D-Modell, nur die Baukörper heller: In der
		// Raumansicht hebt sie das Licht vom Boden ab, in der Fläche muss das
		// die Farbe tun.
		grund: '#E2E2DB',
		farbe: {
			gruen: '#BDCD98', wasser: '#93A9B7', bahn: '#8E8E88', strasse: '#BCBCB2',
			bau: '#CBCBC3', gebaeude: '#F2F2ED', erhalt: '#F2F2ED', gestrichen: '#D0D0C9'
		},
		kante: { strasse: '#8E8E85', gebaeude: '#5E5E58', erhalt: '#3A3A35' },
		schrift: '#5A5A54', schriftFlor: 'rgba(226,226,219,.85)'
	},
	{
		id: 'weissmodell',
		name: 'Weißmodell',
		zweck: 'Aufsicht auf das 3D-Modell: plastische Baukörper mit Schlagschatten und Fußsaum, unter derselben Sonne. Höhen aus der Geschosszahl.',
		bauweise: 'weissmodell',
		grund: '#F4F4F2',
		farbe: {
			gruen: '#E8E8E3', wasser: '#D4D4D2', bahn: '#B0B0AC', strasse: '#EBEBE8',
			bau: '#D5D5D1', gebaeude: '#FCFCFB', erhalt: '#FCFCFB', gestrichen: '#CECECA'
		},
		schrift: '#6A6A66', schriftFlor: 'rgba(244,244,242,.85)'
	},
	{
		id: 'datentiefe',
		name: 'Datentiefe',
		zweck: 'Wie gut OpenStreetMap den Ausschnitt kennt. Jedes Objekt nach der Zahl seiner Merkmale eingefärbt, von blass bis dicht. Kein Gütesiegel, sondern eine Auskunft darüber, worauf die späteren Zahlen stehen.',
		bauweise: 'flaeche',
		grund: '#F4F4F2',
		// Die Leiter läuft von einem sehr blassen Grau bis zu einem satten
		// Blaugrün. Blass heißt: kaum etwas bekannt. Nicht rot, weil dünn
		// erfasst kein Fehler ist.
		nachTiefe: ['#E7E7E4', '#CFD8D2', '#AEC3BB', '#87A79E', '#5C8A80', '#2F6C63'],
		farbe: {
			gruen: '#EFEFEC', wasser: '#EAECEC', bahn: '#D8D8D5', strasse: '#E2E2DF',
			bau: '#E7E7E4', gebaeude: '#CFD8D2', erhalt: '#CFD8D2', gestrichen: '#EDEDEA',
			baum: '#87A79E'
		},
		schrift: '#4A5C58', schriftFlor: 'rgba(244,244,242,.85)'
	},
	{
		id: 'modell3d',
		name: '3D-Modell',
		zweck: 'Arbeitsmodell in drei Dimensionen. Die Höhen stammen aus der Geschosszahl, sind also Annäherung, nicht Aufmaß.',
		bauweise: 'raum',
		// Das Bodenbild liegt unter weißen Körpern. Damit es dort überhaupt
		// liest, sind Straßen hell und Wasser und Grün deutlich abgesetzt.
		// Grund und Grün am 13.09.2026 nachgedunkelt: Unter der Beleuchtung
		// der Raumansicht hellt jede Fläche noch einmal auf, gemessen um rund
		// dreißig Stufen. Was hier schon hell ist, wird dort weiß.
		// Grau ohne Stich. Am 15.09.2026 nachgezogen: Die Warmtoene der Aufsicht
		// summierten sich unter der Beleuchtung zu einem beigen Gesamteindruck.
		// Farbe bleibt, wo sie etwas bedeutet — Gruen und Wasser.
		// Wasser am 26.10.2026 dunkler und blauer: In Manhattan grenzt das
		// Wasser fast überall an Straßen und Plätze, und das alte #B2BFC6 lag
		// in der Helligkeit gleichauf mit der Fahrbahn #BABABA. Unter dem
		// Licht war Land von Wasser kaum zu unterscheiden. Die Aufsicht zieht
		// mit, sie ist die Textur des Modells für Rhino.
		grund: '#E4E4E4',
		farbe: {
			gruen: '#BDCD98', wasser: '#93A9B7', bahn: '#8C8C8C', strasse: '#BABABA',
			bau: '#C9C9C9', gebaeude: '#E0E0E0', erhalt: '#E0E0E0', gestrichen: '#CFCFCF'
		},
		// Die Fahrbahn liegt dunkler als der Grund, sonst verschwindet sie
		// unter den weissen Koerpern. Der Saum setzt die Kante noch einmal ab.
		kante: { strasse: '#8C8C8C' },
		schrift: '#6A6A6A', schriftFlor: 'rgba(240,240,240,.85)'
	}
];

export const darstellung = (id: string) =>
	DARSTELLUNGEN.find((d) => d.id === id) ?? DARSTELLUNGEN[0];

export const NUTZUNGSNAMEN: Record<Nutzungsklasse, string> = {
	wohnen: 'Wohnen',
	gewerbe: 'Gewerbe und Handel',
	oeffentlich: 'Öffentlich',
	neben: 'Nebenanlagen',
	unbestimmt: 'unbestimmt'
};
