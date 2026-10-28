import { nachGitter, type Gitter } from './geo/utm';
import { FAHRBAHN, type StiftId } from './stifte';
import { NUTZUNG, BUCHHALTUNG } from './analysedaten';
import { meer, type Kasten } from './geo/kueste';

export type Zustand = 'normal' | 'gestrichen' | 'erhalt';

/**
 * Ein Objekt aus OSM, bereits in Metern des Ortsgitters.
 *
 * Bewusst nicht in Pixeln: Aendert der Nutzer den Rahmen, bleiben die
 * Objekte gueltig. Pixel entstehen erst beim Zeichnen.
 */
export type Nutzungsklasse = 'wohnen' | 'gewerbe' | 'oeffentlich' | 'neben' | 'unbestimmt';

export type Objekt = {
	id: string;
	ebene: StiftId;
	art: 'flaeche' | 'linie';
	ringe: [number, number][][];
	breiteM?: number;        // nur Linien: Fahrbahnbreite
	hoeheM?: number;         // nur Gebaeude, aus Geschossen oder height
	geschosse?: number;
	hoeheGeschaetzt?: boolean;
	/**
	 * Gebaeudeteil statt Gebaeude.
	 *
	 * OpenStreetMap fuehrt mit `building:part` die Teile eines Hauses, die
	 * eigene Hoehen haben — Staffelgeschosse, Tuerme, Anbauten. Sie kommen in
	 * dieselbe Schublade wie Gebaeude, weil das Modell sie stellen muss: Ohne
	 * sie waere ein gestaffeltes Haus ein Quader.
	 *
	 * Sie sind aber keine zusaetzlichen Haeuser, sondern liegen in ihren
	 * eigenen: In der HafenCity sind es 286 Teile zu 338 Gebaeuden, und bei
	 * 275 davon (96 %) liegt der Mittelpunkt in einem Gebaeudegrundriss. Wer
	 * Koerper zaehlt, zaehlt sie mit; wer Haeuser zaehlt, zaehlt sie doppelt.
	 * Und weil ein Teil fast immer ein `height` traegt — dafuer gibt es ihn —,
	 * laesst er die Hoehenerfassung besser aussehen, als sie ist.
	 *
	 * Deshalb steht die Unterscheidung am Objekt und im Vertrag, statt dass
	 * jeder Abnehmer sie aus dem Fehlen von `nutzung` erraet.
	 */
	teil?: boolean;
	/**
	 * Nicht aus OpenStreetMap, sondern aus Overture ergänzt (`overture.ts`).
	 * `quelleGeometrie` nennt, woher der Umriss stammt, etwa „Microsoft ML
	 * Buildings“ — für die Namensnennung und für den Vertrag.
	 */
	herkunft?: 'overture';
	quelleGeometrie?: string;
	/**
	 * Denkmalstatus, wie OpenStreetMap ihn fuehrt.
	 *
	 * Steht am Objekt statt nur im Vertrag, damit man geschuetzte Bauten im
	 * Werkzeug als Erhalt setzen kann, ohne sie einzeln zu suchen. Die Angabe
	 * ist so gut wie die Erfassung: In Altona-Nord tragen fuenf von 2.643
	 * Gebaeuden ein solches Merkmal, in einer Altstadt sind es Hunderte.
	 */
	denkmal?: string;
	/**
	 * Strasse und Hausnummer, wo OpenStreetMap sie am Gebaeude fuehrt.
	 *
	 * Kostet keine eigene Abfrage: Die Merkmale haengen an denselben Gebaeuden,
	 * die der Zeichner ohnehin holt, und wurden bisher weggeworfen. In
	 * Altona-Nord tragen 1.857 von 2.643 Gebaeuden eine Hausnummer, also sieben
	 * von zehn. Als Ersatzmass fuer Wohneinheiten taugt das nur grob — ein
	 * Mehrfamilienhaus hat eine Hausnummer und dreissig Wohnungen —, als
	 * Anhaltspunkt fuer Adressdichte und fuer die Zuordnung zu Statistikdaten
	 * schon.
	 */
	adresse?: string;
	/**
	 * Wie viele Merkmale OpenStreetMap zu diesem Objekt fuehrt.
	 *
	 * Ohne die Merkmale der Erfassung selbst. Kein Guetesiegel — ein sorgfaeltig
	 * erfasstes Wohnhaus hat weniger Merkmale als eine Bushaltestelle —, aber
	 * ein ehrliches Mass dafuer, wie viel ueber ein Objekt bekannt ist. Die
	 * Darstellung „Datentiefe" macht daraus ein Bild.
	 */
	tiefe?: number;
	/**
	 * Innenringe, also Hoefe und Durchfahrten.
	 *
	 * Nur bei Flaechen aus einer Relation. `ringe` sind die Aussenteile eines
	 * Objekts — ein Gebaeude kann aus mehreren bestehen —, `loecher` die
	 * Aussparungen darin. Getrennt gefuehrt, weil beides bis zum 14.09.2026 in
	 * einem Feld lag: Jeder Ring nach dem ersten galt als Loch, und weil die
	 * Einleseregel Innenringe ohnehin wegwarf, wurden in Wahrheit zweite
	 * Aussenteile ausgestanzt.
	 */
	loecher?: [number, number][][];
	name?: string;
	nutzung?: string;
	klasse?: Nutzungsklasse; // nur Gebaeude
	rang?: number;           // nur Strassen: je kleiner, desto wichtiger
	zustand: Zustand;
	/** Ungeschnittener Urzustand, sobald am Plangebiet beschnitten wurde. */
	urform?: [number, number][][];
};

/**
 * Nutzungsklassen nach Art des Gebaeudes. Grobe Einteilung, die fuer die
 * Darstellung reicht und dem spaeteren Programmschritt vorarbeitet. OSM
 * kennt hunderte Werte, verwendet aber eine Handvoll fast immer.
 */
export const KLASSEN: Record<string, Nutzungsklasse> = {
	residential: 'wohnen', apartments: 'wohnen', house: 'wohnen', detached: 'wohnen',
	terrace: 'wohnen', semidetached_house: 'wohnen', dormitory: 'wohnen', bungalow: 'wohnen',
	commercial: 'gewerbe', retail: 'gewerbe', office: 'gewerbe', industrial: 'gewerbe',
	warehouse: 'gewerbe', supermarket: 'gewerbe', kiosk: 'gewerbe', hotel: 'gewerbe',
	civic: 'oeffentlich', public: 'oeffentlich', school: 'oeffentlich', university: 'oeffentlich',
	college: 'oeffentlich', hospital: 'oeffentlich', church: 'oeffentlich', cathedral: 'oeffentlich',
	chapel: 'oeffentlich', museum: 'oeffentlich', government: 'oeffentlich', train_station: 'oeffentlich',
	transportation: 'oeffentlich', sports_centre: 'oeffentlich', stadium: 'oeffentlich',
	kindergarten: 'oeffentlich', monastery: 'oeffentlich',
	garage: 'neben', garages: 'neben', shed: 'neben', roof: 'neben', carport: 'neben',
	hut: 'neben', service: 'neben', bunker: 'neben', container: 'neben'
};

/** Rangordnung der Strassen. Bestimmt, wer zuerst beschriftet wird. */
const RANG: Record<string, number> = {
	motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
	residential: 5, unclassified: 5, living_street: 6, pedestrian: 6,
	service: 8, track: 9, footway: 9, path: 9, cycleway: 9, steps: 9
};

const GRUEN = new Set(['park', 'garden', 'grass', 'meadow', 'forest', 'recreation_ground',
	'village_green', 'allotments', 'cemetery', 'pitch', 'playground', 'scrub', 'nature_reserve']);

type RohPunkt = { lat: number; lon: number };
type RohElement = {
	type: 'way' | 'relation' | 'node';
	id: number;
	tags?: Record<string, string>;
	geometry?: RohPunkt[];
	members?: { role?: string; geometry?: RohPunkt[] }[];
};

/**
 * Aussenringe einer Relation zusammensetzen.
 *
 * Zwei Bauarten kommen vor. Multipolygone verwenden die Rolle `outer`.
 * Gebaeude nach der Simple-3D-Konvention (`type=building`) verwenden
 * stattdessen `outline` fuer den Umriss und `part` fuer die Teilkoerper;
 * wer nur auf `outer` prueft, verliert diese Gebaeude ganz.
 */
const AUSSEN = new Set(['outer', 'outline', '']);

/**
 * Die Ringe einer Relation, nach Aussenteilen und Loechern getrennt.
 *
 * Eine Multipolygon-Relation fuehrt ihre Teile als Mitglieder mit einer Rolle:
 * `outer` fuer die Umrisse, `inner` fuer die Aussparungen. Ein Gebaeude kann
 * mehrere Aussenteile haben, und jedes davon kann Hoefe enthalten.
 *
 * Die Teile kommen unsortiert und in beliebiger Richtung; sie werden hier zu
 * geschlossenen Ringen aneinandergehaengt, jede Rolle fuer sich.
 */
function ringe(el: RohElement): { aussen: RohPunkt[][]; innen: RohPunkt[][] } {
	const mit = (pruefen: (rolle: string) => boolean) =>
		(el.members ?? []).filter((m) => pruefen(m.role ?? '') && m.geometry?.length)
			.map((m) => m.geometry!);

	let teile = mit((r) => AUSSEN.has(r));
	const innenTeile = mit((r) => r === 'inner');
	// Notnagel: kennt die Relation gar keine Aussenrolle, nimm was da ist,
	// statt das Objekt stillschweigend fallen zu lassen.
	if (!teile.length && !innenTeile.length)
		teile = (el.members ?? []).filter((m) => m.geometry?.length).map((m) => m.geometry!);

	return { aussen: schliessen(teile), innen: schliessen(innenTeile) };
}

/** Lose Teilstuecke zu geschlossenen Ringen aneinanderhaengen. */
function schliessen(teile: RohPunkt[][]): RohPunkt[][] {
	const fertig: RohPunkt[][] = [];
	const offen = [...teile];
	while (offen.length) {
		let k = offen.shift()!;
		let weiter = true;
		while (weiter && offen.length) {
			weiter = false;
			const e = k[k.length - 1];
			for (let i = 0; i < offen.length; i++) {
				const t = offen[i];
				if (t[0].lat === e.lat && t[0].lon === e.lon) { k = k.concat(t.slice(1)); offen.splice(i, 1); weiter = true; break; }
				const tl = t[t.length - 1];
				if (tl.lat === e.lat && tl.lon === e.lon) { k = k.concat([...t].reverse().slice(1)); offen.splice(i, 1); weiter = true; break; }
			}
			if (k[0].lat === k[k.length - 1].lat && k[0].lon === k[k.length - 1].lon) break;
		}
		if (k.length >= 4) fertig.push(k);
	}
	return fertig;
}

/** Unter der Erde: Tunnel und unterirdisch geführte Strecken, aber keine Hausdurchfahrt. */
function unterirdisch(t: Record<string, string>): boolean {
	return (!!t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage')
		|| t.location === 'underground';
}

/** Strasse und Hausnummer, zusammengesetzt, sofern beides dasteht. */
function adresse(t: Record<string, string>): string | undefined {
	const nr = t['addr:housenumber'];
	if (!nr) return undefined;
	return t['addr:street'] ? `${t['addr:street']} ${nr}` : nr;
}

/**
 * Denkmalstatus aus den Merkmalen.
 *
 * OpenStreetMap fuehrt ihn auf drei Arten, je nach Erfassungsschule:
 * `heritage` mit einer Stufe, `historic` mit einer Art, `listed_status` mit
 * dem Register. Zurueck kommt der aussagekraeftigste Wert, nicht alle drei.
 */
function denkmal(t: Record<string, string>): string | undefined {
	if (t['heritage']) return `heritage=${t['heritage']}`;
	if (t['listed_status']) return `listed_status=${t['listed_status']}`;
	if (t['historic'] && t['historic'] !== 'no') return `historic=${t['historic']}`;
	if (t['heritage:operator']) return `heritage:operator=${t['heritage:operator']}`;
	return undefined;
}

/**
 * Hoehe eines Gebaeudes und woher sie kommt.
 *
 * `height` in Metern ist die gemessene Angabe. Fehlt sie, wird aus der
 * Geschosszahl gerechnet: 3,2 Meter je Geschoss plus einen Meter fuer Dach
 * und Sockel. Fehlt auch die, bleiben acht Meter als Annahme. Die drei Faelle
 * sind im Datenvertrag als `gemessen`, `geschosse` und `annahme` unterschieden,
 * weil der Unterschied zwischen ihnen groesser ist als die Streuung innerhalb.
 */
function hoehe(t: Record<string, string>): { m: number; geschosse?: number; geschaetzt: boolean } {
	const g = parseFloat(t['building:levels'] ?? '');
	const geschosse = Number.isFinite(g) && g > 0 ? g : undefined;
	const h = parseFloat(t.height ?? t['building:height'] ?? '');
	if (Number.isFinite(h) && h > 0) return { m: h, geschosse, geschaetzt: false };
	if (geschosse) return { m: geschosse * 3.2 + 1, geschosse, geschaetzt: true };
	return { m: 8, geschaetzt: true };
}

/**
 * `kasten` ist der Bereich im Ortsgitter, für den das Meer aus den
 * Küstenlinien gefüllt wird. Ohne ihn gibt es kein Meer, nur Seen und Flüsse.
 */
export function lesen(roh: { elements: RohElement[] }, gitter: Gitter, kasten?: Kasten): Objekt[] {
	const kueste: [number, number][][] = [];
	const aus: Objekt[] = [];
	const zu = (g: RohPunkt[]): [number, number][] =>
		g.map((p) => { const q = nachGitter(p.lon, p.lat, gitter); return [q.x, q.y]; });

	for (const el of roh.elements) {
		const t = el.tags ?? {};
		const id = `${el.type[0]}${el.id}`;
		const tiefe = Object.keys(t).filter((k) => !BUCHHALTUNG.test(k)).length;
		if (t.natural === 'coastline' && el.type === 'way' && el.geometry?.length)
			kueste.push(zu(el.geometry));
		const teile = el.type === 'relation'
			? ringe(el)
			: { aussen: el.geometry?.length ? [el.geometry] : [], innen: [] };
		const flaechen = teile.aussen.map(zu);
		const loecher = teile.innen.length ? teile.innen.map(zu) : undefined;
		if (!flaechen.length) continue;

		if (t.landuse === 'construction' || t.building === 'construction'
			|| t['building:part'] === 'construction' || t.construction) {
			// Baustelle, kein Gebaeude. Wird eigens gefuehrt, damit das weisse
			// Loch im Plan als das erscheint, was es ist.
			aus.push({ id, ebene: 'bau', art: 'flaeche', ringe: flaechen, loecher, tiefe,
				name: t.name, nutzung: t.construction ?? t.landuse ?? t.building, zustand: 'normal' });
		} else if (t.building || t['building:part']) {
			const h = hoehe(t);
			const art = t.building && t.building !== 'yes' ? t.building : (t['building:use'] ?? t.amenity ?? '');
			aus.push({ id, ebene: 'gebaeude', art: 'flaeche', ringe: flaechen, loecher, tiefe,
				teil: !t.building && !!t['building:part'],
				hoeheM: h.m, geschosse: h.geschosse, hoeheGeschaetzt: h.geschaetzt,
				name: t.name, nutzung: t.building, denkmal: denkmal(t), adresse: adresse(t),
				klasse: KLASSEN[art] ?? 'unbestimmt', zustand: 'normal' });
		} else if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') {
			aus.push({ id, ebene: 'wasser', art: 'flaeche', ringe: flaechen, loecher, tiefe, name: t.name, zustand: 'normal' });
		} else if (NUTZUNG.has(t.landuse ?? '')) {
			// Nutzungsflaechen gehen nicht auf das Blatt. Sie werden getrennt
			// eingelesen, siehe `analysedaten.ts`.
		} else if (GRUEN.has(t.landuse ?? '') || GRUEN.has(t.leisure ?? '')) {
			aus.push({ id, ebene: 'gruen', art: 'flaeche', ringe: flaechen, loecher, tiefe, name: t.name, zustand: 'normal' });
		} else if (unterirdisch(t) && (t.railway || t.highway)) {
			// Tunnel gehören nicht auf den Plan. Am 26.10.2026 in Manhattan: Der
			// Brooklyn-Battery-Tunnel lief als breites Straßenband über die Bucht,
			// die U-Bahn als Gleise quer durch die Blöcke. Im Netz für Wegrechnungen
			// bleiben sie, das wird getrennt aus den Rohdaten gebaut.
		} else if (t.railway && ['rail', 'tram', 'light_rail', 'subway'].includes(t.railway)) {
			// Abstell- und Rangiergleise tragen ein `service`-Merkmal. Ein
			// Bahnhofsvorfeld besteht fast nur daraus; ungewichtet wird daraus
			// ein Faecher aus dreissig gleich starken Linien, der den halben
			// Plan schluckt. Rang 9 nimmt sie spaeter zurueck, wie beim Fussweg.
			aus.push({ id, ebene: 'bahn', art: 'linie', ringe: flaechen, breiteM: 3, tiefe,
				rang: t.service ? 9 : 4, name: t.name, zustand: 'normal' });
		} else if (t.highway) {
			const b = FAHRBAHN[t.highway];
			if (b) aus.push({ id, ebene: 'strasse', art: 'linie', ringe: flaechen, breiteM: b, tiefe,
				name: t.name, nutzung: t.highway, rang: RANG[t.highway] ?? 9, zustand: 'normal' });
		}
	}
	if (kasten) {
		let n = 0;
		for (const m of meer(kueste, kasten))
			aus.push({ id: `kueste${++n}`, ebene: 'wasser', art: 'flaeche', ringe: [m.ring],
				loecher: m.loecher.length ? m.loecher : undefined, tiefe: 0, name: 'sea', zustand: 'normal' });
	}
	return aus;
}

/** Gauss'sche Trapezformel. Vorzeichen sagt den Umlaufsinn, Betrag die Flaeche. */
export function ringflaeche(ring: [number, number][]) {
	let s = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
		s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
	return s / 2;
}

/**
 * Woher die Hoehen kommen. Wird offengelegt, nicht versteckt.
 *
 * Drei Herkuenfte statt zweier, weil der Unterschied zwischen ihnen fuer ein
 * Werkzeug, das Schatten rechnet, groesser ist als der zwischen „gemessen" und
 * „nicht gemessen". Aus der Geschosszahl gerechnet ist eine Naeherung mit
 * Grundlage; der Notwert von acht Metern ist ein Platzhalter, in dem ein
 * Schuppen und ein Kontorhaus gleich hoch sind.
 *
 * Im Holstenareal tragen sechs von 1.990 Gebaeuden eine gemessene Hoehe und
 * 665 den Notwert. Eine Quote ueber alles haette das verdeckt.
 *
 * `ohneTeile` laesst die `building:part` weg. Der Unterschied ist gross, weil
 * ein Teil fast immer eine gemessene Hoehe traegt: In der HafenCity stehen
 * ueber alle Koerper 28,6 % der Grundflaeche auf dem Notwert, ueber die
 * Gebaeude allein 44,2 %. Beide Zahlen sind richtig, sie beantworten zwei
 * Fragen — was extrudiert wird, und was an Haeusern bekannt ist. Gefaehrlich
 * ist nur, sie fuer dieselbe zu halten.
 */
/**
 * Ist dieser Koerper ein Gebaeudeteil?
 *
 * Frisch eingelesene Objekte tragen `teil`. Die mitgelieferten Beispiele und
 * alles, was aus der Ablage zurueckkommt, sind aber gespeicherter Zustand aus
 * der Zeit davor — dort fehlt das Feld, und ohne Rueckfall zaehlt ein
 * geladenes Beispiel null Teile und 624 Gebaeude.
 *
 * Der Rueckfall ist keine Schaetzung: `lesen` setzt `nutzung: t.building`.
 * Ein Koerper in der Gebaeudeschublade ohne `nutzung` hatte also kein
 * `building` und kann nur ueber `building:part` hereingekommen sein. An der
 * HafenCity gegengeprueft — 286 ohne `nutzung`, dieselben 286, die kein
 * `building` tragen.
 */
export const istTeil = (o: Objekt) =>
	o.teil ?? (o.ebene === 'gebaeude' && !o.nutzung);

export function hoehenDeckung(objekte: Objekt[], ohneTeile = false) {
	const g = objekte.filter(
		(o) => (o.ebene === 'gebaeude' || o.ebene === 'erhalt') && !(ohneTeile && istTeil(o))
	);
	const echt = g.filter((o) => !o.hoeheGeschaetzt).length;
	const geschosse = g.filter((o) => o.hoeheGeschaetzt && o.geschosse).length;
	// Aus Luftbildern geschätzt (Overture, meist Microsoft). Weder gemessen
	// noch der Notwert — eine eigene Gruppe, sonst stünden sie als Annahme da.
	const ausBild = (o: Objekt) => o.hoeheGeschaetzt && !o.geschosse && !!o.herkunft && o.hoeheM !== undefined;
	const luftbild = g.filter(ausBild).length;

	// Dieselbe Aufteilung noch einmal nach Grundflaeche. Ein Koerperanteil sagt
	// nicht, wie viel Schatten an ihm haengt: In der HafenCity stehen 17 % der
	// Koerper auf dem Notwert, aber 29 % der Grundflaeche, weil es die grossen
	// Hallen sind, die keine Merkmale tragen. Im Holstenareal fallen beide
	// Anteile zusammen. Welcher Fall vorliegt, sieht man nur an beiden Zahlen.
	const flaeche = { echt: 0, geschosse: 0, luftbild: 0, annahme: 0 };
	for (const o of g) {
		let a = 0;
		for (const ring of o.ringe) a += Math.abs(ringflaeche(ring));
		for (const loch of o.loecher ?? []) a -= Math.abs(ringflaeche(loch));
		a = Math.max(0, a);
		if (!o.hoeheGeschaetzt) flaeche.echt += a;
		else if (o.geschosse) flaeche.geschosse += a;
		else if (ausBild(o)) flaeche.luftbild += a;
		else flaeche.annahme += a;
	}

	return {
		gesamt: g.length, echt, geschosse, luftbild, annahme: g.length - echt - geschosse - luftbild,
		anteil: g.length ? echt / g.length : 0,
		flaeche: {
			echt: Math.round(flaeche.echt),
			geschosse: Math.round(flaeche.geschosse),
			luftbild: Math.round(flaeche.luftbild),
			annahme: Math.round(flaeche.annahme)
		}
	};
}

/** Huellrechteck eines Objekts im Gitter. */
export function huelle(o: Objekt): [number, number, number, number] {
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const ring of o.ringe) for (const [x, y] of ring) {
		if (x < x0) x0 = x; if (x > x1) x1 = x;
		if (y < y0) y0 = y; if (y > y1) y1 = y;
	}
	return [x0, y0, x1, y1];
}

/**
 * Behaelt, was den Rahmen beruehrt, und wirft weg, was nur wegen des
 * Abfragerands mitgekommen ist.
 *
 * Ein Gebaeude auf der Kante bleibt dadurch vollstaendig erhalten, waehrend
 * die Zaehler in der Schiene weiterhin zeigen, was tatsaechlich im Blatt
 * steht, und nicht, was nebenbei geladen wurde.
 */
export function imRahmen(objekte: Objekt[], x0: number, y0: number, x1: number, y1: number) {
	return objekte.filter((o) => {
		const [a, b, c, d] = huelle(o);
		return !(c < x0 || a > x1 || d < y0 || b > y1);
	});
}

export function schwerpunkt(o: Objekt): [number, number] {
	const p = o.ringe[0];
	let x = 0, y = 0;
	for (const q of p) { x += q[0]; y += q[1]; }
	return [x / p.length, y / p.length];
}

/** Punkt-in-Polygon, fuer das Anklicken von Objekten. */
export function trifft(o: Objekt, x: number, y: number, toleranzM: number): boolean {
	if (o.art === 'linie') {
		const t = (o.breiteM ?? 4) / 2 + toleranzM;
		for (const r of o.ringe)
			for (let i = 1; i < r.length; i++)
				if (abstandZuStrecke(x, y, r[i - 1], r[i]) <= t) return true;
		return false;
	}
	for (const r of o.ringe) {
		let drin = false;
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
			const [xi, yi] = r[i], [xj, yj] = r[j];
			if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
		}
		if (drin) return true;
	}
	return false;
}

function abstandZuStrecke(px: number, py: number, a: [number, number], b: [number, number]) {
	const dx = b[0] - a[0], dy = b[1] - a[1];
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
	return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/**
 * Fehlen hier die Gebäude in OpenStreetMap?
 *
 * Am 28.10.2026 in Upper Saddle River (New Jersey) aufgefallen: Straßen
 * vollständig, Häuser sechs. In vielen US-Vororten hat niemand die Gebäude
 * eingetragen, und wer das zum ersten Mal sieht, hält Nolli für kaputt.
 *
 * Gemessen an Wohnstraßen, weil an ihnen Häuser stehen müssen: Ein erfasster
 * Vorort hat 50 und mehr Gebäude je Kilometer, Upper Saddle River hatte
 * unter einem. Fernstraßen und Feldwege zählen nicht, an ihnen darf es leer
 * sein. Die Schwelle von fünf ist großzügig — sie soll nur das Offensichtliche
 * melden.
 */
export function gebaeudeLuecke(objekte: Objekt[], k: { x0: number; y0: number; x1: number; y1: number }) {
	const drin = (x: number, y: number) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1;
	let m = 0, haeuser = 0;
	for (const o of objekte) {
		if (o.ebene === 'strasse' && (o.nutzung === 'residential' || o.nutzung === 'living_street')) {
			for (const ring of o.ringe) for (let i = 1; i < ring.length; i++) {
				const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
				if (drin((ax + bx) / 2, (ay + by) / 2)) m += Math.hypot(bx - ax, by - ay);
			}
		} else if ((o.ebene === 'gebaeude' || o.ebene === 'erhalt') && !istTeil(o)) {
			const p = o.ringe[0]?.[0];
			if (p && drin(p[0], p[1])) haeuser++;
		}
	}
	const km = m / 1000;
	return { km, haeuser, luecke: km >= 1 && haeuser < 5 * km };
}

/**
 * Die Ebene, unter der ein Objekt sichtbar ist und gezeichnet wird.
 * Ergänzte Overture-Gebäude haben `ebene: 'gebaeude'`, stehen aber unter
 * `overture`, damit sie sich getrennt schalten lassen. Als Erhalt gesetzt,
 * gehören sie zum Erhalt wie jedes andere Haus.
 */
export const sichtEbene = (o: Objekt): StiftId =>
	o.herkunft === 'overture' && o.ebene === 'gebaeude' ? 'overture' : o.ebene;
