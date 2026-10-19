/**
 * Die Sprache der Oberfläche.
 *
 * Zwei Wörterbücher mit derselben Form: Das englische ist mit `typeof de`
 * getippt, ein fehlender Eintrag fällt deshalb schon bei `svelte-check` auf
 * und nicht erst, wenn jemand auf Englisch klickt.
 *
 * Gilt nur für Text, den ein Mensch liest. Feldnamen, Dateinamen und
 * DXF-Ebenen im Paket gehören dem Datenvertrag und wechseln nicht mit.
 */
import type { StiftId } from './stifte';
import type { Nutzungsklasse } from './osm';

export type Sprache = 'de' | 'en';

const SCHLUESSEL = 'nolli.sprache';

function anfang(): Sprache {
	try {
		const g = localStorage.getItem(SCHLUESSEL);
		if (g === 'de' || g === 'en') return g;
	} catch {}
	if (typeof navigator !== 'undefined' && !navigator.language?.toLowerCase().startsWith('de')) return 'en';
	return 'de';
}

export const sprache = $state<{ jetzt: Sprache }>({ jetzt: 'de' });

/** Beim Start im Browser: gemerkte Wahl, sonst die Sprache des Browsers. */
export function spracheAnfangen() {
	const s = anfang();
	sprache.jetzt = s;
	document.documentElement.lang = s;
}

export function spracheSetzen(s: Sprache) {
	sprache.jetzt = s;
	document.documentElement.lang = s;
	try { localStorage.setItem(SCHLUESSEL, s); } catch {}
}

/** Das Gebietsschema für Zahlen und Uhrzeiten. */
export const gebiet = () => (sprache.jetzt === 'en' ? 'en-GB' : 'de-DE');
export const zahl = (n: number, opt?: Intl.NumberFormatOptions) => n.toLocaleString(gebiet(), opt);

const de = {
	schritte: {
		1: { name: 'Rahmen', was: 'Ort wählen und Ausschnitt festlegen' },
		2: { name: 'Bereinigen', was: 'Bestand markieren und streichen' },
		3: { name: 'Ausgeben', was: 'Bild, Zeichnung, Modell, Vertrag' }
	},
	kopf: {
		schritteLabel: 'Arbeitsschritte',
		erstRahmen: 'Erst den Rahmen setzen und die Daten holen',
		schema: 'Darstellung wechseln',
		sprache: 'Sprache',
		anleitung: 'Anleitung',
		anleitungTitel: 'Was Nolli kann und wie das Paket aufgebaut ist. README auf GitHub, auf Englisch.'
	},
	meldungSchliessen: 'Meldung schließen',
	sicht: {
		darstellung: 'Darstellung',
		ansicht: 'Ansicht',
		beschriftung: 'Beschriftung',
		beschriftungTitel: 'Straßen- und Flurnamen ins Blatt schreiben. Wer das Bild weiterverarbeiten lässt, schaltet sie besser aus.',
		baeume: 'Bäume',
		baeumeRaum: (n: number) => `${n} Bäume aus OpenStreetMap, als Kronen im Modell. Wo der Durchmesser fehlt, sind sechs Meter angenommen.`,
		baeumeFlach: (n: number) => `${n} Bäume aus OpenStreetMap, im Kronendurchmesser gezeichnet. Wo der fehlt, sind sechs Meter angenommen.`,
		keineBaeume: 'In diesem Ausschnitt sind keine Bäume erfasst.',
		zuruecksetzen: 'Ansicht zurücksetzen',
		heraus: 'Herauszoomen',
		hinein: 'Hineinzoomen',
		ganz: 'Ganz'
	},
	rahmen: {
		ort: 'Ort',
		suche: 'Ort, Quartier oder Adresse',
		losLegen: 'Gleich loslegen:',
		verhaeltnis: 'Seitenverhältnis',
		frei: 'frei',
		ausgabebreite: 'Ausgabebreite',
		breite: 'Breite',
		hoehe: 'Höhe',
		flaeche: 'Fläche',
		ausgabe: 'Ausgabe',
		mpp: 'Meter je Pixel',
		tiefe12: '12 m Gebäudetiefe',
		traegt: (px: number) => `Tragfähig. Eine zwölf Meter tiefe Gebäudezeile ist im Bild ${px} Pixel breit. Einzelne Gebäudekanten bleiben damit unterscheidbar und nachmessbar.`,
		zuGrob: 'Zu grob. Eine zwölf Meter tiefe Gebäudezeile fällt unter zwölf Pixel, dann verschmelzen benachbarte Gebäudekanten und lassen sich nicht mehr trennen. Zieh den Rahmen kleiner oder erhöhe die Ausgabebreite.',
		leer: 'Such einen Ort oder zieh direkt ein Rechteck über die Karte. Die Maße erscheinen hier, sobald ein Rahmen steht.',
		ortAnsehen: 'Ort ansehen',
		luftbild: 'Luftbild',
		strassenansicht: 'Straßenansicht',
		gelaende: 'Gelände',
		googleHinweis: (zoom: number) => `Öffnet den Rahmen bei Google in Zoomstufe ${zoom}. Die Koordinate der Mitte steht auch im Datenvertrag, zusammen mit allen vier Verweisen.`,
		holt: 'Holt Bestandsdaten',
		erneut: 'Daten erneut holen',
		holen: 'Bestandsdaten holen'
	},
	bereinigen: {
		ebenen: 'Ebenen',
		auswahl3d: 'Auswahl im 3D-Modell',
		auswahl3dText: 'Im 3D-Modell wird nicht ausgewählt. Wechsle oben auf eine flache Darstellung, um Gebäude zu markieren, zu streichen oder als Erhalt zu setzen.',
		auswahl3dLeise: 'Das Modell zeigt immer den bereinigten Zustand: Gestrichenes fehlt darin, unabhängig davon, ob es in der Aufsicht als Geist steht. Die Ebenenschalter oben wirken dagegen auch hier.',
		gestrichen: 'Gestrichen',
		erhalt: 'Erhalt',
		werkzeug: 'Werkzeug',
		zeigen: 'Zeigen',
		polygon: 'Polygon',
		polygonHinweis: (n: number) => `Klick setzt Punkte auf dem Blatt, rechte Maustaste nimmt den letzten zurück. ${n} ${n === 1 ? 'Punkt' : 'Punkte'} gesetzt.`,
		auswaehlen: 'Auswählen',
		alsPlangebiet: 'Als Plangebiet',
		abbrechen: 'Abbrechen',
		einzelnHinweis: 'Einzeln anklicken, mit gedrückter Umschalttaste mehrere. Für ganze Quartiere ist das Polygon schneller.',
		auswahl: 'Auswahl',
		gewaehlt: (n: number) => `${n} ${n === 1 ? 'Objekt' : 'Objekte'} gewählt.`,
		nichts: 'Nichts gewählt.',
		streichen: 'Streichen',
		erhalten: 'Erhalten',
		zurueck: 'Zurück',
		umkehren: 'Umkehren',
		aufheben: 'Aufheben',
		allesZurueck: 'Alles zurücksetzen',
		sichtbarkeit: 'Sichtbarkeit',
		zeigeGestrichen: 'Gestrichenes zeigen',
		ausblenden: 'ausblenden',
		sichtbarkeitHinweis: 'Gestrichene Objekte verschwinden nicht aus der Buchführung. Ausgeblendet zeigt das Blatt den bereinigten Zustand, eingeblendet stehen sie als durchgestrichener Geist darin. Namentlich stehen sie so oder so im Datenvertrag.',
		plangebiet: 'Plangebiet',
		umriss: 'Umriss',
		punkte: (n: number) => `${n} Punkte`,
		beschnitten: 'beschnitten',
		freiraeumen: 'Freiräumen',
		loeschen: 'Löschen',
		geraeumt: (f: number, l: number) => `${f} Flächen gestrichen, ${l} ${l === 1 ? 'Linie' : 'Linien'} an der Grenze beschnitten.`,
		freiraeumenHinweis: 'Freiräumen streicht alle Flächen im Gebiet und schneidet Straßen, Wege und Gleise an der Grenze ab, sodass sie draußen weiterlaufen. Was du vorher als Erhalt markiert hast, bleibt stehen, und Wasser bleibt ebenfalls: Ein Hafenbecken ist Gelände, keine bauliche Substanz.',
		daten: 'Was die Daten hergeben',
		gebaeude: 'Gebäude',
		teile: 'Gebäudeteile',
		mitHoehe: 'mit gemessener Höhe',
		von: (a: number, b: number) => `${a} von ${b}`,
		mitAdresse: 'mit Adresse',
		denkmal: 'Denkmalstatus',
		hoehenHinweis: 'Der Rest bekommt seine Höhe aus der Geschosszahl, sonst acht Meter. Im Modell trägt jeder geschätzte Körper das im Namen.',
		teileHinweis: 'Gebäudeteile — Staffelgeschosse, Türme, Anbauten — stehen im Modell und im Paket, werden hier aber nicht zu den Gebäuden gezählt: Sie liegen in ihnen.',
		netz: 'Straßennetz',
		kanten: (n: number) => `${n} Kanten`,
		punkteZeile: 'Punkte',
		haltestellen: 'Haltestellen',
		baeume: 'Bäume',
		nutzflaechen: 'Nutzungsflächen',
		uebriges: 'Übriges',
		allesHinweis: 'Nolli holt alles, was OpenStreetMap im Rahmen kennt, und legt es ins Paket. Gezeichnet wird davon nur ein Teil; die Darstellung „Datentiefe" zeigt, wie dicht der Ausschnitt erfasst ist.',
		baustellen: 'Baustellen',
		baustellenHinweis: 'Gestrichelt umrandete Flächen sind in OpenStreetMap als Baustelle erfasst, nicht als Gebäude. Dort steht oder entsteht etwas, das noch keine Geometrie hat. Sie gehen nicht ins Modell und nicht in die Kubatur.',
		weiter: 'Weiter zur Ausgabe'
	},
	ausgeben: {
		bild: 'Bild',
		darstellung: 'Darstellung',
		beschriftung: 'Beschriftung',
		baeume: 'Bäume',
		groesse: 'Größe',
		ja: 'ja',
		nein: 'nein',
		jaN: (n: number) => `ja, ${n}`,
		beschriftungHinweis: 'Beschriftung gehört aus, wenn das Bild weiterverarbeitet wird. Schrift im Plan wird sonst als Geometrie missverstanden.',
		weitere: 'Weitere Dateien',
		paket: 'Paket',
		paketZeile: (n: number) => `ZIP · ${n} Dateien`,
		paketWas: 'Alle Darstellungen, alle Daten, Modell, Zeichnung und der Vertrag dazu',
		schreibt: 'schreibt …',
		zeichnung: 'Zeichnung',
		zeichnungZeile: (n: number) => `DXF · ${n} Ebenen`,
		zeichnungWas: 'Meter, Ursprung linke untere Rahmenecke',
		modell: 'Modell',
		modellZeile: (n: number, k: number) => `ZIP · OBJ · ${n.toLocaleString('de-DE')} Körper${k ? ` · ${k.toLocaleString('de-DE')} Kronen` : ''}`,
		modellWas: (gelaende: boolean, kronen: boolean) =>
			`Baukörper, ${gelaende ? 'Gelände' : 'ebener Grund'} mit Textur${kronen ? ', Baumkronen' : ''} und Material für Rhino — was die 3D-Ansicht zeigt. Gelände und Bäume dort schalten. Z nach oben, Ursprung auf der Rahmenecke`,
		vertrag: 'Datenvertrag',
		vertragWas: 'Bbox, Gitter, Pixelmaße, Halteliste des Bestands',
		zeichnet: 'Zeichnet das Blatt …',
		bildAusgeben: (w: number, h: number) => `Bild ausgeben · ${w} × ${h}`,
		fehlgeschlagen: 'Die Ausgabe ist fehlgeschlagen.',
		paketBild: (n: number, von: number) => `Bild ${n} von ${von}`,
		paket3d: '3D-Bild',
		paketDaten: 'Daten',
		paketPackt: 'packt'
	},
	fuss: {
		gitterTitel: 'Das Gitter wird am Plangebiet aufgespannt: Mittelmeridian in der Mitte, Maßstab genau 1.',
		gitter: (lon: string) => `Ortsgitter ${lon}° · Maßstab 1,0`,
		aufA1: (m: string) => `1 : ${m} auf A1`,
		nordTitel: 'Restlicher Winkel zwischen Gitternord und geographisch Nord an der Rahmenkante. Null in der Mitte, weil das Gitter dort aufgespannt ist.',
		nord: (g: string) => `Nordabweichung ${g}°`,
		objekte: (n: number) => `${n} Objekte`,
		gesichertTitel: 'Rahmen, Bestand und Bearbeitung liegen im Browser. Beim nächsten Öffnen ist alles wieder da.',
		gesichert: (u: string) => `gesichert ${u}`,
		keinRahmen: 'Kein Rahmen gesetzt',
		osm: 'ODbL · © OpenStreetMap-Mitwirkende',
		kacheln: (q: string) => `Kacheln ${q}`,
		keine: 'keine'
	},
	karte: {
		nord: 'Nord',
		laedt: 'Kartenbild wird geladen …',
		keinBild: 'Kein Kartenbild. OpenFreeMap antwortet gerade nicht. Rechteck, Gitter und Bestandsdaten rechnen in Metern und arbeiten weiter; nur der Hintergrund fehlt.',
		ziehen: 'Zieh ein Rechteck über das Gebiet',
		neu: 'Neu aufziehen',
		einpassen: 'Rahmen einpassen',
		ausblenden: 'Rahmen ausblenden',
		einblenden: 'Rahmen einblenden'
	},
	raum: {
		nichtBereit: 'Die Raumansicht ist nicht bereit.',
		massstabTitel: 'Gilt für waagerechte Strecken in der Tiefe des Blickpunkts. In einer Perspektive ist Vorderes größer abgebildet als Hinteres.',
		nordTitel: 'Gitternord. Die Abweichung zu geographisch Nord steht in der Fußzeile; in der Rahmenmitte ist sie null.',
		norden: 'Norden',
		wink: 'Ziehen dreht · rechte Taste oder Umschalt schiebt · Rad zoomt'
	},
	laden: {
		frage: 'Frage die Auskunft',
		sortiere: (n: string) => `${n} Elemente, sortiere den Bestand`,
		netz: 'Baue das Straßennetz',
		punkte: 'Lese Punkte und Haltestellen',
		rest: 'Sammle, was übrig ist',
		leer: 'In diesem Rahmen liegen keine erfassten Objekte. Wähle einen anderen Ausschnitt.',
		unbekannt: 'Unbekannter Fehler beim Laden.',
		beispielFehlt: 'Das Beispiel liegt nicht bereit.',
		beispielFehler: 'Das Beispiel ließ sich nicht laden.'
	},
	quelle: {
		zuGross: (km2: string, max: number) => `Der Rahmen umfasst ${km2} km². Mehr als ${max} km² lehnt die Datenquelle ab. Zieh ihn kleiner.`,
		warten: (s: number) => `Noch ${s} Sekunden warten. Die Datenquelle ist eine Spende der Gemeinschaft.`,
		geladen: (mb: string) => `${mb} geladen, wird gelesen`,
		geladenKurz: (mb: string) => `${mb} geladen`,
		ohneDaten: (n: string) => `${n} schickte eine Antwort ohne Daten`,
		ausgelastet: (n: string) => `${n} ist ausgelastet`,
		ausgelastetWeiter: (n: string) => `${n} ist ausgelastet, nächster Versuch`,
		status: (n: string, s: number) => `${n} antwortete mit ${s}`,
		verstummt: (n: string) => `${n} verstummte mitten in der Antwort`,
		unerreichbar: (n: string) => `${n} war nicht erreichbar`,
		versuche: (v: number, s: number) => `${v} Versuche an ${s} Spiegeln`,
		gestoert: (wie: string, letzter: string) => `Die OpenStreetMap-Auskunft ist gerade gestört, ${wie} blieben ohne Daten. Zuletzt: ${letzter}. Das liegt nicht am Rahmen. Nimm ein Beispielgebiet oder versuch es in ein paar Minuten noch einmal.`,
		keine: (wie: string, letzter: string) => `Keine Datenquelle erreichbar, ${wie}. ${letzter}. In einer Minute noch einmal versuchen.`,
		ortssuche: 'Die Ortssuche antwortet nicht. Versuch es in einem Moment noch einmal.'
	},
	gelaende: {
		schalter: 'Gelände',
		titelAus: 'Höhen aus einem offenen Höhenmodell holen: Häuser stehen auf dem Gelände, die Zeichnung bekommt Höhenlinien. Rund 25–30 m Raster, für den Maßstab eines Masterplans.',
		titelAn: (min: string, max: string, q: string) => `Gelände von ${min} bis ${max} m über dem Meer. Quelle: ${q}. Rund 25–30 m Raster; die meisten Modelle messen die Oberfläche, Bebauung und Wald heben sie leicht an.`,
		laedt: (s: string) => `Gelände ${s}`,
		titelFlach: (an: boolean) => `Das Gelände ist nur im 3D-Modell zu sehen; dort ein- und ausschalten. Für das Paket ist es gerade ${an ? 'an: Höhenlinien und Geländenetz kommen mit' : 'aus: ebene Platte'}.`,
		fehler: (m: string) => `Das Höhenmodell ließ sich nicht laden (${m}). Das Gelände bleibt aus; das Paket rechnet auf ebener Platte.`,
		zeile: 'Gelände',
		spanne: (min: string, max: string) => `${min}–${max} m ü. M.`,
		eben: 'eben',
		hinweis: (a: number) => `Häuser stehen auf der tiefsten Geländehöhe unter ihrem Grundriss. Höhenlinien alle ${a} m, jede fünfte als Hauptlinie. Höhen in Metern über dem Meer.`
	},
	bild: {
		keineLeinwand: 'Der Browser stellt keine Zeichenfläche bereit.',
		nichtErzeugt: 'Das Bild ließ sich nicht erzeugen.'
	},
	darstellungen: {
		schwarzplan: { name: 'Schwarzplan', zweck: 'Figur und Grund. Der Regelfall, und was ein Bildmodell am besten liest.' },
		invertiert: { name: 'Invertiert', zweck: 'Weiß auf Schwarz. Zeigt den öffentlichen Raum als Figur statt als Rest.' },
		linie: { name: 'Linie', zweck: 'Nur Konturen, weiß hinterlegt. Für Plots und für die Kantenerkennung.' },
		nutzung: { name: 'Nutzung', zweck: 'Gebäude nach Art eingefärbt. Arbeitet dem Programmschritt vor.' },
		modellaufsicht: { name: 'Aufsicht', zweck: 'Das 3D-Modell von oben. Farben und Kontraste der Raumansicht, Baukörper plastisch mit Schlagschatten aus der Geschosszahl.' },
		weissmodell: { name: 'Weißmodell', zweck: 'Aufsicht auf das 3D-Modell: plastische Baukörper mit Schlagschatten und Fußsaum, unter derselben Sonne. Höhen aus der Geschosszahl.' },
		datentiefe: { name: 'Datentiefe', zweck: 'Wie gut OpenStreetMap den Ausschnitt kennt. Jedes Objekt nach der Zahl seiner Merkmale eingefärbt, von blass bis dicht. Kein Gütesiegel, sondern eine Auskunft darüber, worauf die späteren Zahlen stehen.' },
		modell3d: { name: '3D-Modell', zweck: 'Arbeitsmodell in drei Dimensionen. Die Höhen stammen aus der Geschosszahl, sind also Annäherung, nicht Aufmaß.' }
	} as Record<string, { name: string; zweck: string }>,
	stifte: {
		gruen: 'Grün', wasser: 'Wasser', bahn: 'Bahn', strasse: 'Straßen', bau: 'Im Bau',
		gebaeude: 'Gebäude', baum: 'Bäume', erhalt: 'Erhalt', gestrichen: 'Gestrichen',
		plangebiet: 'Plangebiet', rahmen: 'Rahmen'
	} as Record<StiftId, string>,
	nutzung: {
		wohnen: 'Wohnen', gewerbe: 'Gewerbe und Handel', oeffentlich: 'Öffentlich',
		neben: 'Nebenanlagen', unbestimmt: 'unbestimmt'
	} as Record<Nutzungsklasse, string>
};

const en: typeof de = {
	schritte: {
		1: { name: 'Frame', was: 'Choose a place and set the extent' },
		2: { name: 'Clean up', was: 'Mark and remove existing fabric' },
		3: { name: 'Export', was: 'Image, drawing, model, contract' }
	},
	kopf: {
		schritteLabel: 'Steps',
		erstRahmen: 'Set the frame and fetch the data first',
		schema: 'Switch light/dark',
		sprache: 'Language',
		anleitung: 'Read me',
		anleitungTitel: 'What Nolli does and how the package is built. README on GitHub.'
	},
	meldungSchliessen: 'Close message',
	sicht: {
		darstellung: 'Style',
		ansicht: 'View',
		beschriftung: 'Labels',
		beschriftungTitel: 'Write street and place names onto the sheet. Turn them off if the image will be processed further.',
		baeume: 'Trees',
		baeumeRaum: (n) => `${n} trees from OpenStreetMap, as crowns in the model. Where the diameter is missing, six metres are assumed.`,
		baeumeFlach: (n) => `${n} trees from OpenStreetMap, drawn at crown diameter. Where it is missing, six metres are assumed.`,
		keineBaeume: 'No trees are mapped in this extent.',
		zuruecksetzen: 'Reset view',
		heraus: 'Zoom out',
		hinein: 'Zoom in',
		ganz: 'Fit'
	},
	rahmen: {
		ort: 'Place',
		suche: 'Place, district or address',
		losLegen: 'Try right away:',
		verhaeltnis: 'Aspect ratio',
		frei: 'free',
		ausgabebreite: 'Output width',
		breite: 'Width',
		hoehe: 'Height',
		flaeche: 'Area',
		ausgabe: 'Output',
		mpp: 'Metres per pixel',
		tiefe12: '12 m building depth',
		traegt: (px) => `Sufficient. A twelve-metre-deep row of buildings is ${px} pixels wide in the image. Individual building edges stay distinguishable and measurable.`,
		zuGrob: 'Too coarse. A twelve-metre-deep row of buildings drops below twelve pixels, so neighbouring building edges merge and can no longer be separated. Make the frame smaller or raise the output width.',
		leer: 'Search for a place or drag a rectangle straight onto the map. The dimensions appear here as soon as a frame is set.',
		ortAnsehen: 'View the site',
		luftbild: 'Aerial',
		strassenansicht: 'Street View',
		gelaende: 'Terrain',
		googleHinweis: (zoom) => `Opens the frame in Google at zoom level ${zoom}. The centre coordinate is also in the data contract, together with all four links.`,
		holt: 'Fetching existing data',
		erneut: 'Fetch data again',
		holen: 'Fetch existing data'
	},
	bereinigen: {
		ebenen: 'Layers',
		auswahl3d: 'Selecting in the 3D model',
		auswahl3dText: 'Nothing can be selected in the 3D model. Switch to a flat style above to mark buildings, remove them or keep them.',
		auswahl3dLeise: 'The model always shows the cleaned-up state: removed objects are missing, whether or not they show as ghosts in the plan view. The layer switches above still apply here.',
		gestrichen: 'Removed',
		erhalt: 'Kept',
		werkzeug: 'Tool',
		zeigen: 'Pick',
		polygon: 'Polygon',
		polygonHinweis: (n) => `Click to set points on the sheet, right-click removes the last one. ${n} ${n === 1 ? 'point' : 'points'} set.`,
		auswaehlen: 'Select',
		alsPlangebiet: 'As site area',
		abbrechen: 'Cancel',
		einzelnHinweis: 'Click to pick one, hold Shift for several. For whole districts the polygon is faster.',
		auswahl: 'Selection',
		gewaehlt: (n) => `${n} ${n === 1 ? 'object' : 'objects'} selected.`,
		nichts: 'Nothing selected.',
		streichen: 'Remove',
		erhalten: 'Keep',
		zurueck: 'Reset',
		umkehren: 'Invert',
		aufheben: 'Clear',
		allesZurueck: 'Reset everything',
		sichtbarkeit: 'Visibility',
		zeigeGestrichen: 'Show removed',
		ausblenden: 'hide',
		sichtbarkeitHinweis: 'Removed objects stay in the record. Hidden, the sheet shows the cleaned-up state; shown, they appear as struck-through ghosts. Either way they are listed by name in the data contract.',
		plangebiet: 'Site area',
		umriss: 'Outline',
		punkte: (n) => `${n} points`,
		beschnitten: 'clipped',
		freiraeumen: 'Clear site',
		loeschen: 'Delete',
		geraeumt: (f, l) => `${f} areas removed, ${l} ${l === 1 ? 'line' : 'lines'} clipped at the boundary.`,
		freiraeumenHinweis: 'Clear site removes all areas inside it and cuts streets, paths and tracks at the boundary so they continue outside. Whatever you marked as kept stays, and so does water: a harbour basin is ground, not built fabric.',
		daten: 'What the data holds',
		gebaeude: 'Buildings',
		teile: 'Building parts',
		mitHoehe: 'with measured height',
		von: (a, b) => `${a} of ${b}`,
		mitAdresse: 'with address',
		denkmal: 'Listed status',
		hoehenHinweis: 'The rest gets its height from the number of storeys, otherwise eight metres. In the model every estimated body says so in its name.',
		teileHinweis: 'Building parts — setback storeys, towers, annexes — are in the model and the package but are not counted as buildings here: they sit inside them.',
		netz: 'Street network',
		kanten: (n) => `${n} edges`,
		punkteZeile: 'Points',
		haltestellen: 'Stops',
		baeume: 'Trees',
		nutzflaechen: 'Land-use areas',
		uebriges: 'Other',
		allesHinweis: 'Nolli fetches everything OpenStreetMap knows inside the frame and puts it in the package. Only part of it is drawn; the “Data depth” style shows how densely the extent is mapped.',
		baustellen: 'Construction sites',
		baustellenHinweis: 'Areas with a dashed outline are mapped in OpenStreetMap as construction sites, not as buildings. Something stands or is going up there that has no geometry yet. They go neither into the model nor into the massing.',
		weiter: 'Continue to export'
	},
	ausgeben: {
		bild: 'Image',
		darstellung: 'Style',
		beschriftung: 'Labels',
		baeume: 'Trees',
		groesse: 'Size',
		ja: 'yes',
		nein: 'no',
		jaN: (n) => `yes, ${n}`,
		beschriftungHinweis: 'Turn labels off if the image will be processed further. Otherwise text in the plan gets mistaken for geometry.',
		weitere: 'More files',
		paket: 'Package',
		paketZeile: (n) => `ZIP · ${n} files`,
		paketWas: 'All styles, all data, model, drawing and the contract that goes with them',
		schreibt: 'writing …',
		zeichnung: 'Drawing',
		zeichnungZeile: (n) => `DXF · ${n} layers`,
		zeichnungWas: 'Metres, origin at the lower-left frame corner',
		modell: 'Model',
		modellZeile: (n, k) => `ZIP · OBJ · ${n.toLocaleString('en-GB')} bodies${k ? ` · ${k.toLocaleString('en-GB')} crowns` : ''}`,
		modellWas: (gelaende, kronen) =>
			`Buildings, ${gelaende ? 'terrain' : 'flat ground'} with texture${kronen ? ', tree crowns' : ''} and materials for Rhino — what the 3D view shows. Switch terrain and trees there. Z up, origin at the frame corner`,
		vertrag: 'Data contract',
		vertragWas: 'Bbox, grid, pixel dimensions, record of existing fabric',
		zeichnet: 'Drawing the sheet …',
		bildAusgeben: (w, h) => `Export image · ${w} × ${h}`,
		fehlgeschlagen: 'The export failed.',
		paketBild: (n, von) => `Image ${n} of ${von}`,
		paket3d: '3D image',
		paketDaten: 'Data',
		paketPackt: 'packing'
	},
	fuss: {
		gitterTitel: 'The grid is centred on the site: central meridian in the middle, scale exactly 1.',
		gitter: (lon) => `Local grid ${lon}° · scale 1.0`,
		aufA1: (m) => `1 : ${m} on A1`,
		nordTitel: 'Remaining angle between grid north and true north at the frame edge. Zero in the middle, because the grid is centred there.',
		nord: (g) => `North deviation ${g}°`,
		objekte: (n) => `${n} objects`,
		gesichertTitel: 'Frame, data and edits are kept in the browser. Everything is back the next time you open it.',
		gesichert: (u) => `saved ${u}`,
		keinRahmen: 'No frame set',
		osm: 'ODbL · © OpenStreetMap contributors',
		kacheln: (q) => `Tiles ${q}`,
		keine: 'none'
	},
	karte: {
		nord: 'North',
		laedt: 'Loading map …',
		keinBild: 'No map image. OpenFreeMap is not responding right now. Frame, grid and data work in metres and carry on; only the background is missing.',
		ziehen: 'Drag a rectangle over the area',
		neu: 'Draw again',
		einpassen: 'Fit frame',
		ausblenden: 'Hide frame',
		einblenden: 'Show frame'
	},
	raum: {
		nichtBereit: 'The 3D view is not ready.',
		massstabTitel: 'Applies to horizontal distances at the depth of the focal point. In perspective, near things appear larger than far ones.',
		nordTitel: 'Grid north. The deviation from true north is in the footer; at the frame centre it is zero.',
		norden: 'North',
		wink: 'Drag to orbit · right button or Shift to pan · wheel to zoom'
	},
	laden: {
		frage: 'Querying the service',
		sortiere: (n) => `${n} elements, sorting the data`,
		netz: 'Building the street network',
		punkte: 'Reading points and stops',
		rest: 'Collecting what is left',
		leer: 'There are no mapped objects in this frame. Choose a different extent.',
		unbekannt: 'Unknown error while loading.',
		beispielFehlt: 'The example is not available.',
		beispielFehler: 'The example could not be loaded.'
	},
	quelle: {
		zuGross: (km2, max) => `The frame covers ${km2} km². The data source refuses more than ${max} km². Make it smaller.`,
		warten: (s) => `Please wait ${s} more seconds. The data source is a donation from the community.`,
		geladen: (mb) => `${mb} loaded, reading`,
		geladenKurz: (mb) => `${mb} loaded`,
		ohneDaten: (n) => `${n} sent a response without data`,
		ausgelastet: (n) => `${n} is busy`,
		ausgelastetWeiter: (n) => `${n} is busy, trying again`,
		status: (n, s) => `${n} answered with ${s}`,
		verstummt: (n) => `${n} went silent mid-response`,
		unerreichbar: (n) => `${n} could not be reached`,
		versuche: (v, s) => `${v} attempts on ${s} mirrors`,
		gestoert: (wie, letzter) => `The OpenStreetMap service is having trouble right now, ${wie} returned no data. Last: ${letzter}. It is not the frame. Use an example area or try again in a few minutes.`,
		keine: (wie, letzter) => `No data source reachable, ${wie}. ${letzter}. Try again in a minute.`,
		ortssuche: 'The place search is not responding. Try again in a moment.'
	},
	gelaende: {
		schalter: 'Terrain',
		titelAus: 'Fetch heights from an open elevation model: buildings stand on the terrain, the drawing gets contour lines. Roughly 25–30 m resolution, for masterplan scale.',
		titelAn: (min, max, q) => `Terrain from ${min} to ${max} m above sea level. Source: ${q}. Roughly 25–30 m resolution; most models measure the surface, so buildings and forest raise it slightly.`,
		laedt: (s) => `Terrain ${s}`,
		titelFlach: (an) => `Terrain is only visible in the 3D model; switch it on and off there. For the package it is currently ${an ? 'on: contours and terrain mesh are included' : 'off: flat plate'}.`,
		fehler: (m) => `The elevation model could not be loaded (${m}). Terrain stays off; the package is computed on a flat plate.`,
		zeile: 'Terrain',
		spanne: (min, max) => `${min}–${max} m a.s.l.`,
		eben: 'flat',
		hinweis: (a) => `Buildings stand on the lowest terrain height under their footprint. Contours every ${a} m, every fifth as a major line. Heights in metres above sea level.`
	},
	bild: {
		keineLeinwand: 'The browser provides no drawing surface.',
		nichtErzeugt: 'The image could not be created.'
	},
	darstellungen: {
		schwarzplan: { name: 'Figure-ground', zweck: 'Figure and ground. The standard case, and what an image model reads best.' },
		invertiert: { name: 'Inverted', zweck: 'White on black. Shows public space as the figure instead of the remainder.' },
		linie: { name: 'Line', zweck: 'Outlines only, on white. For plots and for edge detection.' },
		nutzung: { name: 'Use', zweck: 'Buildings coloured by type. Prepares the programme step.' },
		modellaufsicht: { name: 'Top view', zweck: 'The 3D model from above. Colours and contrast of the 3D view, buildings modelled with cast shadows from the number of storeys.' },
		weissmodell: { name: 'White model', zweck: 'Top view of the 3D model: modelled buildings with cast shadows and a base line, under the same sun. Heights from the number of storeys.' },
		datentiefe: { name: 'Data depth', zweck: 'How well OpenStreetMap knows the extent. Each object coloured by the number of its tags, from faint to dense. Not a seal of quality, but a statement of what the later figures rest on.' },
		modell3d: { name: '3D model', zweck: 'Working model in three dimensions. Heights come from the number of storeys, so they are an approximation, not a survey.' }
	},
	stifte: {
		gruen: 'Green', wasser: 'Water', bahn: 'Rail', strasse: 'Streets', bau: 'Under construction',
		gebaeude: 'Buildings', baum: 'Trees', erhalt: 'Kept', gestrichen: 'Removed',
		plangebiet: 'Site area', rahmen: 'Frame'
	},
	nutzung: {
		wohnen: 'Residential', gewerbe: 'Commercial and retail', oeffentlich: 'Public',
		neben: 'Ancillary', unbestimmt: 'undetermined'
	}
};

/** Das englische Wörterbuch, für Texte im Datenvertrag. Der ist englisch, gleich welche Sprache gewählt ist. */
export const englisch = en;

/** Das Wörterbuch der gewählten Sprache. In Vorlagen gelesen, meldet es sich bei jedem Wechsel. */
export const t = () => (sprache.jetzt === 'en' ? en : de);
