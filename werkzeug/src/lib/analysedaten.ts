import { nachGitter, type Gitter } from './geo/utm';

/**
 * Daten, die nicht auf das Blatt gehen, aber in den Datenvertrag.
 *
 * Der Zeichner braucht von einer Strasse ihren Verlauf und von einer
 * Nutzungsflaeche gar nichts. Wer spaeter Erreichbarkeit, Netzdichte oder
 * Nutzungsmischung rechnet, braucht beides — und zwar aus derselben Abfrage,
 * damit das Paket ein eingefrorener Stand bleibt und nicht aus zwei Zeitpunkten
 * zusammengesetzt ist.
 *
 * Beides kostet keine zusaetzliche Abfrage bei der Auskunft: Die Merkmale der
 * Wege kommen ohnehin mit, und die Nutzungsflaechen sind ein paar Werte mehr
 * in derselben Zeile.
 */

/**
 * Das Strassennetz als Graph statt als Linienhaufen.
 *
 * Der Zeichner braucht von einer Strasse nur ihren Verlauf. Wer Erreichbarkeit,
 * Netzdichte oder Strassenraeume rechnen will, braucht die Topologie: welche
 * Kante endet an welchem Knoten. Beides steckt in derselben Antwort — Overpass
 * liefert zu jedem Weg neben der Geometrie auch die Kennungen seiner Knoten,
 * und zwei Wege, die sich kreuzen, teilen dort dieselbe Kennung.
 *
 * Gebaut wird also nichts nachgeschlagen und nichts geraten: Ein Knoten des
 * Graphen ist ein Punkt, an dem mindestens zwei Wege haengen, oder das Ende
 * eines Weges. Dazwischen liegt je eine Kante mit ihrer vollen Linie.
 *
 * Kostet keine zusaetzliche Abfrage. Die Merkmale an den Kanten — Tempo,
 * Fahrstreifen, Gehweg, Belag — kommen aus denselben Merkmalen, die der
 * Zeichner bisher weggeworfen hat.
 */

/** Was von den Merkmalen eines Weges mitgenommen wird. */
const MERKMALE = [
	'name', 'highway', 'maxspeed', 'lanes', 'oneway', 'surface', 'width',
	'sidewalk', 'sidewalk:both', 'sidewalk:left', 'sidewalk:right',
	'cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right',
	'access', 'service', 'bridge', 'tunnel', 'layer', 'junction'
] as const;
// `lit` ist bewusst nicht dabei: Es haengt an 93 Prozent der Kanten und traegt
// zu keiner der Rechnungen bei, fuer die dieser Graph gedacht ist.

export type Kante = {
	von: number; bis: number;
	laenge_m: number;
	/** Der Weg, aus dem die Kante stammt. Mehrere Kanten je Weg sind normal. */
	weg: string;
	/**
	 * Der Linienzug im Ortsgitter, Anfang und Ende eingeschlossen.
	 *
	 * Fehlt bei einer geraden Strecke — dort stehen die beiden Punkte schon
	 * als Knoten. Zwei Drittel der Kanten sind gerade.
	 */
	punkte?: [number, number][];
	/** Dazu die Merkmale des Weges, siehe MERKMALE. */
	[merkmal: string]: unknown;
};

export type Netz = {
	/** Index im Feld ist die Knotennummer: [OSM-Kennung, Ost, Nord]. */
	knoten: [number, number, number][];
	kanten: Kante[];
};

type Roh = {
	type: string; id: number;
	tags?: Record<string, string>;
	nodes?: number[];
	lat?: number; lon?: number;
	geometry?: { lat: number; lon: number }[];
	members?: { role?: string; geometry?: { lat: number; lon: number }[] }[];
};

export function netzAus(roh: { elements: Roh[] }, gitter: Gitter): Netz {
	const wege = (roh.elements ?? []).filter(
		(e) => e.type === 'way' && e.tags?.highway && e.nodes?.length && e.geometry?.length
			&& e.nodes.length === e.geometry.length
	);

	// Wie oft haengt ein Punkt an einem Weg? Zweimal oder oefter heisst Kreuzung.
	const grad = new Map<number, number>();
	for (const w of wege) for (const n of w.nodes!) grad.set(n, (grad.get(n) ?? 0) + 1);

	const nummer = new Map<number, number>();
	const knoten: [number, number, number][] = [];
	const merke = (osm: number, x: number, y: number) => {
		let i = nummer.get(osm);
		if (i === undefined) {
			i = knoten.length;
			nummer.set(osm, i);
			knoten.push([osm, r1(x), r1(y)]);
		}
		return i;
	};

	const kanten: Kante[] = [];
	for (const w of wege) {
		const p = w.geometry!.map((g) => {
			const q = nachGitter(g.lon, g.lat, gitter);
			return [q.x, q.y] as [number, number];
		});
		const ids = w.nodes!;
		const ist = (i: number) => i === 0 || i === ids.length - 1 || (grad.get(ids[i]) ?? 0) > 1;

		const merkmale: Record<string, string> = {};
		for (const k of MERKMALE) if (w.tags?.[k] !== undefined) merkmale[k] = w.tags[k];

		let a = 0;
		for (let i = 1; i < ids.length; i++) {
			if (!ist(i)) continue;
			const stueck = p.slice(a, i + 1);
			let laenge = 0;
			for (let k = 1; k < stueck.length; k++)
				laenge += Math.hypot(stueck[k][0] - stueck[k - 1][0], stueck[k][1] - stueck[k - 1][1]);
			// Ein Ring kann auf sich selbst zurueckfallen; eine Kante der Laenge
			// null traegt nichts und stoert jede Wegrechnung.
			if (laenge > 0.05)
				kanten.push({
					von: merke(ids[a], p[a][0], p[a][1]),
					bis: merke(ids[i], p[i][0], p[i][1]),
					laenge_m: r1(laenge),
					weg: `w${w.id}`,
					...(stueck.length > 2
						? { punkte: stueck.map(([x, y]) => [r1(x), r1(y)] as [number, number]) }
						: {}),
					...merkmale
				});
			a = i;
		}
	}
	return { knoten, kanten };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Nutzungsflaechen. Gehen in den Vertrag, nicht auf das Blatt.
 *
 * Als Ebene waeren sie grosse graue Rechtecke ueber allem und zeigten nichts,
 * was der Schwarzplan nicht besser sagt. Fuer die Analyse sind sie die
 * Schicht, auf der Nutzungsmischung und Dichte gerechnet werden.
 *
 * Zur Erwartung: In deutschen Staedten ist diese Schicht oft duenn. In
 * Altona-Nord traegt genau eine Flaeche ein `landuse=residential`.
 */
export const NUTZUNG = new Set(['residential', 'commercial', 'industrial', 'retail',
	'education', 'institutional', 'military', 'farmland', 'brownfield', 'greenfield',
	'quarry', 'port', 'depot', 'railway']);

export type Nutzflaeche = {
	id: string; art: string; name?: string;
	flaeche_m2: number;
	ringe: [number, number][][];
};

export function nutzflaechenAus(roh: { elements: Roh[] }, gitter: Gitter): Nutzflaeche[] {
	const aus: Nutzflaeche[] = [];
	for (const e of roh.elements ?? []) {
		const art = e.tags?.landuse ?? '';
		if (!NUTZUNG.has(art)) continue;
		const ringe = (e.geometry?.length ? [e.geometry] : [])
			.map((g) => g.map((p) => {
				const q = nachGitter(p.lon, p.lat, gitter);
				return [r1(q.x), r1(q.y)] as [number, number];
			}))
			.filter((ring) => ring.length >= 4);
		if (!ringe.length) continue;
		aus.push({
			id: `${e.type[0]}${e.id}`, art, name: e.tags?.name,
			flaeche_m2: Math.round(ringe.reduce((n, ring) => n + Math.abs(flaeche(ring)), 0)),
			ringe
		});
	}
	return aus;
}

/** Vorzeichenbehaftete Flaeche eines Rings. */
function flaeche(r: [number, number][]): number {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
	return s / 2;
}

/**
 * Was ein Punkt von Interesse ist, in der Reihenfolge der Aussagekraft.
 *
 * Ein Objekt traegt oft mehrere dieser Merkmale — eine Apotheke ist
 * `amenity=pharmacy` und `healthcare=pharmacy`. Genommen wird das erste
 * passende, damit jeder Punkt genau eine Art hat und sich zaehlen laesst.
 */
const POIWERTE = ['amenity', 'shop', 'healthcare', 'office', 'tourism', 'leisure'] as const;

/**
 * Grobe Gruppe je Art, damit sich die Punkte sortieren lassen.
 *
 * Ohne sie ist die Liste unbrauchbar: In Altona-Nord sind 299 der 2.388 Punkte
 * Fahrradbuegel, 265 Baenke und 187 Papierkoerbe. Das ist keine schlechte
 * Erfassung, sondern eine andere Frage — Stadtmoeblierung sagt etwas ueber die
 * Aufenthaltsqualitaet, nicht ueber die Nahversorgung. Wer nach Erdgeschossen
 * fragt, will `versorgung` und `gastronomie`; wer nach Aufenthalt fragt,
 * `moeblierung`. Genommen wird, was gefragt ist, und nicht, was Nolli fuer
 * wichtig haelt.
 */
const GRUPPEN: Record<string, string> = {
	restaurant: 'gastronomie', cafe: 'gastronomie', bar: 'gastronomie', pub: 'gastronomie',
	fast_food: 'gastronomie', biergarten: 'gastronomie', ice_cream: 'gastronomie',
	food_court: 'gastronomie', nightclub: 'gastronomie',
	pharmacy: 'gesundheit', doctors: 'gesundheit', dentist: 'gesundheit',
	clinic: 'gesundheit', hospital: 'gesundheit', veterinary: 'gesundheit',
	school: 'bildung', kindergarten: 'bildung', university: 'bildung', college: 'bildung',
	library: 'bildung', music_school: 'bildung', language_school: 'bildung',
	childcare: 'bildung', driving_school: 'bildung',
	bank: 'verwaltung', post_office: 'verwaltung', townhall: 'verwaltung',
	police: 'verwaltung', fire_station: 'verwaltung', courthouse: 'verwaltung',
	theatre: 'freizeit', cinema: 'freizeit', community_centre: 'freizeit',
	arts_centre: 'freizeit', place_of_worship: 'freizeit', social_facility: 'freizeit',
	marketplace: 'versorgung',
	parking: 'verkehr', bicycle_parking: 'verkehr', parking_entrance: 'verkehr',
	parking_space: 'verkehr', charging_station: 'verkehr', fuel: 'verkehr',
	car_sharing: 'verkehr', bicycle_rental: 'verkehr', car_rental: 'verkehr',
	taxi: 'verkehr', motorcycle_parking: 'verkehr',
	bench: 'moeblierung', waste_basket: 'moeblierung', vending_machine: 'moeblierung',
	drinking_water: 'moeblierung', toilets: 'moeblierung', post_box: 'moeblierung',
	recycling: 'moeblierung', shelter: 'moeblierung', fountain: 'moeblierung',
	clock: 'moeblierung', bicycle_repair_station: 'moeblierung', telephone: 'moeblierung',
	street_lamp: 'moeblierung', hunting_stand: 'moeblierung'
};

/** Fallgruppe je Schluessel, wenn der Wert nicht eigens gefuehrt ist. */
const GRUPPE_JE_SCHLUESSEL: Record<string, string> = {
	shop: 'versorgung', healthcare: 'gesundheit', office: 'verwaltung',
	tourism: 'freizeit', leisure: 'freizeit', amenity: 'sonstiges'
};

export type Poi = {
	id: string; x: number; y: number;
	art: string;
	/** versorgung, gastronomie, bildung, gesundheit, verwaltung, freizeit, verkehr, moeblierung, sonstiges */
	gruppe: string;
	name?: string;
	/** `knoten` fuer einen Punkt, `flaeche` fuer ein Objekt mit Grundriss. */
	quelle: 'knoten' | 'flaeche';
};

/**
 * Laeden, Lokale, Praxen, Buero, Freizeit — als Punkte.
 *
 * Zwei Herkuenfte: eigene Knoten aus der Abfrage, und Flaechen, die wir
 * ohnehin haben. Ein Supermarkt ist oft das Gebaeude selbst; wer nur Knoten
 * nimmt, verliert genau die grossen. Flaechen kommen mit ihrem Schwerpunkt,
 * und das steht dabei.
 */
export function poisAus(roh: { elements: Roh[] }, gitter: Gitter): Poi[] {
	const aus: Poi[] = [];
	// Die Antwort nennt manche Elemente zweimal: einmal im vollen Auszug und
	// einmal im `foreach` fuer die Haltestellen. Doppelte werden hier und in
	// `halteAus` verworfen, sonst zaehlt jede spaetere Statistik falsch.
	const gesehen = new Set<string>();
	for (const e of roh.elements ?? []) {
		const t = e.tags;
		if (!t) continue;
		const kennung = `${e.type[0]}${e.id}`;
		if (gesehen.has(kennung)) continue;
		const schluessel = POIWERTE.find((k) => t[k] && t[k] !== 'no');
		if (!schluessel) continue;

		let x: number, y: number, quelle: Poi['quelle'];
		if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
			const q = nachGitter(e.lon, e.lat, gitter);
			x = q.x; y = q.y; quelle = 'knoten';
		} else {
			const ring = e.geometry?.length ? e.geometry
				: e.members?.find((m) => m.geometry?.length)?.geometry;
			if (!ring?.length) continue;
			let sx = 0, sy = 0;
			for (const p of ring) { const q = nachGitter(p.lon, p.lat, gitter); sx += q.x; sy += q.y; }
			x = sx / ring.length; y = sy / ring.length; quelle = 'flaeche';
		}
		const wert = t[schluessel];
		gesehen.add(kennung);
		aus.push({
			id: kennung, x: r1(x), y: r1(y),
			art: `${schluessel}=${wert}`,
			gruppe: GRUPPEN[wert] ?? GRUPPE_JE_SCHLUESSEL[schluessel] ?? 'sonstiges',
			name: t.name, quelle
		});
	}
	return aus;
}

export type Haltestelle = {
	id: string; x: number; y: number;
	name?: string;
	art: string;
	/** Kennungen der Linien, die hier halten. */
	linien: string[];
};

export type Linie = { ref: string; art: string; name?: string; von?: string; nach?: string };

/**
 * Haltestellen mit Linienbezug.
 *
 * Die Abfrage gibt je Haltestelle erst den Knoten aus und dann die Merkmale
 * ihrer Routen. Die Zugehoerigkeit steckt also in der Reihenfolge: Jede
 * Relation gehoert zum zuletzt gesehenen Knoten. Das ist der Grund, warum die
 * Abfrage dort `foreach` benutzt und nicht eine Vereinigung.
 */
export function halteAus(roh: { elements: Roh[] }, gitter: Gitter) {
	const haltestellen = new Map<string, Haltestelle>();
	const linien = new Map<string, Linie>();
	let offen: Haltestelle | null = null;

	const istHalt = (t: Record<string, string>) =>
		!!t.public_transport || t.highway === 'bus_stop'
		|| ['station', 'halt', 'tram_stop'].includes(t.railway ?? '');

	for (const e of roh.elements ?? []) {
		const t = e.tags ?? {};
		if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
			if (!istHalt(t)) { offen = null; continue; }
			const q = nachGitter(e.lon, e.lat, gitter);
			// Derselbe Halt steht zweimal in der Antwort, einmal aus dem vollen
			// Auszug und einmal aus dem `foreach`. Der zweite traegt die Linien.
			const kennung = `n${e.id}`;
			offen = haltestellen.get(kennung) ?? {
				id: kennung, x: r1(q.x), y: r1(q.y), name: t.name,
				art: t.public_transport ?? (t.railway ? `railway=${t.railway}` : 'highway=bus_stop'),
				linien: []
			};
			haltestellen.set(kennung, offen);
		} else if (e.type === 'relation' && t.route && offen) {
			const ref = t.ref ?? t.name ?? `r${e.id}`;
			if (!linien.has(ref))
				linien.set(ref, { ref, art: t.route, name: t.name, von: t.from, nach: t.to });
			if (!offen.linien.includes(ref)) offen.linien.push(ref);
		}
	}
	const liste = [...haltestellen.values()];
	for (const h of liste) h.linien.sort();
	return { haltestellen: liste, linien: [...linien.values()] };
}

/**
 * Merkmale, die nur die Erfassung betreffen und niemanden sonst.
 *
 * Sie machen bei einer vollen Abfrage einen spuerbaren Teil der Masse aus und
 * sagen nichts ueber den Ort, nur ueber den, der ihn eingetragen hat.
 */
export const BUCHHALTUNG = /^(source|created_by|note|fixme|FIXME|check_date|survey|survey:date|ref:[A-Za-z_:]*|wikidata|wikipedia|import|attribution|odbl|converted_by)(:|$)/;

export type Rest = {
	id: string;
	typ: 'punkt' | 'linie' | 'flaeche';
	/** Bei einem Punkt die Lage, sonst der Schwerpunkt. */
	x: number; y: number;
	/** Bei Linie und Flaeche der Linienzug im Ortsgitter. */
	punkte?: [number, number][];
	tags: Record<string, string>;
};

/**
 * Alles, was sonst niemand genommen hat.
 *
 * Baeume, Parkflaechen, Barrieren, Adressknoten, Masten, Bruecken, Zaeune,
 * Sitzbaenke mit Namen, Briefkaesten — die lange Liste dessen, was in
 * OpenStreetMap steht und wofuer Nolli keine eigene Schublade hat. Statt je
 * Kategorie eine zu bauen und damit jetzt zu entscheiden, was eine spaetere
 * Analyse braucht, kommt alles mit, was uebrig ist, mitsamt seinen Merkmalen.
 * Reduzieren laesst sich spaeter; nachholen nicht, ohne erneut zu fragen.
 *
 * Die Merkmale der Erfassung selbst fliegen raus, siehe BUCHHALTUNG.
 */
export function restAus(roh: { elements: Roh[] }, gitter: Gitter, benutzt: Set<string>): Rest[] {
	const aus: Rest[] = [];
	const gesehen = new Set<string>();
	for (const e of roh.elements ?? []) {
		const id = `${e.type[0]}${e.id}`;
		if (benutzt.has(id) || gesehen.has(id)) continue;
		const tags = e.tags;
		if (!tags) continue;
		const sauber: Record<string, string> = {};
		for (const [k, v] of Object.entries(tags)) if (!BUCHHALTUNG.test(k)) sauber[k] = v;
		if (!Object.keys(sauber).length) continue;
		gesehen.add(id);

		if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
			const q = nachGitter(e.lon, e.lat, gitter);
			aus.push({ id, typ: 'punkt', x: r1(q.x), y: r1(q.y), tags: sauber });
			continue;
		}
		const roheLinie = e.geometry?.length
			? e.geometry
			: e.members?.find((m) => m.geometry?.length)?.geometry;
		if (!roheLinie?.length) continue;
		const punkte = roheLinie.map((p) => {
			const q = nachGitter(p.lon, p.lat, gitter);
			return [r1(q.x), r1(q.y)] as [number, number];
		});
		const a = punkte[0], z = punkte[punkte.length - 1];
		const geschlossen = punkte.length > 3
			&& Math.abs(a[0] - z[0]) < 0.2 && Math.abs(a[1] - z[1]) < 0.2;
		let sx = 0, sy = 0;
		for (const [x, y] of punkte) { sx += x; sy += y; }
		aus.push({
			id, typ: geschlossen ? 'flaeche' : 'linie',
			x: r1(sx / punkte.length), y: r1(sy / punkte.length),
			punkte, tags: sauber
		});
	}
	return aus;
}

/**
 * Die Baeume aus dem Rest, fertig zum Zeichnen.
 *
 * Der Kronendurchmesser steht an zwei von drei Baeumen; wo er fehlt, sind
 * sechs Meter angenommen. Das ist die Groessenordnung eines Strassenbaums in
 * mittlerem Alter und im Plan ein Punkt von wenigen Millimetern — genauer zu
 * tun, als die Daten sind, brächte hier nichts.
 */
/**
 * Die beiden angenommenen Zahlen am Baum, an genau einer Stelle.
 *
 * Sie standen vorher zweimal: hier als Zahl 6 und in Umbra als eigene
 * Konstante. Geaendert wurde nur eine — dasselbe Paket zeigte einen Kreis von
 * sechs Metern und eine Kugel von drei. Der Fehler war nicht die Rechnung,
 * sondern die zweite Stelle. Deshalb gehen beide Werte in den Datenvertrag,
 * und jedes Werkzeug liest sie dort statt sie zu wiederholen.
 *
 * `vorgabeKroneM` gilt fuer die Haelfte ohne `diameter_crown`. Sie ist nicht
 * hergeleitet: Der Median der gemessenen Kronen liegt bei 3,0 m, stammt aber
 * fast vollstaendig aus dem Hamburger Strassenbaumkataster — junge, schmale
 * Strassenbaeume, Median-Pflanzjahr 2012. Die Baeume ohne Kronenmass sind zu
 * 99 % handkartiert und stehen im Median 26,8 m von einer Fahrbahn entfernt.
 * Fuer die trifft der Katastermedian nicht zu, sechs Meter vermutlich eher.
 *
 * `stammhoeheM` ist der Kronenansatz. 3,0 m ist ungefaehr das Lichtraumprofil,
 * auf das Strassenbaeume geschnitten werden — also am selben Kataster
 * begruendet und auf dieselbe Gruppe angewandt, fuer die es nicht gilt. Das
 * steht hier, weil eine Annahme mit bekanntem Mangel besser ist als eine mit
 * unbekanntem.
 */
export const BAUM = {
	vorgabeKroneM: 6,
	stammhoeheM: 3,
	/**
	 * Wie weit die Krone als Koerper groesser gezeichnet wird als ihr Nennmass.
	 *
	 * Steht auf 1, also aus. Das Feld ist da, damit die Zahl einen Ort hat,
	 * bevor jemand sie braucht — die Ursache des Falls „sechs gegen drei" war
	 * nicht die falsche Zahl, sondern dass sie keinen gemeinsamen Ort hatte.
	 *
	 * Wozu sie dient: Die Krone ist im Modell ein Ikosaeder ohne Unterteilung,
	 * und ein Ikosaeder ist schmaler als die Kugel, die es vertritt. Bei
	 * Nennradius r betraegt seine Silhouette im Mittel ueber alle Richtungen
	 * 2,3936 · r² gegen 3,1416 · r² der Kugel, senkrecht von oben 2,3416 · r².
	 * Die Aufsicht zeichnet dieselbe Krone als vollen Kreis. Dasselbe Paket
	 * zeigt den Baum also zweimal verschieden gross.
	 *
	 * Zwei Faktoren bringen ihn zur Deckung, je nach Frage: 1,1456 fuer die
	 * mittlere Silhouette, auf die eine Verschattungsrechnung sieht, 1,1583
	 * fuer die Aufsicht, auf die der Kreis sieht. Beide nachgerechnet, der
	 * erste ueber Cauchy, der zweite ueber die konvexe Huelle der projizierten
	 * Ecken. Sie widersprechen sich nicht, sie beantworten zwei Fragen.
	 *
	 * Gewaehlt ist 1,1456, der Wert fuer die mittlere Silhouette. Begruendung:
	 * Der Kreis in der Aufsicht ist eine Zeichenkonvention, der Schatten ist
	 * das, was am Ende gerechnet wird. Ueber die tatsaechlich vorkommenden
	 * Sonnenhoehen von 13° bis 60° schwankt der Wert um 0,6 %.
	 *
	 * Der Wert geht in den Datenvertrag; wer ihn dort aendert, aendert beide
	 * Werkzeuge. Ein Werkzeug ohne das Feld rechnet mit 1 und zeichnet damit
	 * den Stand von vorher — schmaler, aber nicht anders als das andere.
	 */
	silhouetteFaktor: 1.1456
};

export function baeumeAus(rest: Rest[]) {
	const aus: { x: number; y: number; krone: number; gemessen: boolean }[] = [];
	for (const e of rest) {
		if (e.tags.natural !== 'tree') continue;
		const d = parseFloat(e.tags.diameter_crown ?? '');
		aus.push({
			x: e.x, y: e.y,
			krone: Number.isFinite(d) && d > 0 ? d : BAUM.vorgabeKroneM,
			gemessen: Number.isFinite(d) && d > 0
		});
	}
	return aus;
}
