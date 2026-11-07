import { t, zahl } from './sprache.svelte';
import { Rahmen, VERHAELTNISSE, AUSGABEBREITEN, type Verhaeltnis } from './geo/rahmen';
import { ortsgitter, nachGitter } from './geo/utm';
import { lesen, imRahmen, einfriedungenAus, naturAus, sichtEbene, istTeil, zweifelhafteGebaeude, ZWEIFEL_ENTHAELT, type Objekt, type Zweifel } from './osm';
import { drin, beruehrt, ausserhalb, schwerpunkt } from './schneiden';
import { NEUTRAL, type Anpassung } from './anpassen';
import { DARSTELLUNGEN, darstellung as darstellungVon } from './darstellung';
import { STIFTE, type StiftId } from './stifte';
import { kantenHellFuer } from './zeichnen';
import { base } from '$app/paths';
import { ablegen, abholen, wegwerfen } from './ablage';
import { holeBestand, QuellFehler, Abgebrochen } from './quelle';
import { DRUCK_VORGABE } from './export/druck';
import { SATZ_PLAN, SATZ_RAUM, satzKopie, satzAus, type Baumwahl, type Baumsatz } from './export/baeume';
import { PFLANZ_VORGABE, gebietAnwenden, ausGebieten, type Pflanzwahl, type Gebiet, type Form } from './pflanzen';
import { holeGelaende, wasserEbnen, netzWeite, type Gelaende } from './geo/gelaende';
import { holeOverture, gebaeudeErgaenzen, placesAus, type Place } from './overture';
import { netzAus, nutzflaechenAus, poisAus, halteAus, restAus, baeumeAus, waldBaeume, naturBaeume, NATUR_VORGABE, type NaturWahl, type Baum,
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

/**
 * Wie weit eine Abfrage über den Rahmen hinaus vollständig ist. Overpass
 * fragt 150 m Rand ab (`quelle.ts`), in Grad gerechnet; 10 m Spiel für die
 * Umrechnung zurück ins Gitter.
 */
const DATEN_RAND_M = 140;
/** Liegt `innen` ganz in `aussen`, im selben Gitter? Ein halber Meter Spiel fürs Runden. */
export function liegtIn(innen: Kasten | null, aussen: Kasten | null): boolean {
	// Der Schlüssel speichert lon0 auf fünf Stellen. Mit 1e-6 galt ein Rahmen
	// bei 10,1629182° (Rothenburg) nie als gedeckt, und das Gelände wurde
	// endlos neu geholt, das Modell neu gebaut und das Bodenbild neu geschärft
	// (Volker, 06.11.2026). Ein Hunderttausendstel Grad ist unter einem Meter.
	if (!innen || !aussen || Math.abs(innen.lon0 - aussen.lon0) > 1e-5) return false;
	return innen.x0 >= aussen.x0 - 0.5 && innen.y0 >= aussen.y0 - 0.5
		&& innen.x1 <= aussen.x1 + 0.5 && innen.y1 <= aussen.y1 + 0.5;
}
const kastenAus = (s: string | null): Kasten | null => {
	if (!s) return null;
	const [lon0, x0, y0, x1, y1] = s.split(':').map(Number);
	return [lon0, x0, y0, x1, y1].every(Number.isFinite) ? { lon0, x0, y0, x1, y1 } : null;
};


/** Die Kanten im 3D-Modell, wie sie ab Werk stehen (Volker, 04.11.2026): fein und leise. */
/**
 * `flaeche`: Helligkeit der Gebäude von 0 (schwarz) bis 1 (weiß), unter
 * „Geometrie anpassen". `null` heißt: jede Darstellung behält ihre eigene
 * Gebäudefarbe.
 */
/**
 * Die Sonne der Darstellung, nicht die echte: Richtung, aus der sie scheint
 * (0° Nord, im Uhrzeigersinn), und Höhe über dem Horizont. Ab Werk aus
 * Nordwesten unter 49°, wie in der Kartografie üblich (Volker, 04.11.2026:
 * Richtung und Winkel einstellbar). Den Sonnenstand eines Tages rechnet Umbra.
 *
 * `an: false` ist bedeckter Himmel, ohne Schlagschatten, auch im
 * Weißmodell; `helligkeit` belichtet das 3D-Modell, `waerme` färbt sein
 * Licht von kühl (−1) über neutral (0) bis warm (1).
 */
export const SONNE_VORGABE: { azimut: number; hoehe: number; an: boolean; helligkeit: number; waerme: number } =
	{ azimut: 315, hoehe: 49, an: true, helligkeit: 1, waerme: 0 };

/** Was eine Darstellung sich merkt: Karte, Gebäudekanten, Bäume. */
type Look = { karte: Anpassung; kanten: typeof KANTEN_VORGABE; sonne: typeof SONNE_VORGABE };
export const KANTEN_VORGABE: { an: boolean; dicke: number; deckkraft: number; karteDicke: number; karteDeckkraft: number; hell: boolean | null; flaeche: number | null } =
	{ an: true, dicke: 0.75, deckkraft: 0.75, karteDicke: 1, karteDeckkraft: 1, hell: null, flaeche: null };

/** Vor der Kennung eines Baums in der Auswahl, damit sie keinem Objekt gleicht. */
export const BAUM_ID = 'baum:';

const PROJEKT_FORMAT = 'nolli-projekt';
/** Fassung der Projektdatei. Die Sitzung darin trägt ihre eigene, `Zustand.FASSUNG`. */
const PROJEKT_FASSUNG = 1;

class Zustand {
	private _schritt = $state<1 | 2 | 3>(1);
	/** Wer Schritt 1 verlässt, bekommt den Bestand zum Rahmen, auch wenn der Takt von `zuschneidenBald` noch läuft. */
	get schritt() { return this._schritt; }
	set schritt(n: 1 | 2 | 3) { if (n > 1) this.zuschneiden(); this._schritt = n; }
	ort = $state<Ort | null>(null);
	private _kasten = $state<Kasten | null>(null);
	get kasten() { return this._kasten; }
	set kasten(k: Kasten | null) { this._kasten = k; this.zuschneidenBald(); }

	/**
	 * Wie weit die geholten Daten reichen, im Ortsgitter (Volker, 06.11.2026).
	 *
	 * Vorher hing der Bestand an genau einem Rahmen: Wer ihn um einen Meter
	 * kleiner zog, musste neu holen, und alles Gestrichene war weg. Jetzt ist
	 * der Rahmen eine Sicht auf die Daten. Liegt er in dieser Fläche, wird nur
	 * neu einsortiert, ohne Abruf; ragt er hinaus, holt `holen` nach und
	 * behält dabei, was bearbeitet war.
	 */
	datenFlaeche = $state.raw<Kasten | null>(null);
	/** Wann die Daten geholt wurden, ISO. Ein geöffnetes Projekt sagt damit, wie alt sein Bestand ist. */
	datenStand = $state<string | null>(null);
	/**
	 * Was in der Datenfläche liegt, aber den Rahmen nicht berührt. Kommt
	 * zurück, wenn der Rahmen wächst oder wandert, mit allen Bearbeitungen.
	 */
	vorrat = $state.raw<Objekt[]>([]);
	/** Places der Abfrage, die außerhalb des Rahmens liegen. Wie `vorrat`. */
	placesVorrat = $state.raw<Place[]>([]);
	private zugeschnittenFuer: string | null = null;
	private schnittTakt: ReturnType<typeof setTimeout> | null = null;

	/** Beim Ziehen am Rahmen nicht bei jeder Mausbewegung einsortieren. */
	private zuschneidenBald() {
		if (this.schnittTakt) clearTimeout(this.schnittTakt);
		this.schnittTakt = setTimeout(() => this.zuschneiden(), 250);
	}

	/**
	 * Den Bestand dem Rahmen anpassen, aus dem, was da ist. Ohne Abruf.
	 *
	 * Was den Rahmen berührt, steht in `objekte`, der Rest im `vorrat`; beide
	 * zusammen sind immer dieselben Objekte, mit ihren Bearbeitungen. Overture
	 * und Places gelten für den Rahmen, für den sie geholt wurden: Wächst er
	 * darüber hinaus, fallen sie weg, denn am neuen Rand fehlten sie sonst
	 * still.
	 */
	zuschneiden() {
		if (this.schnittTakt) { clearTimeout(this.schnittTakt); this.schnittTakt = null; }
		const k = this._kasten;
		const key = this.schluessel();
		if (!k || !this.datenAktuell || key === this.zugeschnittenFuer) return;
		let alle = [...this.objekte, ...this.vorrat];
		if (this.ergaenzung && !liegtIn(k, this.ergaenzung.fuer ?? null)) {
			alle = alle.filter((o) => o.herkunft !== 'overture');
			this.ergaenzung = null;
		}
		const drin = new Set(imRahmen(alle, k.x0, k.y0, k.x1, k.y1).map((o) => o.id));
		this.objekte = alle.filter((o) => drin.has(o.id));
		this.vorrat = alle.filter((o) => !drin.has(o.id));
		if (this.ergaenzung) {
			const quellen: Record<string, number> = {};
			let anzahl = 0;
			for (const x of this.objekte) if (x.herkunft === 'overture') {
				anzahl++;
				quellen[x.quelleGeometrie ?? 'Overture'] = (quellen[x.quelleGeometrie ?? 'Overture'] ?? 0) + 1;
			}
			this.ergaenzung = { ...this.ergaenzung, quellen, anzahl };
		}
		if (this.placesInfo && !liegtIn(k, this.placesInfo.fuer ?? null)) {
			this.places = []; this.placesVorrat = []; this.placesInfo = null;
		} else if (this.placesInfo) {
			const p = [...this.places, ...this.placesVorrat];
			const innen = (q: Place) => q.x >= k.x0 && q.x <= k.x1 && q.y >= k.y0 && q.y <= k.y1;
			this.places = p.filter(innen);
			this.placesVorrat = p.filter((q) => !innen(q));
		}
		if (this.ausgewaehlt.size) this.ausgewaehlt = new Set([...this.ausgewaehlt].filter((id) => drin.has(id) || id.startsWith(BAUM_ID)));
		this.zugeschnittenFuer = key;
	}
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
	baumpunkte = $state.raw<Baum[]>([]);
	/**
	 * Gestrichene Bäume, nach OSM-Kennung (06.11.2026).
	 *
	 * Bäume sind keine Objekte mit Zustand, sie werden bei jedem Laden aus
	 * `rest` neu gelesen. Gestrichen wird deshalb nicht am Baum, sondern in
	 * dieser Liste; ein neues Holen am selben Ort findet dieselben Kennungen.
	 * In der Auswahl stehen Bäume mit `BAUM_ID` davor.
	 */
	baumGestrichen = $state.raw(new Set<string>());

	// ---- Bäume pflanzen (07.11.2026) -------------------------------------
	/**
	 * Was gepflanzt wurde, als Gebiete mit ihrer Wahl (`pflanzen.ts`); die
	 * Bäume entstehen daraus. So lässt sich ein Gebiet nachträglich ändern.
	 */
	pflanzGebiete = $state.raw<Gebiet[]>([]);
	/** Die Bäume aus den Gebieten, eine eigene Ebene „Bäume ergänzt“. */
	gepflanzt = $state.raw<Baum[]>([]);
	/** Die Ebene an oder aus; aus heißt: in keiner Ausgabe. */
	gepflanztAn = $state(true);
	pflanzWahl = $state<Pflanzwahl>({ ...PFLANZ_VORGABE });
	/** Das Fenster offen: Der Plan malt statt zu wählen. Nicht gespeichert. */
	pflanzOffen = $state(false);
	/** Gewählte Gebiete, zum nachträglichen Ändern. Nicht gespeichert. */
	pflanzAuswahl = $state.raw(new Set<number>());
	private pflanzVerlauf: Gebiet[][] = [];
	pflanzSchritte = $state(0);
	private naechstesGebiet = 1;
	private pflanzNeu() { this.gepflanzt = ausGebieten(this.objekte, this.pflanzGebiete); }
	private pflanzMerken() {
		this.pflanzVerlauf.push(this.pflanzGebiete);
		if (this.pflanzVerlauf.length > 50) this.pflanzVerlauf.shift();
		this.pflanzSchritte = this.pflanzVerlauf.length;
	}
	/** Die Wahl für ein neues Gebiet, ohne Werkzeugangaben. */
	private wahlJetzt(): Pflanzwahl { return $state.snapshot(this.pflanzWahl); }
	private gebietNeu(form: Form): Gebiet {
		return { id: this.naechstesGebiet++, form, radieren: this.pflanzWahl.radieren, wahl: this.wahlJetzt() };
	}
	/** Pinselzug beginnen: ein neues Gebiet aus Kreisen. */
	pflanzZugBeginnen(x: number, y: number) {
		this.pflanzMerken();
		const g = this.gebietNeu({ art: 'kreise', kreise: [] });
		this.pflanzGebiete = [...this.pflanzGebiete, g];
		this.pflanzKreis(x, y);
	}
	/** Pinsel: einen Kreis an das laufende Gebiet hängen und nur dort setzen. */
	pflanzKreis(x: number, y: number) {
		const g = this.pflanzGebiete[this.pflanzGebiete.length - 1];
		if (!g || g.form.art !== 'kreise') return;
		const r = this.pflanzWahl.pinselM / 2;
		g.form.kreise.push([x, y, r]);
		const neu = gebietAnwenden(this.objekte, this.gepflanzt, g, [x, y, r]);
		if (neu !== this.gepflanzt) this.gepflanzt = neu;
	}
	/** Lasso: die umfahrene Fläche als Gebiet. */
	pflanzRing(ring: [number, number][]) {
		if (ring.length < 3) return;
		this.pflanzMerken();
		const g = this.gebietNeu({ art: 'ring', ring: ring.map(([x, y]) => [x, y] as [number, number]) });
		this.pflanzGebiete = [...this.pflanzGebiete, g];
		this.gepflanzt = gebietAnwenden(this.objekte, this.gepflanzt, g);
	}
	/** Ein Baum per Klick; mit Radieren der nächste in Reichweite weg. */
	pflanzEinzel(x: number, y: number) {
		this.pflanzMerken();
		const g = this.gebietNeu({ art: 'punkt', x, y });
		this.pflanzGebiete = [...this.pflanzGebiete, g];
		this.gepflanzt = gebietAnwenden(this.objekte, this.gepflanzt, g);
	}
	pflanzRueckgaengig() {
		const alt = this.pflanzVerlauf.pop();
		if (alt) { this.pflanzGebiete = alt; this.pflanzNeu(); }
		this.pflanzSchritte = this.pflanzVerlauf.length;
		this.pflanzAuswahl = new Set();
	}
	pflanzAlleWeg() { this.pflanzMerken(); this.pflanzGebiete = []; this.gepflanzt = []; this.pflanzAuswahl = new Set(); }
	/** Klick im Wählen: das Gebiet des getroffenen gepflanzten Baums, mit Umschalt dazu. */
	pflanzWaehlen(x: number, y: number, dazu: boolean) {
		let best: Baum | null = null, d = Infinity;
		for (const b of this.gepflanzt) { const a = Math.hypot(b.x - x, b.y - y); if (a < d) { d = a; best = b; } }
		// Getroffen ist, was näher liegt als Krone oder Pflanzabstand: Zwischen
		// zwei Bäumen geklickt, soll ihr Gebiet trotzdem gemeint sein.
		const abstand = best ? this.pflanzGebiete.find((g) => g.id === best!.gebiet)?.wahl.abstandM ?? 0 : 0;
		const id = best && d <= Math.max(4, best.krone, abstand) ? best.gebiet : undefined;
		if (id === undefined) { if (!dazu) this.pflanzAuswahl = new Set(); return; }
		const s = new Set(dazu ? this.pflanzAuswahl : []);
		if (dazu && s.has(id)) s.delete(id); else s.add(id);
		this.pflanzAuswahl = s;
		// Die Regler zeigen die Wahl des gewählten Gebiets.
		const g = this.pflanzGebiete.find((x) => x.id === id);
		if (g) Object.assign(this.pflanzWahl, { abstandM: g.wahl.abstandM, kroneM: g.wahl.kroneM, variation: g.wahl.variation, art: g.wahl.art, nadelAnteil: g.wahl.nadelAnteil, freiGebaeude: g.wahl.freiGebaeude, freiWasser: g.wahl.freiWasser, freiStrassen: g.wahl.freiStrassen });
	}
	/** Liegt an der Stelle ein gepflanzter Baum, dessen Gebiet ein Klick wählen würde? */
	pflanzTrifft(x: number, y: number) {
		for (const b of this.gepflanzt) {
			const abstand = this.pflanzGebiete.find((g) => g.id === b.gebiet)?.wahl.abstandM ?? 0;
			if (Math.hypot(b.x - x, b.y - y) <= Math.max(4, b.krone, abstand)) return true;
		}
		return false;
	}
	pflanzAlleWaehlen() { this.pflanzAuswahl = new Set(this.pflanzGebiete.filter((g) => !g.radieren && g.form.art !== 'fest').map((g) => g.id)); }
	/**
	 * Einen Wert setzen. Ohne Auswahl gilt er für das, was man als Nächstes
	 * pflanzt; mit Auswahl auch für die gewählten Gebiete, die dann neu
	 * gesetzt werden.
	 */
	pflanzSetzen<K extends keyof Pflanzwahl>(k: K, v: Pflanzwahl[K]) {
		this.pflanzWahl[k] = v;
		if (!this.pflanzAuswahl.size || k === 'werkzeug' || k === 'radieren' || k === 'pinselM') return;
		this.pflanzGebiete = this.pflanzGebiete.map((g) => this.pflanzAuswahl.has(g.id) ? { ...g, wahl: { ...g.wahl, [k]: v } } : g);
		this.pflanzNeu();
	}
	/** Vor dem ersten Zug an einem Regler mit Auswahl: für Rückgängig merken. */
	pflanzAenderungBeginnen() { if (this.pflanzAuswahl.size) this.pflanzMerken(); }
	pflanzAuswahlWeg() {
		if (!this.pflanzAuswahl.size) return;
		this.pflanzMerken();
		this.pflanzGebiete = this.pflanzGebiete.filter((g) => !this.pflanzAuswahl.has(g.id));
		this.pflanzAuswahl = new Set();
		this.pflanzNeu();
	}
	/** Die Bäume, die stehen bleiben: Was Modell, Bild und Paket bekommen. */
	get baeumeStehend() {
		const weg = this.baumGestrichen;
		return weg.size ? this.baumpunkte.filter((b) => !b.id || !weg.has(b.id)) : this.baumpunkte;
	}
	/**
	 * Erfundene Bäume in Waldflächen (`waldBaeume`), im Rahmen plus 150 m, wie
	 * die echten. Nur für die Körper in Ansicht, OBJ und 3DM; `data/trees.json`
	 * bleibt bei den eingetragenen.
	 */
	private waldMerk: { schluessel: unknown[]; liste: { baeume: Baum[]; abstandM: number } } | null = null;
	/** Waldbäume für einen Abstand, gemerkt, solange Daten und Rahmen gleich bleiben. */
	waldFuer(wald: boolean, abstand: number): { baeume: Baum[]; abstandM: number } {
		const k = this._kasten;
		if (!k || !wald) return { baeume: [], abstandM: abstand };
		const schluessel = [this.objekte, this.rest, k, abstand];
		if (this.waldMerk && this.waldMerk.schluessel.every((v, i) => v === schluessel[i])) return this.waldMerk.liste;
		const liste = waldBaeume(this.objekte, this.rest, [k.x0 - 150, k.y0 - 150, k.x1 + 150, k.y1 + 150], abstand);
		this.waldMerk = { schluessel, liste };
		return liste;
	}
	/**
	 * Die drei Herkünfte, je an oder aus, für alle Darstellungen gleich
	 * (07.11.2026): Bestand aus OSM samt Baumreihen, Wald aus Waldflächen im
	 * Abstand `waldAbstand`, Ergänzt von Hand (`gepflanztAn`).
	 */
	bestandAn = $state(true);
	waldAn = $state(true);
	waldAbstand = $state(9);
	/** Gehölze in Naturflächen (Gebüsch, Heide): an/aus und Verteilung. */
	naturAn = $state(true);
	naturWahl = $state<NaturWahl>({ ...NATUR_VORGABE });
	naturListe = $derived.by(() => {
		const k = this._kasten, w = this.naturWahl;
		if (!k || !this.naturAn) return [] as Baum[];
		return naturBaeume(this.objekte, [k.x0 - 150, k.y0 - 150, k.x1 + 150, k.y1 + 150], { abstandM: w.abstandM, kroneM: w.kroneM, variation: w.variation, ballung: w.ballung });
	});
	/** Das Aussehen je Herkunft, ein Satz für alle Pläne und einer für das 3D-Modell. */
	baumLooks = $state<{ plan: Baumsatz; raum: Baumsatz }>({ plan: satzKopie(SATZ_PLAN), raum: satzKopie(SATZ_RAUM) });
	/** Der Satz der gezeigten Darstellung. */
	get baumSatz(): Baumsatz { return darstellungVon(this.darstellung).bauweise === 'raum' ? this.baumLooks.raum : this.baumLooks.plan; }
	/** Die Waldbäume. */
	waldListe = $derived.by(() => this.waldFuer(this.waldAn, this.waldAbstand));
	/** Was als Baum gebaut oder gezeichnet wird: die eingeschalteten Herkünfte. */
	get baeumeModell(): Baum[] {
		return [...(this.bestandAn ? this.baeumeStehend : []), ...this.waldListe.baeume, ...this.naturListe, ...(this.gepflanztAn ? this.gepflanzt : [])];
	}
	sichtbar = $state(new Set<StiftId>(STIFTE.map((s) => s.id)));
	hervorgehoben = $state<StiftId | null>(null);
	ausgewaehlt = $state(new Set<string>());
	plangebiet = $state.raw<[number, number][] | null>(null);

	darstellung = $state('schwarzplan');

	/**
	 * Karte und Gebäude je Darstellung (Volker, 07.11.2026). Ein entsättigter,
	 * kontrastreicher Boden war im 3D-Modell ein guter Look und verzog den
	 * Schwarzplan, weil alle Darstellungen dieselben Werte teilten. Jetzt hat
	 * jede ihren Satz: `karte` und `kanten` sind die der gezeigten
	 * Darstellung, `looks` hält die übrigen. Wer keinen hat, steht auf der
	 * Vorgabe.
	 */
	looks = $state<Record<string, Look>>({});
	/** Der gezeigte Look als Kopie. */
	private lookJetzt(): Look {
		return { karte: $state.snapshot(this.karte), kanten: $state.snapshot(this.kanten), sonne: $state.snapshot(this.sonne) };
	}
	/** Die Werte einer Darstellung, auch der gezeigten. Die Bäume stehen seit 07.11.2026 in `baumLooks`. */
	lookFuer(id: string): Look {
		if (id === this.darstellung) return this.lookJetzt();
		const l = this.looks[id];
		return { karte: { ...NEUTRAL, ...(l?.karte ?? {}) }, kanten: { ...KANTEN_VORGABE, ...(l?.kanten ?? {}) }, sonne: { ...SONNE_VORGABE, ...(l?.sonne ?? {}) } };
	}
	/** Alle Looks samt dem gezeigten, für die Projektdatei. */
	alleLooks() {
		return { ...$state.snapshot(this.looks), [this.darstellung]: this.lookJetzt() };
	}
	/** Karte und Gebäude, oder die Bäume, der gezeigten Darstellung auf alle übertragen. */
	lookFuerAlle(teil: 'karte' | 'sonne' = 'karte') {
		const jetzt = this.lookJetzt();
		this.looks = Object.fromEntries(DARSTELLUNGEN.map((d) => {
			const l = this.lookFuer(d.id);
			return [d.id, teil === 'sonne' ? { ...l, sonne: { ...jetzt.sonne } }
				: { ...l, karte: { ...jetzt.karte }, kanten: { ...jetzt.kanten } }];
		}));
	}
	/**
	 * Alle Darstellungen auf ihre Vorgabe (Volker, 07.11.2026): Karte, Gebäude
	 * und Licht je Darstellung, dazu das Aussehen der Bäume in Plänen und 3D.
	 * Was gezeigt wird und welche Bäume an sind, bleibt.
	 */
	alleDarstellungenZuruecksetzen() {
		this.looks = {};
		this.karte = { ...NEUTRAL };
		this.kanten = { ...KANTEN_VORGABE };
		this.sonne = { ...SONNE_VORGABE };
		this.baumLooks = { plan: satzKopie(SATZ_PLAN), raum: satzKopie(SATZ_RAUM) };
	}
	/**
	 * Stände von vor dem 07.11.2026 führten Zäune und Mauern nur im Rest.
	 * Fehlt die Ebene, wird sie daraus gebaut und aus dem Rest genommen.
	 */
	private einfriedungenNachholen() {
		// Naturflächen (07.11.2026) ebenso, wenn der Rest noch welche führt.
		const natur = naturAus(this.rest);
		const neu = [...(this.objekte.some((o) => o.ebene === 'grenze') ? [] : einfriedungenAus(this.rest)), ...natur];
		if (!neu.length) return;
		const k = this._kasten;
		const drin = k ? imRahmen(neu, k.x0, k.y0, k.x1, k.y1) : neu;
		const ids = new Set(neu.map((o) => o.id));
		this.objekte = [...this.objekte, ...drin];
		this.rest = this.rest.filter((e) => !ids.has(e.id));
	}
	/** Darstellung wechseln; Karte, Gebäude und Bäume wechseln mit. */
	darstellungWaehlen(id: string) {
		if (id === this.darstellung) return;
		this.looks = { ...this.looks, [this.darstellung]: this.lookJetzt() };
		const neu = this.lookFuer(id);
		this.darstellung = id;
		this.karte = neu.karte;
		this.kanten = neu.kanten;
		this.sonne = neu.sonne;
	}
	/** Die Kantenfarbe, die gerade gilt: eigene Wahl oder Vorgabe der Darstellung. */
	get kantenHell() { return this.kanten.hell ?? kantenHellFuer(this.darstellung); }
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
	/** Sättigung und Kontrast des Bodenbilds im 3D-Modell und in `model_texture.png`. */
	karte = $state<Anpassung>({ ...NEUTRAL });
	/** Die Kanten im 3D-Modell: an oder aus, Stärke in Bildschirmpunkten, Deckkraft 0 bis 1. */
	kanten = $state({ ...KANTEN_VORGABE });
	sonne = $state({ ...SONNE_VORGABE });
	/** Form, Größe, Variation und Farbe der Bäume (`export/baeume.ts`). */
	/** Einstellungen für den 3D-Druck (`export/druck.ts`). */
	druck = $state({ ...DRUCK_VORGABE });
	/** Was die Bühne in Schritt 3 statt der Ansicht zeigt: die Druckvorschau oder den Druckausschnitt. Nicht gespeichert. */
	druckBuehne = $state<null | 'vorschau' | 'ausschnitt'>(null);
	/**
	 * Das 3D-Bild, getrennt von der Karte (Volker, 04.11.2026): eigenes Format
	 * und eigene Breite. `rahmen` zeigt den Ausschnitt in der Ansicht.
	 */
	bild3d = $state<{ format: string; breite: number; rahmen: boolean; hintergrund: string | null; transparent: boolean }>(
		{ format: 'ansicht', breite: 4096, rahmen: false, hintergrund: null, transparent: false });

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
	ergaenzung = $state.raw<{ release: string; quellen: Record<string, number>; anzahl: number; fuer?: Kasten } | null>(null);

	/**
	 * Gebäude, die die Prüfung nach dem Holen angezweifelt hat (`zweifelhafteGebaeude`).
	 * Was viele Häuser enthält, ist dann schon gestrichen; was nur groß ist,
	 * steht zur Entscheidung. Die Liste bleibt, auch wenn man umentscheidet,
	 * damit der Hinweis zeigt, was Nolli getan hat und was man selbst.
	 */
	zweifel = $state.raw<Zweifel[]>([]);

	/** Ein angezweifeltes Gebäude streichen oder zurückholen. */
	zweifelSetzen(id: string, streichen: boolean) {
		this.objekte = this.objekte.map((o) =>
			o.id === id ? { ...o, zustand: streichen ? 'gestrichen' as const : 'normal' as const } : o);
	}
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
			// Ein gestrichenes umgetaggtes Gebiet (Mariental) darf nicht jedes
			// Haus darin blockieren. Was man selbst gestrichen hat, schon.
			const zweifelWeg = new Set(this.zweifel.map((x) => x.id));
			const e = gebaeudeErgaenzen(o.merkmale, r.gitter,
				osm.filter((x) => !(zweifelWeg.has(x.id) && x.zustand === 'gestrichen')));
			const neu = imRahmen(e.objekte, r.x0, r.y0, r.x1, r.y1);
			const quellen: Record<string, number> = {};
			for (const x of neu) quellen[x.quelleGeometrie ?? 'Overture'] = (quellen[x.quelleGeometrie ?? 'Overture'] ?? 0) + 1;
			this.objekte = [...osm, ...neu];
			this.vorrat = this.vorrat.filter((x) => x.herkunft !== 'overture');
			this.ergaenzung = { release: o.release, quellen, anzahl: neu.length, fuer: { ...this._kasten! } };
			// Wer ergänzt, will sie sehen — auch wenn die Ebene zuletzt aus war.
			if (!this.sichtbar.has('overture')) this.sichtbar = new Set([...this.sichtbar, 'overture']);
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
		this.vorrat = this.vorrat.filter((x) => x.herkunft !== 'overture');
		this.ausgewaehlt = new Set([...this.ausgewaehlt].filter((id) => !id.startsWith('ov')));
		this.ergaenzung = null;
	}

	/**
	 * Orte aus Overture Places, auf Knopfdruck (`overture.ts`). In dichten
	 * Städten mehrere Megabyte, deshalb nie nebenbei.
	 */
	places = $state.raw<Place[]>([]);
	placesInfo = $state.raw<{ release: string; fuer?: Kasten } | null>(null);
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
			this.placesVorrat = [];
			this.placesInfo = { release: o.release, fuer: { ...this._kasten! } };
		} catch (e) {
			if (!stopper.signal.aborted)
				this.fehler = t().overture.fehler(e instanceof Error ? e.message : String(e));
		} finally {
			this.placesLaedt = null;
			this.placesStopper = null;
		}
	}

	placesAbbrechen() { this.placesStopper?.abort(); }

	placesEntfernen() { this.places = []; this.placesVorrat = []; this.placesInfo = null; }

	gelaende = $state(false);
	gelaendeDaten = $state.raw<Gelaende | null>(null);
	gelaendeFuer = $state<string | null>(null);
	gelaendeLaedt = $state<string | null>(null);

	/**
	 * Das Raster mit ebenen Wasserflächen, einmal je geholtem Raster und
	 * Wasserbestand gerechnet. Alles, was Höhen liest — Ansicht, OBJ, DXF,
	 * 3DM, Höhenlinien —, bekommt so dieselbe Fläche.
	 */
	private geebnet = $derived.by(() => {
		const g = this.gelaendeDaten;
		if (!g) return null;
		const r = this.rahmen;
		// Saum eine Masche breit: so weit reicht ein Dreieck über die Uferlinie.
		return wasserEbnen(g, this.objekte.filter((o) => o.ebene === 'wasser' && o.art === 'flaeche'), r ? netzWeite(r) : undefined);
	});
	/** Das Raster, wenn das Gelände an ist und zum Rahmen passt. Sonst null. */
	get gelaendeJetzt(): Gelaende | null {
		return this.gelaende && this.gelaendeDeckt ? this.geebnet : null;
	}

	/**
	 * Das Raster holen, wenn es zum Rahmen noch keins gibt.
	 *
	 * Ein laufender Abruf wird nicht doppelt gestartet, sondern abgewartet:
	 * Wer während des Ladens ausgibt, bekommt das Paket mit Gelände und nicht
	 * eines, in dem die angekündigte Geländedatei fehlt.
	 */
	/**
	 * Passt das Raster zum Rahmen? Es wurde für einen Rahmen mit 150 m Rand
	 * geholt; liegt der jetzige darin, reicht es weiter (06.11.2026).
	 */
	get gelaendeDeckt() { return !!this.gelaendeDaten && liegtIn(this._kasten, kastenAus(this.gelaendeFuer)); }
	private gelaendeLauf: Promise<void> | null = null;
	gelaendeHolen(): Promise<void> {
		const r = this.rahmen;
		const k = this.schluessel();
		if (!r || !k || this.gelaendeDeckt) return Promise.resolve();
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

	get gestrichene() { return this.objekte.filter((o) => o.zustand === 'gestrichen').length + this.baumGestrichen.size; }
	get erhaltene() { return this.objekte.filter((o) => o.zustand === 'erhalt').length; }
	/** Wie weit die geholten Daten mindestens über den Rahmen reichen, in Metern; 0 ohne Rand. */
	get datenRand() {
		const k = this._kasten, d = this.datenFlaeche;
		if (!this.datenAktuell || !k || !d) return 0;
		return Math.max(0, Math.min(k.x0 - d.x0, k.y0 - d.y0, d.x1 - k.x1, d.y1 - k.y1));
	}
	/** Liegt der Rahmen in den geholten Daten? Dann braucht er keinen Abruf. */
	get datenAktuell() { return !!this.geladenFuer && liegtIn(this._kasten, this.datenFlaeche); }
	/** Ist der Rahmen ein anderer als der, für den geholt wurde? */
	get rahmenGeaendert() { return !!this.geladenFuer && this.geladenFuer !== this.schluessel(); }
	/** Ragt der Rahmen über geholte Daten im selben Gitter hinaus? Dann holt `holen` nach und behält die Bearbeitungen. */
	get datenNachholbar() {
		const k = this._kasten, d = this.datenFlaeche;
		return !!k && !!d && !!this.geladenFuer && !this.datenAktuell && Math.abs(k.lon0 - d.lon0) < 1e-5
			&& !(k.x1 < d.x0 || k.x0 > d.x1 || k.y1 < d.y0 || k.y0 > d.y1);
	}

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
		const rKey = this.schluessel();
		const lon0 = this._kasten!.lon0;
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
			// Bearbeitet ist, was gestrichen, erhalten oder beschnitten wurde.
			// Wer den Rahmen nur vergrößert, soll das nicht noch einmal tun
			// müssen: Dieselbe OSM-Kennung bekommt ihren bearbeiteten Stand
			// zurück. Im anderen Gitter heißt das: anderer Ort, nichts behalten.
			const d = this.datenFlaeche;
			const gleichesGitter = !!d && Math.abs(d.lon0 - lon0) < 1e-5;
			const bearbeitet = new Map(gleichesGitter
				? [...this.objekte, ...this.vorrat].filter((o) => !o.herkunft && (o.zustand !== 'normal' || o.urform)).map((o) => [o.id, o])
				: []);
			// Ein anderer Ort ist ein anderes Projekt; Nachholen am selben bleibt eines.
			if (!gleichesGitter) { this.projektVergessen(); this.baumGestrichen = new Set(); this.gepflanzt = []; this.pflanzGebiete = []; }
			const flaeche: Kasten = { lon0, x0: r.x0 - DATEN_RAND_M, y0: r.y0 - DATEN_RAND_M, x1: r.x1 + DATEN_RAND_M, y1: r.y1 + DATEN_RAND_M };
			this.ergaenzung = null;
			this.places = []; this.placesVorrat = []; this.placesInfo = null;
			// Gelesen wird die ganze Datenfläche, mit dem Meer bis an ihren
			// Rand; was den Rahmen nicht berührt, wartet im Vorrat.
			const alle = lesen(roh, r.gitter, flaeche);
			const drin = new Set(imRahmen(alle, r.x0, r.y0, r.x1, r.y1).map((o) => o.id));
			this.objekte = alle.filter((o) => drin.has(o.id));
			this.vorrat = alle.filter((o) => !drin.has(o.id));
			// Umgetaggte Gebiete gleich streichen, sonst decken sie alles zu.
			this.zweifel = zweifelhafteGebaeude(this.objekte);
			const weg = new Set(this.zweifel.filter((x) => x.enthaelt >= ZWEIFEL_ENTHAELT).map((x) => x.id));
			if (weg.size) this.objekte = this.objekte.map((o) => weg.has(o.id) ? { ...o, zustand: 'gestrichen' as const } : o);
			if (bearbeitet.size) {
				const zurueck = (o: Objekt) => bearbeitet.get(o.id) ?? o;
				this.objekte = this.objekte.map(zurueck);
				this.vorrat = this.vorrat.map(zurueck);
			}
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
			this.datenFlaeche = flaeche;
			this.datenStand = new Date().toISOString();
			this.geladenFuer = rKey;
			this.zugeschnittenFuer = rKey;
			// Wurde während des Holens am Rahmen gezogen, gleich nachziehen.
			this.zuschneiden();
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
			// Die Beispiele tragen nur ihren Rahmen. Kleiner ziehen geht ohne
			// Abruf, größer holt nach.
			this.vorrat = [];
			this.projektVergessen(); this.baumGestrichen = new Set(); this.gepflanzt = []; this.pflanzGebiete = [];
			this.datenFlaeche = d.datenFlaeche ?? { ...d.kasten };
			this.datenStand = d.stand ?? null;
			this.ergaenzung = null;
			this.places = []; this.placesVorrat = []; this.placesInfo = null;
			this.netz = d.netz ?? null;
			this.nutzflaechen = d.nutzflaechen ?? [];
			this.pois = d.pois ?? [];
			this.haltestellen = d.haltestellen ?? [];
			this.linien = d.linien ?? [];
			this.rest = d.rest ?? [];
			this.einfriedungenNachholen();
			this.baumpunkte = baeumeAus(this.rest);
			this.ausgewaehlt = new Set();
			this.plangebiet = null;
			this.geladenFuer = this.schluessel();
			this.zugeschnittenFuer = this.geladenFuer;
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
			.filter((o) => baulich.has(o.ebene) && this.sichtbar.has(sichtEbene(o)) && this.trifftPolygon(o, p))
			.map((o) => o.id);
		const haus = this.hausVon(treffer);
		// Sichtbare Bäume, deren Stamm im Polygon steht, kommen mit.
		if (this.baeume) for (const b of this.baumpunkte) if (b.id && drin([b.x, b.y], p)) haus.add(BAUM_ID + b.id);
		this.ausgewaehlt = dazu ? new Set([...this.ausgewaehlt, ...haus]) : haus;
		this.fanglinie = [];
		this.werkzeug = 'zeigen';
		return haus.size;
	}

	/**
	 * Ein Haus samt seinen Teilen (06.11.2026).
	 *
	 * Wo ein Gebäude in `building:part` zerlegt ist, liegen die Teile über
	 * dem Umriss — in der HafenCity 339 von 623 Körpern. Der Klick traf den
	 * kleinsten, also einen Teil; gestrichen und ausgeblendet blieb der Umriss
	 * darunter schwarz stehen, und es sah aus, als ginge Ausblenden nicht.
	 * Gewählt wird deshalb immer das ganze Haus: der Umriss, in dem der
	 * Mittelpunkt eines Teils liegt, und alle Teile, deren Mittelpunkt in ihm
	 * liegt. Ein Teil ohne Umriss bleibt für sich.
	 */
	hausVon(ids: Iterable<string>): Set<string> {
		const aus = new Set(ids);
		const bauten = this.objekte.filter((o) => (o.ebene === 'gebaeude' || o.ebene === 'erhalt') && o.ringe.length);
		const huelle = (o: Objekt) => {
			let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
			for (const r of o.ringe) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
			return [x0, y0, x1, y1];
		};
		const umrisse = bauten.filter((o) => !istTeil(o)).map((o) => ({ o, h: huelle(o) }));
		const umfasst = (u: { o: Objekt; h: number[] }, [x, y]: [number, number]) =>
			x >= u.h[0] && x <= u.h[2] && y >= u.h[1] && y <= u.h[3] && u.o.ringe.some((r) => drin([x, y], r));
		const nachId = new Map(bauten.map((o) => [o.id, o]));
		const gewaehlt = new Set<{ o: Objekt; h: number[] }>();
		for (const id of aus) {
			const o = nachId.get(id);
			if (!o) continue;
			if (istTeil(o)) {
				const m = schwerpunkt(o.ringe);
				for (const u of umrisse) if (umfasst(u, m)) gewaehlt.add(u);
			} else {
				const u = umrisse.find((x) => x.o === o);
				if (u) gewaehlt.add(u);
			}
		}
		if (!gewaehlt.size) return aus;
		for (const u of gewaehlt) aus.add(u.o.id);
		for (const t of bauten) {
			if (!istTeil(t) || aus.has(t.id)) continue;
			const m = schwerpunkt(t.ringe);
			for (const u of gewaehlt) if (umfasst(u, m)) { aus.add(t.id); break; }
		}
		return aus;
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
		// Bäume im Gebiet gehen mit, wie die Flächen (06.11.2026).
		const weg = new Set(this.baumGestrichen);
		for (const b of this.baumpunkte) if (b.id && drin([b.x, b.y], p)) weg.add(b.id);
		if (weg.size !== this.baumGestrichen.size) this.baumGestrichen = weg;
		this.ausgewaehlt = new Set();
		return { flaechen, linien };
	}

	get beschnitten() { return this.objekte.filter((o) => o.urform).length; }

	auswahlUmkehren() {
		const sichtbar = this.objekte.filter((o) => this.sichtbar.has(sichtEbene(o)));
		this.ausgewaehlt = new Set(sichtbar.filter((o) => !this.ausgewaehlt.has(o.id)).map((o) => o.id));
	}
	alleZuruecksetzen() {
		this.objekte = this.objekte.map((o) => {
			const ringe = o.urform ?? o.ringe;
			if (o.zustand === 'normal' && !o.urform) return o;
			return { ...o, ringe, urform: undefined, zustand: 'normal' as const,
				ebene: o.ebene === 'erhalt' ? ('gebaeude' as const) : o.ebene };
		});
		this.baumGestrichen = new Set();
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
		/**
		 * Die Ebene „Erhalt" gibt es nur für Gebäude. Erhalten lässt sich jedes
		 * Objekt — ein Park, den das Freiräumen eines Plangebiets nicht treffen
		 * soll —, aber nur ein Gebäude wechselt dabei die Ebene. Vorher wechselte
		 * jedes: Ein erhaltener Kanal stand danach als acht Meter hoher Körper
		 * im Modell, und „Zurücksetzen" machte ihn endgültig zum Gebäude
		 * (gefunden von Umbra am 03.11.2026, way 25388265 in der HafenCity).
		 */
		const bau = (o: Objekt) => o.ebene === 'gebaeude' || o.ebene === 'erhalt';
		// Bäume: Streichen nimmt sie in die Liste, Erhalten und Zurück heraus.
		const baumIds = [...this.ausgewaehlt].filter((id) => id.startsWith(BAUM_ID)).map((id) => id.slice(BAUM_ID.length));
		if (baumIds.length) {
			const weg = new Set(this.baumGestrichen);
			for (const id of baumIds) zu === 'gestrichen' ? weg.add(id) : weg.delete(id);
			this.baumGestrichen = weg;
		}
		this.objekte = this.objekte.map((o) =>
			this.ausgewaehlt.has(o.id)
				? { ...o, zustand: zu, ebene: bau(o) ? (zu === 'erhalt' ? 'erhalt' : 'gebaeude') : o.ebene }
				: o
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
	/** Scheiterte das letzte Sichern? Dann sagt es der Fuß, statt die alte Uhrzeit stehen zu lassen. */
	nichtGesichert = $state(false);

	/** Ist die Wiederherstellung durch? Karte und Blatt warten darauf. */
	readonly bereit: Promise<void>;

	constructor() {
		this.bereit = this.wiederherstellen();
	}

	packen() {
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
			vorrat: this.vorrat,
			datenFlaeche: this.datenFlaeche,
			datenStand: this.datenStand,
			placesVorrat: this.placesVorrat,
			netz: this.netz,
			nutzflaechen: this.nutzflaechen,
			pois: this.pois,
			haltestellen: this.haltestellen,
			linien: this.linien,
			rest: this.rest,
			baeume: this.baeume,
			baumGestrichen: [...this.baumGestrichen],
			pflanzGebiete: this.pflanzGebiete,
			gepflanztAn: this.gepflanztAn,
			pflanzWahl: $state.snapshot(this.pflanzWahl),
			/**
			 * Diese drei sind tiefe Zustände, also Proxys, und die kann
			 * `indexedDB` nicht kopieren: Seit „Karte anpassen" (03.11.2026)
			 * scheiterte jedes Sichern still mit DataCloneError, auch live,
			 * und der Fuß zeigte die letzte gelungene Uhrzeit weiter an.
			 * Klein genug für eine Abschrift.
			 */
			karte: $state.snapshot(this.karte),
			kanten: $state.snapshot(this.kanten),
			looks: this.alleLooks(),
			bild3d: $state.snapshot(this.bild3d),
			sonne: $state.snapshot(this.sonne),
			baumLooks: $state.snapshot(this.baumLooks),
			bestandAn: this.bestandAn, waldAn: this.waldAn, waldAbstand: this.waldAbstand, naturAn: this.naturAn, naturWahl: $state.snapshot(this.naturWahl),
			druck: $state.snapshot(this.druck),
			ergaenzung: this.ergaenzung,
			zweifel: this.zweifel,
			places: this.places,
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
			projektName: this.projektName,
			projektAbdruck: this.projektAbdruck,
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
		const gut = await ablegen(Zustand.FACH, paket);
		if (gut) this.gesichert = paket.zeitpunkt;
		this.nichtGesichert = !gut;
	}

	private async wiederherstellen(): Promise<void> {
		const p = await abholen<SitzungsPaket>(Zustand.FACH);
		if (!p || p.fassung !== Zustand.FASSUNG || !p.kasten) return;
		this.einsetzen(p);
	}

	/** Einen gesicherten Stand übernehmen: aus der Ablage oder aus einer Projektdatei. */
	private einsetzen(p: SitzungsPaket) {
		if (!p.kasten) return;
		this.ausgewaehlt = new Set();
		this.druckBuehne = null;
		this.fanglinie = [];
		this.kasten = p.kasten;
		this.ort = p.ort;
		this.verhaeltnis = VERHAELTNISSE.find((v) => v.name === p.verhaeltnis) ?? VERHAELTNISSE[0];
		this.ausgabeBreite = p.ausgabeBreite;
		this.objekte = p.objekte ?? [];
		this.vorrat = p.vorrat ?? [];
		this.placesVorrat = p.placesVorrat ?? [];
		// Sitzungen von vor dem 06.11.2026 kennen nur den Rahmen, für den geholt wurde.
		this.datenFlaeche = p.datenFlaeche ?? (p.geladenFuer ? kastenAus(p.geladenFuer) : null);
		this.datenStand = p.datenStand ?? null;
		this.netz = p.netz ?? null;
		this.nutzflaechen = p.nutzflaechen ?? [];
		this.pois = p.pois ?? [];
		this.haltestellen = p.haltestellen ?? [];
		this.linien = p.linien ?? [];
		this.rest = p.rest ?? [];
		this.einfriedungenNachholen();
		this.baeume = p.baeume ?? false;
		this.baumGestrichen = new Set(p.baumGestrichen ?? []);
		// Projekte vom Vormittag des 07.11.2026 kannten nur die Bäume, keine Gebiete.
		this.pflanzGebiete = p.pflanzGebiete ?? (((p as { gepflanzt?: Baum[] }).gepflanzt ?? []).length ? [{ id: 1, form: { art: 'fest' as const, baeume: (p as { gepflanzt?: Baum[] }).gepflanzt! }, radieren: false, wahl: { ...PFLANZ_VORGABE } }] : []);
		this.naechstesGebiet = Math.max(0, ...this.pflanzGebiete.map((g) => g.id)) + 1;
		this.gepflanzt = ausGebieten(this.objekte, this.pflanzGebiete);
		this.pflanzVerlauf = []; this.pflanzSchritte = 0; this.pflanzAuswahl = new Set();
		this.gepflanztAn = p.gepflanztAn ?? true;
		this.pflanzWahl = { ...PFLANZ_VORGABE, ...(p.pflanzWahl ?? {}) };
		/**
		 * Looks je Darstellung. Projekte von vor dem 07.11.2026 hatten nur einen
		 * Satz; der gehört dem 3D-Modell, wo man ihn meist eingestellt hat, die
		 * Pläne fangen bei ihrer Vorgabe an.
		 */
		const looks: Record<string, Look> = {};
		const roh: Record<string, { karte?: Partial<Anpassung>; kanten?: Partial<typeof KANTEN_VORGABE>; sonne?: Partial<typeof SONNE_VORGABE> }> =
			(p.looks as typeof roh | undefined) ?? (p.karte || p.kanten ? { modell3d: { karte: p.karte, kanten: p.kanten } } : {});
		// Die Sonne galt bis 07.11.2026 für alle Darstellungen; so bleibt es für alte Projekte.
		if (p.sonne && !p.looks) for (const d of DARSTELLUNGEN) roh[d.id] = { ...(roh[d.id] ?? {}), sonne: p.sonne };
		for (const [id, l] of Object.entries(roh)) {
			const kanten = { ...KANTEN_VORGABE, ...(l.kanten ?? {}) };
			// Bis 06.11.2026 hieß „dunkel" `false` und war die Vorgabe; jetzt folgt
			// die Vorgabe der Darstellung, also gilt ein altes `false` als keine Wahl.
			if (kanten.hell === false) kanten.hell = null;
			looks[id] = { karte: { ...NEUTRAL, ...(l.karte ?? {}) }, kanten, sonne: { ...SONNE_VORGABE, ...(l.sonne ?? p.sonne ?? {}) } };
		}
		this.looks = looks;
		const gezeigt = looks[p.darstellung];
		this.karte = { ...NEUTRAL, ...(gezeigt?.karte ?? {}) };
		this.kanten = { ...KANTEN_VORGABE, ...(gezeigt?.kanten ?? {}) };
		/**
		 * Bäume: seit dem 07.11.2026 je Herkunft, zwei Sätze. Ältere Stände
		 * hatten einen Satz (`baumBild`) oder einen je Darstellung (`looks[id].baum`);
		 * der des 3D-Modells wird zum 3D-Satz für alle drei Herkünfte, mit Wald
		 * und Abstand daraus.
		 */
		type Alt = Partial<Baumwahl> & { wald?: boolean; waldAbstand?: number; waldGroesse?: number };
		const alt3d = ((p.looks as Record<string, { baum?: Alt }> | undefined)?.modell3d?.baum ?? (p as { baumBild?: Alt }).baumBild);
		const altSatz = alt3d ? { bestand: alt3d, wald: { ...alt3d, groesse: (alt3d.groesse ?? 1.1) * (alt3d.waldGroesse ?? 1) }, ergaenzt: alt3d } : undefined;
		this.baumLooks = { plan: satzAus(p.baumLooks?.plan, SATZ_PLAN), raum: satzAus(p.baumLooks?.raum ?? altSatz, SATZ_RAUM) };
		this.bestandAn = p.bestandAn ?? true;
		this.waldAn = p.waldAn ?? alt3d?.wald ?? true;
		this.waldAbstand = p.waldAbstand ?? alt3d?.waldAbstand ?? 9;
		this.naturAn = p.naturAn ?? true;
		this.naturWahl = { ...NATUR_VORGABE, ...(p.naturWahl ?? {}) };
		this.sonne = { ...SONNE_VORGABE, ...(gezeigt?.sonne ?? p.sonne ?? {}) };
		this.druck = { ...DRUCK_VORGABE, ...(p.druck ?? {}), ausschnitt: { ...DRUCK_VORGABE.ausschnitt, ...(p.druck?.ausschnitt ?? {}) } };
		this.bild3d = { ...{ format: 'ansicht', breite: 4096, rahmen: false, hintergrund: null, transparent: false }, ...(p.bild3d ?? {}) };
		this.baumpunkte = baeumeAus(this.rest);
		this.ergaenzung = p.ergaenzung ? { ...p.ergaenzung, fuer: p.ergaenzung.fuer ?? { ...p.kasten } } : null;
		this.zweifel = p.zweifel ?? [];
		this.places = p.places ?? [];
		this.placesInfo = p.placesInfo ? { ...p.placesInfo, fuer: p.placesInfo.fuer ?? { ...p.kasten } } : null;
		this.gelaende = p.gelaende ?? false;
		this.gelaendeDaten = p.gelaendeDaten ?? null;
		this.gelaendeFuer = p.gelaendeFuer ?? null;
		this.sichtbar = new Set(p.sichtbar ?? STIFTE.map((s) => s.id));
		// Sitzungen von vor der Overture-Ebene kennen sie nicht; ohne das
		// stünde sie beim ersten Ergänzen aus.
		if (!p.ergaenzung) this.sichtbar.add('overture');
		this.plangebiet = p.plangebiet;
		this.darstellung = p.darstellung;
		this.beschriftung = p.beschriftung;
		this.bereinigt = p.bereinigt;
		this.geladenFuer = p.geladenFuer;
		this.zugeschnittenFuer = this.schluessel();
		this.projektName = p.projektName ?? null;
		this.projektAbdruck = p.projektAbdruck ?? null;
		// Schritt 2 und 3 setzen Bestand voraus. Ohne ihn faengt man vorn an.
		this.schritt = this.objekte.length ? p.schritt : 1;
		this.gesichert = p.zeitpunkt;
	}

	// ---- Projektdatei ---------------------------------------------------
	/**
	 * Das Projekt als Datei, `.nolli` (Volker, 06.11.2026): ein ZIP mit
	 * demselben Stand, den die Ablage im Browser hält — Rahmen, alle
	 * Einstellungen bis zum Druckausschnitt, die Bearbeitungen und die Daten
	 * selbst. Wer es öffnet, bekommt genau dasselbe Modell, auch wenn sich
	 * OpenStreetMap inzwischen geändert hat; eine nachgedruckte Kachel passt
	 * so an die alten. Aktuell wird es mit „Neu holen", das die
	 * Bearbeitungen behält.
	 *
	 * Das Raster des Geländes liegt als `gelaende.bin` daneben (Float32,
	 * little-endian): JSON kann kein Float32Array, und als Zahlenliste wäre
	 * es fünfmal so groß.
	 */
	/**
	 * Das geöffnete oder zuletzt gespeicherte Projekt, ohne `.nolli`. Steht
	 * neben dem Logo, damit man sieht, woran man arbeitet (Volker, 06.11.2026).
	 * Ein Beispiel oder ein neuer Ort ist kein Projekt, bis man speichert.
	 */
	projektName = $state<string | null>(null);
	/** Der Abdruck beim Öffnen oder Speichern. Weicht der jetzige ab, ist das Projekt geändert. */
	projektAbdruck = $state<string | null>(null);

	/**
	 * Was ein Projekt ausmacht, als kurzer Text: Rahmen, Einstellungen und
	 * ein Zählwerk der Bearbeitungen. Schritt, Zoom und Auswahl zählen nicht.
	 * Das Zählwerk ist bewusst grob — eines gestrichen und ein anderes
	 * zurückgeholt fiele nicht auf —, dafür kostet es nichts.
	 */
	abdruck(): string {
		let gestrichen = 0, erhalt = 0, beschnitten = 0, overture = 0;
		for (const o of this.objekte) {
			if (o.zustand === 'gestrichen') gestrichen++;
			else if (o.zustand === 'erhalt') erhalt++;
			if (o.urform) beschnitten++;
			if (o.herkunft === 'overture') overture++;
		}
		gestrichen += this.baumGestrichen.size;
		return JSON.stringify([this._kasten, this.verhaeltnis.name, this.ausgabeBreite, this.darstellung, this.beschriftung,
			this.bereinigt, this.baeume, this.gelaende, [...this.sichtbar].sort(), this.plangebiet, this.alleLooks(),
			this.sonne, this.baumLooks, this.bestandAn, this.waldAn, this.waldAbstand, this.naturAn, this.naturWahl, this.druck, this.bild3d, this.datenStand, this.objekte.length, this.vorrat.length,
			gestrichen, erhalt, beschnitten, overture, this.places.length, this.gepflanzt.length, this.gepflanztAn]);
	}
	get projektGeaendert() { return !!this.projektName && this.abdruck() !== this.projektAbdruck; }
	/** Nach Speichern unter diesem Namen. */
	projektGespeichert(name: string) { this.projektName = name; this.projektAbdruck = this.abdruck(); }
	private projektVergessen() { this.projektName = null; this.projektAbdruck = null; }

	async projektDatei(): Promise<Uint8Array> {
		const { zipSync, strToU8 } = await import('fflate');
		const p = this.packen();
		const g = p.gelaendeDaten;
		const kopf = {
			format: PROJEKT_FORMAT, projektFassung: PROJEKT_FASSUNG,
			gespeichert: new Date().toISOString(),
			...p,
			gelaendeDaten: g ? { ...g, z: null } : null
		};
		const dateien: Record<string, Uint8Array> = { 'projekt.json': strToU8(JSON.stringify(kopf)) };
		if (g) dateien['gelaende.bin'] = new Uint8Array(g.z.buffer.slice(g.z.byteOffset, g.z.byteOffset + g.z.byteLength));
		return zipSync(dateien, { level: 6 });
	}

	/** Eine Projektdatei öffnen. Ersetzt die laufende Sitzung; die wird vorher nicht eigens gesichert. */
	async projektOeffnen(bytes: Uint8Array, name: string) {
		const { unzipSync, strFromU8 } = await import('fflate');
		let p: (SitzungsPaket & { format?: string; projektFassung?: number }) | null = null;
		let dateien: Record<string, Uint8Array>;
		try {
			dateien = unzipSync(bytes);
			p = JSON.parse(strFromU8(dateien['projekt.json']));
		} catch {
			throw new Error(t().projekt.keinProjekt);
		}
		if (!p || p.format !== PROJEKT_FORMAT || !p.kasten) throw new Error(t().projekt.keinProjekt);
		if ((p.projektFassung ?? 0) > PROJEKT_FASSUNG || p.fassung !== Zustand.FASSUNG) throw new Error(t().projekt.zuNeu);
		if (p.gelaendeDaten) {
			const bin = dateien['gelaende.bin'];
			if (bin) p.gelaendeDaten = { ...p.gelaendeDaten, z: new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)) };
			else { p.gelaendeDaten = null; p.gelaendeFuer = null; }
		}
		this.einsetzen(p);
		this.projektName = name;
		this.projektAbdruck = this.abdruck();
		await this.sofortSichern();
	}

	/** Sitzung vergessen und bei null anfangen. */
	async verwerfen() {
		if (this.takt) clearTimeout(this.takt);
		await wegwerfen(Zustand.FACH);
		this.objekte = [];
		this.vorrat = [];
		this.baumGestrichen = new Set();
		this.gepflanzt = [];
		this.pflanzGebiete = [];
		this.placesVorrat = [];
		this.datenFlaeche = null;
		this.datenStand = null;
		this.projektVergessen();
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
		this.zweifel = [];
		this.places = [];
		this.placesInfo = null;
		this.ausgewaehlt = new Set();
		this.plangebiet = null;
		this.geladenFuer = null;
		this.gesichert = null;
		this.schritt = 1;
	}
}

type SitzungsPaket = ReturnType<Zustand['packen']>;

export const z = new Zustand();
export { VERHAELTNISSE, AUSGABEBREITEN };
