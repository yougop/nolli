import { t, zahl } from './sprache.svelte';
import { Rahmen, VERHAELTNISSE, AUSGABEBREITEN, type Verhaeltnis } from './geo/rahmen';
import { ortsgitter, nachGitter } from './geo/utm';
import { lesen, imRahmen, type Objekt } from './osm';
import { drin, beruehrt, ausserhalb, schwerpunkt } from './schneiden';
import { STIFTE, type StiftId } from './stifte';
import { base } from '$app/paths';
import { ablegen, abholen, wegwerfen } from './ablage';
import { holeBestand, QuellFehler, Abgebrochen } from './quelle';
import { holeGelaende, type Gelaende } from './geo/gelaende';
import { holeOverture, gebaeudeErgaenzen, placesAus, type Place } from './overture';
import { netzAus, nutzflaechenAus, poisAus, halteAus, restAus, baeumeAus,
	type Netz, type Nutzflaeche, type Poi, type Haltestelle, type Linie, type Rest } from './analysedaten';

export type Ort = { name: string; wo: string; lon: number; lat: number; bbox: number[] | null };

/**
 * Ein Rechteck im Ortsgitter. Wahrheit ist immer Meter, nie Bildschirm.
 * `lon0` ist der Mittelmeridian des Gitters und damit seine Identitaet:
 * zwei Kaesten mit verschiedenem lon0 sind nicht vergleichbar.
 */
export type Kasten = { x0: number; y0: number; x1: number; y1: number; lon0: number };

/**
 * Dem Bildschirm einen Takt geben.
 *
 * Das Einsortieren von fuenfzehntausend Elementen laeuft am Stueck. Ohne diese
 * Pause zeigte der Knopf erst nach dem letzten Schritt alle Meldungen auf
 * einmal, also gar keine.
 */
const atmen = () => new Promise<void>((f) => requestAnimationFrame(() => setTimeout(f, 0)));

class Zustand {
	schritt = $state<1 | 2 | 3>(1);
	ort = $state<Ort | null>(null);
	kasten = $state<Kasten | null>(null);
	verhaeltnis = $state<Verhaeltnis>(VERHAELTNISSE[0]);
	ausgabeBreite = $state(4096);

	/**
	 * Der Bestand liegt bewusst roh, also ohne tiefe Zustandshuelle.
	 *
	 * Jede Bearbeitung setzt das Feld ohnehin neu — gestrichen, erhalten,
	 * beschnitten laufen alle ueber `map` —, also braucht niemand Reaktion auf
	 * einzelne Felder. Dafuer laesst sich der Bestand so ablegen: `indexedDB`
	 * kann eine Zustandshuelle nicht kopieren und bricht mit `DataCloneError`
	 * ab, und die Abschrift mit `$state.snapshot` kostet an sechstausend
	 * Objekten 1.392 Millisekunden statt 19.
	 */
	objekte = $state.raw<Objekt[]>([]);

	/**
	 * Was nicht gezeichnet, aber mitgeliefert wird.
	 *
	 * Das Strassennetz als Graph und die Nutzungsflaechen. Beides kommt aus
	 * derselben Abfrage wie der Bestand, damit das Paket ein eingefrorener
	 * Stand bleibt und nicht aus zwei Zeitpunkten zusammengesetzt ist.
	 */
	netz = $state.raw<Netz | null>(null);
	nutzflaechen = $state.raw<Nutzflaeche[]>([]);
	pois = $state.raw<Poi[]>([]);
	haltestellen = $state.raw<Haltestelle[]>([]);
	linien = $state.raw<Linie[]>([]);
	/** Alles, wofuer Nolli keine eigene Schublade hat. Siehe `restAus`. */
	rest = $state.raw<Rest[]>([]);
	/** Die Baeume aus dem Rest, fertig zum Zeichnen. */
	baumpunkte = $state.raw<{ x: number; y: number; krone: number; gemessen: boolean }[]>([]);
	sichtbar = $state(new Set<StiftId>(STIFTE.map((s) => s.id)));
	hervorgehoben = $state<StiftId | null>(null);
	ausgewaehlt = $state(new Set<string>());
	plangebiet = $state.raw<[number, number][] | null>(null);

	darstellung = $state('schwarzplan');
	beschriftung = $state(false);
	/**
	 * Baeume zuschaltbar, wie die Beschriftung.
	 *
	 * Sie stecken in den Daten, seit die Abfrage alles nimmt — 3.707 im
	 * Holstenareal, zwei Drittel davon mit Kronendurchmesser. Ob sie auf das
	 * Blatt gehoeren, haengt davon ab, wofuer das Blatt gedacht ist: Fuer einen
	 * Schwarzplan sind sie Stoerung, fuer eine Freiraumbetrachtung die Sache
	 * selbst. Also ein Schalter und keine Entscheidung.
	 */
	baeume = $state(false);
	bereinigt = $state(false);

	/**
	 * Gelände zuschaltbar, wie die Bäume.
	 *
	 * Aus heißt: ebene Platte, wie bisher, und der Vertrag sagt das. An heißt:
	 * Höhen aus einem offenen Höhenmodell, Häuser auf dem Gelände, Höhenlinien
	 * in der Zeichnung. Geholt wird erst beim Einschalten und nur einmal je
	 * Rahmen — eine zweite Quelle neben OpenStreetMap, mit eigener Genauigkeit,
	 * soll niemand nebenbei bekommen.
	 */
	/**
	 * Gebäude aus Overture, wo OpenStreetMap keine hat (`overture.ts`).
	 *
	 * Die ergänzten Gebäude liegen mit den übrigen in `objekte` und tragen
	 * `herkunft: 'overture'`; hier steht nur, woher sie kommen. Neues Holen
	 * wirft sie weg — der Abgleich gilt nur gegen den OSM-Stand, mit dem er
	 * gerechnet wurde.
	 */
	ergaenzung = $state.raw<{ release: string; quellen: Record<string, number>; anzahl: number } | null>(null);
	ergaenzungLaedt = $state<string | null>(null);
	private ergaenzungStopper: AbortController | null = null;

	async ergaenzen() {
		const r = this.rahmen;
		if (!r || this.ergaenzungLaedt || this.ergaenzung) return;
		const k = this.schluessel();
		const stopper = (this.ergaenzungStopper = new AbortController());
		this.ergaenzungLaedt = t().overture.frage;
		this.fehler = null;
		try {
			const g = r.eckenGrad;
			const o = await holeOverture('buildings', { sued: g.sued, west: g.west, nord: g.nord, ost: g.ost },
				(n, von, b) => { if (!stopper.signal.aborted) this.ergaenzungLaedt = t().overture.kacheln(n, von, (b / 1e6).toFixed(1)); },
				stopper.signal);
			if (stopper.signal.aborted || this.schluessel() !== k) return;
			const osm = this.objekte.filter((x) => x.herkunft !== 'overture');
			const e = gebaeudeErgaenzen(o.merkmale, r.gitter, osm);
			const neu = imRahmen(e.objekte, r.x0, r.y0, r.x1, r.y1);
			const quellen: Record<string, number> = {};
			for (const x of neu) quellen[x.quelleGeometrie ?? 'Overture'] = (quellen[x.quelleGeometrie ?? 'Overture'] ?? 0) + 1;
			this.objekte = [...osm, ...neu];
			this.ergaenzung = { release: o.release, quellen, anzahl: neu.length };
		} catch (e) {
			if (!stopper.signal.aborted)
				this.fehler = t().overture.fehler(e instanceof Error ? e.message : String(e));
		} finally {
			this.ergaenzungLaedt = null;
			this.ergaenzungStopper = null;
		}
	}

	ergaenzenAbbrechen() { this.ergaenzungStopper?.abort(); }

	ergaenzungEntfernen() {
		this.objekte = this.objekte.filter((x) => x.herkunft !== 'overture');
		this.ausgewaehlt = new Set([...this.ausgewaehlt].filter((id) => !id.startsWith('ov')));
		this.ergaenzung = null;
	}

	/**
	 * Orte aus Overture Places, auf Knopfdruck (`overture.ts`). In dichten
	 * Städten mehrere Megabyte, deshalb nie nebenbei.
	 */
	places = $state.raw<Place[]>([]);
	/** Places im Plan zeigen. Schaltet sie beim ersten Mal auch erst ein. */
	placesZeigen = $state(false);
	async placesUmschalten() {
		this.placesZeigen = !this.placesZeigen;
		if (this.placesZeigen && !this.placesInfo) await this.placesHolen();
		if (!this.placesInfo) this.placesZeigen = false;
	}
	placesInfo = $state.raw<{ release: string } | null>(null);
	placesLaedt = $state<string | null>(null);
	private placesStopper: AbortController | null = null;

	async placesHolen() {
		const r = this.rahmen;
		if (!r || this.placesLaedt || this.placesInfo) return;
		const k = this.schluessel();
		const stopper = (this.placesStopper = new AbortController());
		this.placesLaedt = t().overture.frage;
		this.fehler = null;
		try {
			const g = r.eckenGrad;
			const o = await holeOverture('places', { sued: g.sued, west: g.west, nord: g.nord, ost: g.ost },
				(n, von, b) => { if (!stopper.signal.aborted) this.placesLaedt = t().overture.kacheln(n, von, (b / 1e6).toFixed(1)); },
				stopper.signal);
			if (stopper.signal.aborted || this.schluessel() !== k) return;
			this.places = placesAus(o.merkmale, r.gitter, r);
			this.placesInfo = { release: o.release };
		} catch (e) {
			if (!stopper.signal.aborted)
				this.fehler = t().overture.fehler(e instanceof Error ? e.message : String(e));
		} finally {
			this.placesLaedt = null;
			this.placesStopper = null;
		}
	}

	placesAbbrechen() { this.placesStopper?.abort(); }

	placesEntfernen() { this.places = []; this.placesInfo = null; this.placesZeigen = false; }

	gelaende = $state(false);
	gelaendeDaten = $state.raw<Gelaende | null>(null);
	gelaendeFuer = $state<string | null>(null);
	gelaendeLaedt = $state<string | null>(null);

	/** Das Raster, wenn das Gelände an ist und zum Rahmen passt. Sonst null. */
	get gelaendeJetzt(): Gelaende | null {
		return this.gelaende && this.gelaendeFuer === this.schluessel() ? this.gelaendeDaten : null;
	}

	/**
	 * Das Raster holen, wenn es zum Rahmen noch keins gibt.
	 *
	 * Ein laufender Abruf wird nicht doppelt gestartet, sondern abgewartet:
	 * Wer während des Ladens ausgibt, bekommt das Paket mit Gelände und nicht
	 * eines, in dem die angekündigte Geländedatei fehlt.
	 */
	private gelaendeLauf: Promise<void> | null = null;
	gelaendeHolen(): Promise<void> {
		const r = this.rahmen;
		const k = this.schluessel();
		if (!r || !k || (this.gelaendeFuer === k && this.gelaendeDaten)) return Promise.resolve();
		if (this.gelaendeLauf) return this.gelaendeLauf;
		this.gelaendeLaedt = '…';
		this.gelaendeLauf = (async () => {
			try {
				const g = await holeGelaende(r, (s) => (this.gelaendeLaedt = s));
				// Hat sich der Rahmen inzwischen geändert, gehört das Raster
				// zum alten. Dann nicht übernehmen; der nächste Anlauf holt neu.
				if (this.schluessel() === k) { this.gelaendeDaten = g; this.gelaendeFuer = k; }
			} catch (e) {
				this.gelaende = false;
				this.fehler = t().gelaende.fehler(e instanceof Error ? e.message : String(e));
			} finally {
				this.gelaendeLaedt = null;
				this.gelaendeLauf = null;
			}
		})();
		return this.gelaendeLauf;
	}

	async gelaendeUmschalten() {
		this.gelaende = !this.gelaende;
		if (this.gelaende) await this.gelaendeHolen();
	}

	/** Werkzeug auf dem Blatt: einzeln zeigen oder ein Polygon aufziehen. */
	werkzeug = $state<'zeigen' | 'polygon'>('zeigen');
	fanglinie = $state<[number, number][]>([]);

	/** Ansicht auf dem Blatt. Zoom 1 zeigt das ganze Blatt. */
	zoom = $state(1);
	mitte = $state({ x: 0.5, y: 0.5 });
	readonly MAXZOOM = 24;
	einpassen() { this.zoom = 1; this.mitte = { x: 0.5, y: 0.5 }; }
	zoomStufe(f: number) {
		this.zoom = Math.min(this.MAXZOOM, Math.max(1, this.zoom * f));
		this.mitteKlemmen();
	}
	mitteKlemmen() {
		this.mitte = {
			x: Math.min(1, Math.max(0, this.mitte.x)),
			y: Math.min(1, Math.max(0, this.mitte.y))
		};
	}

	/** Woher das Kartenbild in Schritt 1 gerade kommt. */
	kartenquelle = $state<'lade' | 'openfreemap' | 'ohne'>('lade');

	laden = $state(false);
	/** Was der Abruf gerade tut. Steht auf dem Knopf, solange er laeuft. */
	fortschritt = $state('');
	fehler = $state<string | null>(null);
	geladenFuer = $state<string | null>(null);

	get rahmen(): Rahmen | null {
		const k = this.kasten;
		if (!k) return null;
		return new Rahmen({
			lon0: k.lon0,
			bbox: [k.x0, k.y0, k.x1, k.y1],
			pixelBreite: this.ausgabeBreite,
			verhaeltnis: this.verhaeltnis.name
		});
	}

	get gestrichene() { return this.objekte.filter((o) => o.zustand === 'gestrichen').length; }
	get erhaltene() { return this.objekte.filter((o) => o.zustand === 'erhalt').length; }
	get datenAktuell() { return !!this.kasten && this.geladenFuer === this.schluessel(); }

	private schluessel() {
		const k = this.kasten;
		return k ? `${k.lon0.toFixed(5)}:${k.x0.toFixed(0)}:${k.y0.toFixed(0)}:${k.x1.toFixed(0)}:${k.y1.toFixed(0)}` : null;
	}

	/** Rechteck aus zwei UTM-Punkten, gegebenenfalls auf das Verhältnis gezwungen. */
	setzeKasten(ax: number, ay: number, bx: number, by: number, lon0: number) {
		let b = Math.abs(bx - ax), h = Math.abs(by - ay);
		const v = this.verhaeltnis.wert;
		if (v) { if (b / Math.max(h, 1e-6) > v) h = b / v; else b = h * v; }
		const x0 = bx < ax ? ax - b : ax;
		const y0 = by < ay ? ay - h : ay;
		this.kasten = { x0, y0, x1: x0 + Math.max(b, 50), y1: y0 + Math.max(h, 50), lon0 };
	}

	/** Verhältnis ändern: Fläche halten, Mitte halten. */
	setzeVerhaeltnis(v: Verhaeltnis) {
		this.verhaeltnis = v;
		const k = this.kasten;
		if (!k || !v.wert) return;
		const cx = (k.x0 + k.x1) / 2, cy = (k.y0 + k.y1) / 2;
		const f = Math.sqrt((k.x1 - k.x0) * (k.y1 - k.y0));
		const b = f * Math.sqrt(v.wert), h = f / Math.sqrt(v.wert);
		this.kasten = { ...k, x0: cx - b / 2, y0: cy - h / 2, x1: cx + b / 2, y1: cy + h / 2 };
	}

	/** Standardrahmen um einen Ort: 2048 m breit, im gewählten Verhältnis. */
	rahmenUmOrt(o: Ort, breiteM = 2048) {
		// Das Gitter wird am Ort aufgespannt: Mittelmeridian durch das
		// Plangebiet, damit Gitternord und geographisch Nord zusammenfallen.
		const g = ortsgitter(o.lon);
		const p = nachGitter(o.lon, o.lat, g);
		const v = this.verhaeltnis.wert ?? 4 / 3;
		const h = breiteM / v;
		this.kasten = { x0: p.x - breiteM / 2, y0: p.y - h / 2, x1: p.x + breiteM / 2, y1: p.y + h / 2, lon0: g.lon0 };
	}

	private stopper: AbortController | null = null;

	/** Das Holen abbrechen. Die bisher geladenen Daten bleiben. */
	abbrechen() { this.stopper?.abort(); }

	async holen() {
		const r = this.rahmen;
		if (!r || this.laden) return;
		this.laden = true; this.fehler = null; this.fortschritt = t().laden.frage;
		const stopper = (this.stopper = new AbortController());
		try {
			const g = r.eckenGrad;
			const roh = await holeBestand(
				{ sued: g.sued, west: g.west, nord: g.nord, ost: g.ost },
				(was) => { if (!stopper.signal.aborted) this.fortschritt = was; },
				stopper.signal
			);
			if (stopper.signal.aborted) throw new Abgebrochen();
			const anzahl = roh.elements?.length ?? 0;
			// Der Abfragerand bringt Nachbarschaft mit. Was den Rahmen gar nicht
			// beruehrt, fliegt wieder raus, damit die Zaehler das Blatt zeigen.
			this.fortschritt = t().laden.sortiere(zahl(anzahl));
			await atmen();
			// Das Meer wird etwas über den Rahmen hinaus gefüllt; der Rand der
			// Abfrage ist 150 m, also liegen alle Küsten bis dorthin vor.
			this.ergaenzung = null;
			this.places = []; this.placesInfo = null; this.placesZeigen = false;
			this.objekte = imRahmen(lesen(roh, r.gitter, { x0: r.x0 - 50, y0: r.y0 - 50, x1: r.x1 + 50, y1: r.y1 + 50 }),
				r.x0, r.y0, r.x1, r.y1);
			this.fortschritt = t().laden.netz;
			await atmen();
			// Netz und Nutzungsflaechen reichen bewusst ueber den Rahmen hinaus,
			// so weit die Abfrage reicht: Ein Weg, der draussen weiterlaeuft, ist
			// fuer jede Wegrechnung noetig, und eine halbe Nutzungsflaeche sagt
			// weniger als eine ganze.
			this.netz = netzAus(roh, r.gitter);
			this.nutzflaechen = nutzflaechenAus(roh, r.gitter);
			this.fortschritt = t().laden.punkte;
			await atmen();
			this.pois = poisAus(roh, r.gitter);
			const h = halteAus(roh, r.gitter);
			this.haltestellen = h.haltestellen;
			this.linien = h.linien;
			// Was keine der Schubladen genommen hat, kommt trotzdem mit.
			const benutzt = new Set<string>([
				...this.objekte.map((o) => o.id),
				...this.nutzflaechen.map((f) => f.id),
				...this.pois.map((p) => p.id),
				...this.haltestellen.map((x) => x.id),
				...(this.netz?.kanten ?? []).map((k) => String(k.weg))
			]);
			this.fortschritt = t().laden.rest;
			await atmen();
			this.rest = restAus(roh, r.gitter, benutzt);
			this.baumpunkte = baeumeAus(this.rest);
			this.ausgewaehlt = new Set();
			this.geladenFuer = this.schluessel();
			if (!this.objekte.length)
				this.fehler = t().laden.leer;
		} catch (e) {
			this.fehler = e instanceof Abgebrochen ? null
				: e instanceof QuellFehler || e instanceof Error ? e.message : t().laden.unbekannt;
		} finally {
			this.laden = false;
			this.fortschritt = '';
		}
	}

	/**
	 * Ein mitgeliefertes Beispielgebiet laden.
	 *
	 * Der erste Eindruck soll nicht an der Tagesform einer gespendeten Auskunft
	 * haengen. Die beiden Beispiele liegen fertig eingelesen neben der App und
	 * sind sofort da, ohne dass ein fremder Dienst angefasst wird.
	 */
	async beispielLaden(datei: string) {
		if (this.laden) return;
		this.laden = true; this.fehler = null;
		try {
			const a = await fetch(`${base}/beispiele/${datei}.json`);
			if (!a.ok) throw new Error(t().laden.beispielFehlt);
			const d = await a.json();
			this.verhaeltnis = VERHAELTNISSE.find((v) => v.name === d.verhaeltnis) ?? this.verhaeltnis;
			this.ort = d.ort;
			this.kasten = d.kasten;
			this.objekte = d.objekte;
			this.netz = d.netz ?? null;
			this.nutzflaechen = d.nutzflaechen ?? [];
			this.pois = d.pois ?? [];
			this.haltestellen = d.haltestellen ?? [];
			this.linien = d.linien ?? [];
			this.rest = d.rest ?? [];
			this.baumpunkte = baeumeAus(this.rest);
			this.ausgewaehlt = new Set();
			this.plangebiet = null;
			this.geladenFuer = this.schluessel();
			this.schritt = 2;
		} catch (e) {
			this.fehler = e instanceof Error ? e.message : t().laden.beispielFehler;
		} finally {
			this.laden = false;
			this.fortschritt = '';
		}
	}

	// ---- Polygonwerkzeug -------------------------------------------------
	punktSetzen(x: number, y: number) {
		this.fanglinie = [...this.fanglinie, [x, y]];
	}
	letztenPunktZurueck() {
		this.fanglinie = this.fanglinie.slice(0, -1);
	}
	polygonAbbrechen() {
		this.fanglinie = [];
		this.werkzeug = 'zeigen';
	}
	/**
	 * Auswahl aus dem gezeichneten Polygon.
	 *
	 * Erfasst wird nur bauliche Substanz: Gebaeude, Erhaltungsbestand und
	 * Baustellen. Strassen, Gleise, Wasser und Gruen bleiben aussen vor, weil
	 * sie sich beim Markieren einzelner Haeuser nur in den Weg legen. Wer ein
	 * ganzes Gebiet raeumen will, nimmt dafuer Freiraeumen, das auch die
	 * Linien an der Grenze beschneidet.
	 */
	auswahlAusPolygon(dazu = false) {
		const p = this.fanglinie;
		if (p.length < 3) return 0;
		const baulich = new Set<StiftId>(['gebaeude', 'erhalt', 'bau']);
		const treffer = this.objekte
			.filter((o) => baulich.has(o.ebene) && this.sichtbar.has(o.ebene) && this.trifftPolygon(o, p))
			.map((o) => o.id);
		this.ausgewaehlt = dazu ? new Set([...this.ausgewaehlt, ...treffer]) : new Set(treffer);
		this.fanglinie = [];
		this.werkzeug = 'zeigen';
		return treffer.length;
	}

	private trifftPolygon(o: Objekt, p: [number, number][]) {
		return o.art === 'linie'
			? o.ringe.some((ring) => beruehrt(ring, p))
			: drin(schwerpunkt(o.ringe), p);
	}
	alsPlangebiet() {
		if (this.fanglinie.length < 3) return;
		this.plangebiet = this.fanglinie;
		this.fanglinie = [];
		this.werkzeug = 'zeigen';
	}
	plangebietLoeschen() { this.plangebiet = null; }

	/**
	 * Das Plangebiet freiraeumen.
	 *
	 * Flaechen im Gebiet werden gestrichen, Linien an der Gebietsgrenze
	 * beschnitten und laufen draussen weiter. Was als Erhalt markiert ist,
	 * bleibt unangetastet: Erst bestimmt man, was stehen bleibt, dann raeumt
	 * man den Rest weg.
	 *
	 * Wasser bleibt ebenfalls stehen. Ein Hafenbecken ist Gelaende, keine
	 * bauliche Substanz, und wer es wegraeumen will, tut das von Hand.
	 */
	freiraeumen() {
		const p = this.plangebiet;
		if (!p || p.length < 3) return { flaechen: 0, linien: 0 };
		let flaechen = 0, linien = 0;
		this.objekte = this.objekte.map((o) => {
			if (o.zustand === 'erhalt' || o.ebene === 'wasser') return o;
			if (o.art === 'linie') {
				const teile = o.ringe.flatMap((ring) => ausserhalb(ring, p));
				const vorher = o.ringe.reduce((n, r) => n + r.length, 0);
				const nachher = teile.reduce((n, r) => n + r.length, 0);
				if (nachher === vorher) return o;
				linien++;
				if (!teile.length) return { ...o, urform: o.urform ?? o.ringe, zustand: 'gestrichen' as const };
				return { ...o, urform: o.urform ?? o.ringe, ringe: teile };
			}
			if (o.zustand === 'gestrichen') return o;
			if (!drin(schwerpunkt(o.ringe), p)) return o;
			flaechen++;
			return { ...o, zustand: 'gestrichen' as const };
		});
		this.ausgewaehlt = new Set();
		return { flaechen, linien };
	}

	get beschnitten() { return this.objekte.filter((o) => o.urform).length; }

	auswahlUmkehren() {
		const sichtbar = this.objekte.filter((o) => this.sichtbar.has(o.ebene));
		this.ausgewaehlt = new Set(sichtbar.filter((o) => !this.ausgewaehlt.has(o.id)).map((o) => o.id));
	}
	alleZuruecksetzen() {
		this.objekte = this.objekte.map((o) => {
			const ringe = o.urform ?? o.ringe;
			if (o.zustand === 'normal' && !o.urform) return o;
			return { ...o, ringe, urform: undefined, zustand: 'normal' as const,
				ebene: o.ebene === 'erhalt' ? ('gebaeude' as const) : o.ebene };
		});
		this.ausgewaehlt = new Set();
	}

	umschalten(id: StiftId) {
		const s = new Set(this.sichtbar);
		s.has(id) ? s.delete(id) : s.add(id);
		this.sichtbar = s;
	}
	auswahlUmschalten(id: string) {
		const s = new Set(this.ausgewaehlt);
		s.has(id) ? s.delete(id) : s.add(id);
		this.ausgewaehlt = s;
	}
	zustandSetzen(zu: 'normal' | 'gestrichen' | 'erhalt') {
		if (!this.ausgewaehlt.size) return;
		this.objekte = this.objekte.map((o) =>
			this.ausgewaehlt.has(o.id) ? { ...o, zustand: zu, ebene: zu === 'erhalt' ? 'erhalt' : (o.ebene === 'erhalt' ? 'gebaeude' : o.ebene) } : o
		);
		this.ausgewaehlt = new Set();
	}

	// ---- Sitzung behalten ------------------------------------------------
	/**
	 * Der Bestand kommt von einer gespendeten Auskunft, die man nicht zweimal
	 * fragt, weil man zwischendurch telefoniert hat. Und das Streichen von
	 * dreihundert Haeusern ist Arbeit, keine Eingabe. Beides ueberlebt jetzt
	 * das Neuladen.
	 *
	 * Nicht gesichert wird, was nur den Moment betrifft: Auswahl, halbfertiges
	 * Polygon, Zoom, Ladezustand und Fehlermeldung. Wer wiederkommt, soll den
	 * Stand seiner Arbeit vorfinden, nicht den Mauszeiger von vorgestern.
	 */
	private static readonly FASSUNG = 1;
	private static readonly FACH = 'sitzung';
	private takt: ReturnType<typeof setTimeout> | null = null;
	gesichert = $state<number | null>(null);

	/** Ist die Wiederherstellung durch? Karte und Blatt warten darauf. */
	readonly bereit: Promise<void>;

	constructor() {
		this.bereit = this.wiederherstellen();
	}

	private packen() {
		return {
			fassung: Zustand.FASSUNG,
			schritt: this.schritt,
			ort: this.ort ? { ...this.ort, bbox: this.ort.bbox ? [...this.ort.bbox] : null } : null,
			kasten: this.kasten ? { ...this.kasten } : null,
			verhaeltnis: this.verhaeltnis.name,
			ausgabeBreite: this.ausgabeBreite,
			// Ohne Abschrift. `indexedDB` kopiert beim Ablegen selbst und liest
			// dabei durch die Zustandshuelle hindurch; `$state.snapshot` davor
			// waere eine zweite tiefe Kopie. Gemessen an sechstausend Objekten:
			// 19 Millisekunden so, 1.392 mit Abschrift.
			objekte: this.objekte,
			netz: this.netz,
			nutzflaechen: this.nutzflaechen,
			pois: this.pois,
			haltestellen: this.haltestellen,
			linien: this.linien,
			rest: this.rest,
			baeume: this.baeume,
			ergaenzung: this.ergaenzung,
			places: this.places,
			placesZeigen: this.placesZeigen,
			placesInfo: this.placesInfo,
			gelaende: this.gelaende,
			gelaendeDaten: this.gelaendeDaten,
			gelaendeFuer: this.gelaendeFuer,
			sichtbar: [...this.sichtbar],
			plangebiet: this.plangebiet,
			darstellung: this.darstellung,
			beschriftung: this.beschriftung,
			bereinigt: this.bereinigt,
			geladenFuer: this.geladenFuer,
			zeitpunkt: Date.now()
		};
	}

	/** Sichern, aber nicht bei jedem Klick. */
	sichern() {
		if (this.takt) clearTimeout(this.takt);
		this.takt = setTimeout(() => this.sofortSichern(), 500);
	}

	/**
	 * Ohne Wartetakt ablegen.
	 *
	 * Gebraucht, wenn der Reiter in den Hintergrund geht oder zugeht: Wer eine
	 * Sekunde nach dem letzten Klick schliesst, soll diesen Klick nicht
	 * verlieren.
	 */
	async sofortSichern() {
		if (this.takt) { clearTimeout(this.takt); this.takt = null; }
		const paket = this.packen();
		if (await ablegen(Zustand.FACH, paket)) this.gesichert = paket.zeitpunkt;
	}

	private async wiederherstellen(): Promise<void> {
		type Paket = ReturnType<Zustand['packen']>;
		const p = await abholen<Paket>(Zustand.FACH);
		if (!p || p.fassung !== Zustand.FASSUNG || !p.kasten) return;
		this.kasten = p.kasten;
		this.ort = p.ort;
		this.verhaeltnis = VERHAELTNISSE.find((v) => v.name === p.verhaeltnis) ?? VERHAELTNISSE[0];
		this.ausgabeBreite = p.ausgabeBreite;
		this.objekte = p.objekte ?? [];
		this.netz = p.netz ?? null;
		this.nutzflaechen = p.nutzflaechen ?? [];
		this.pois = p.pois ?? [];
		this.haltestellen = p.haltestellen ?? [];
		this.linien = p.linien ?? [];
		this.rest = p.rest ?? [];
		this.baeume = p.baeume ?? false;
		this.baumpunkte = baeumeAus(this.rest);
		this.ergaenzung = p.ergaenzung ?? null;
		this.places = p.places ?? [];
		this.placesZeigen = p.placesZeigen ?? false;
		this.placesInfo = p.placesInfo ?? null;
		this.gelaende = p.gelaende ?? false;
		this.gelaendeDaten = p.gelaendeDaten ?? null;
		this.gelaendeFuer = p.gelaendeFuer ?? null;
		this.sichtbar = new Set(p.sichtbar ?? STIFTE.map((s) => s.id));
		this.plangebiet = p.plangebiet;
		this.darstellung = p.darstellung;
		this.beschriftung = p.beschriftung;
		this.bereinigt = p.bereinigt;
		this.geladenFuer = p.geladenFuer;
		// Schritt 2 und 3 setzen Bestand voraus. Ohne ihn faengt man vorn an.
		this.schritt = this.objekte.length ? p.schritt : 1;
		this.gesichert = p.zeitpunkt;
	}

	/** Sitzung vergessen und bei null anfangen. */
	async verwerfen() {
		if (this.takt) clearTimeout(this.takt);
		await wegwerfen(Zustand.FACH);
		this.objekte = [];
		this.netz = null;
		this.nutzflaechen = [];
		this.pois = [];
		this.haltestellen = [];
		this.linien = [];
		this.rest = [];
		this.baumpunkte = [];
		this.gelaendeDaten = null;
		this.gelaendeFuer = null;
		this.ergaenzung = null;
		this.places = [];
		this.placesInfo = null;
		this.ausgewaehlt = new Set();
		this.plangebiet = null;
		this.geladenFuer = null;
		this.gesichert = null;
		this.schritt = 1;
	}
}

export const z = new Zustand();
export { VERHAELTNISSE, AUSGABEBREITEN };
