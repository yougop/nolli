import {
	nachGitter, nachGrad, zoneFuer, utmGitter, ortsgitter, konvergenz, proj4Von,
	type Gitter
} from './utm';

export type Verhaeltnis = { name: string; wert: number | null };
export const VERHAELTNISSE: Verhaeltnis[] = [
	{ name: '4:3', wert: 4 / 3 },
	{ name: '16:9', wert: 16 / 9 },
	{ name: '3:2', wert: 3 / 2 },
	{ name: '1:1', wert: 1 },
	{ name: 'frei', wert: null }
];
export const AUSGABEBREITEN = [2048, 3840, 4096];

/** Untergrenze: eine 12 m tiefe Gebaeudezeile muss 12 px breit bleiben. */
export const PRUEFTIEFE_M = 12;
export const MINDESTPIXEL = 12;

export type RahmenDaten = {
	lon0: number;                            // Mittelmeridian des Ortsgitters
	bbox: [number, number, number, number];  // x0 y0 x1 y1 im Ortsgitter
	pixelBreite: number;
	verhaeltnis: string;
};

/**
 * Der Rahmen ist der Vertrag. Bbox in UTM, Pixelmasse, Meter pro Pixel.
 * Jede Abbildung zwischen Meter und Bild laeuft durch dieses Objekt.
 */
export class Rahmen {
	readonly gitter: Gitter;
	readonly x0: number; readonly y0: number;
	readonly x1: number; readonly y1: number;
	readonly pixelBreite: number;
	readonly verhaeltnis: string;

	constructor(d: RahmenDaten) {
		this.gitter = ortsgitter(d.lon0);
		[this.x0, this.y0, this.x1, this.y1] = d.bbox;
		this.pixelBreite = d.pixelBreite;
		this.verhaeltnis = d.verhaeltnis;
	}

	static ausGrad(west: number, sued: number, ost: number, nord: number,
		pixelBreite = 4096, verhaeltnis = 'frei'): Rahmen {
		const g = ortsgitter((west + ost) / 2);
		const a = nachGitter(west, sued, g), b = nachGitter(ost, nord, g);
		return new Rahmen({
			lon0: g.lon0,
			bbox: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)],
			pixelBreite, verhaeltnis
		});
	}

	get breiteM() { return this.x1 - this.x0; }
	get hoeheM() { return this.y1 - this.y0; }
	get flaecheHa() { return (this.breiteM * this.hoeheM) / 1e4; }
	get mpp() { return this.breiteM / this.pixelBreite; }
	get pixelHoehe() { return Math.round(this.hoeheM / this.mpp); }
	/** Wie viele Pixel bekommt eine 12 m tiefe Gebaeudezeile. */
	get pruefpixel() { return PRUEFTIEFE_M / this.mpp; }
	get traegt() { return this.pruefpixel >= MINDESTPIXEL; }
	/** Massstab bei Ausgabe auf DIN A1, 841 mm breit. */
	get massstabA1() { return Math.round(this.breiteM * 1000 / 841); }

	/**
	 * Restliche Meridiankonvergenz an der Rahmenkante, in Grad.
	 *
	 * Weil der Mittelmeridian des Gitters in der Mitte des Plangebiets
	 * liegt, ist sie dort null und waechst zum Rand hin auf Hundertstelgrade.
	 * Ueber die ganze Rahmenbreite bleibt der Versatz unter einem Pixel.
	 * Zum Vergleich: im Gitter der UTM-Zone waeren es in Bratislava 1,6 Grad.
	 */
	get konvergenz() {
		const m = this.eckenGrad;
		return konvergenz(m.ost, (m.nord + m.sued) / 2, this.gitter);
	}

	/** Die zustaendige UTM-Zone. Wird berichtet, nicht gerechnet. */
	get zone() {
		const m = this.eckenGrad;
		return zoneFuer((m.west + m.ost) / 2, (m.nord + m.sued) / 2);
	}

	/** Ein Millimeter Strichbreite auf dem Blatt, in Pixeln dieses Rahmens. */
	strich(mm: number) { return Math.max(1, (mm / 1000) * (841 / this.breiteM) * this.pixelBreite); }

	zuPixel(lon: number, lat: number): [number, number] {
		const p = nachGitter(lon, lat, this.gitter);
		return [(p.x - this.x0) / this.mpp, (this.y1 - p.y) / this.mpp];
	}
	utmZuPixel(x: number, y: number): [number, number] {
		return [(x - this.x0) / this.mpp, (this.y1 - y) / this.mpp];
	}
	pixelZuUtm(px: number, py: number): [number, number] {
		return [this.x0 + px * this.mpp, this.y1 - py * this.mpp];
	}

	get eckenGrad() {
		const nw = nachGrad(this.x0, this.y1, this.gitter);
		const so = nachGrad(this.x1, this.y0, this.gitter);
		return { west: nw.lon, nord: nw.lat, ost: so.lon, sued: so.lat };
	}

	/** Dieselben Ecken im amtlichen UTM-Gitter, zum Anschluss an Fremddaten. */
	get eckenUtm() {
		const g = utmGitter(this.zone);
		const m = this.eckenGrad;
		const a = nachGitter(m.west, m.sued, g), b = nachGitter(m.ost, m.nord, g);
		return [a.x, a.y, b.x, b.y] as [number, number, number, number];
	}

	/** Mitte des Rahmens in Grad, für Verweise nach draußen. */
	get mitteGrad() {
		const m = this.eckenGrad;
		return { lat: (m.nord + m.sued) / 2, lon: (m.west + m.ost) / 2 };
	}

	/**
	 * Zoomstufe, bei der Google Maps denselben Ausschnitt zeigt.
	 *
	 * Google rechnet mit 156543,034 Metern je Pixel am Äquator, halbiert je
	 * Stufe und mit dem Kosinus der Breite verkürzt. Gerundet wird nach unten,
	 * damit lieber etwas mehr Umgebung im Bild steht als zu wenig.
	 */
	googleZoom(fensterPx = 1100) {
		const lat = (this.mitteGrad.lat * Math.PI) / 180;
		const proPixel = this.breiteM / fensterPx;
		const z = Math.log2((156543.03392 * Math.cos(lat)) / proPixel);
		return Math.max(1, Math.min(21, Math.floor(z)));
	}

	/**
	 * Verweise nach draußen, damit sich der Ort in einer Sekunde ansehen lässt.
	 * Die Adressen folgen der dokumentierten Maps-URLs-Schnittstelle, nicht
	 * einem abgeschauten Adressmuster, und kommen ohne Schlüssel aus.
	 */
	google() {
		const m = this.mitteGrad;
		const mitte = `${m.lat.toFixed(6)},${m.lon.toFixed(6)}`;
		const z = this.googleZoom();
		const karte = (grund: string) =>
			`https://www.google.com/maps/@?api=1&map_action=map&center=${mitte}&zoom=${z}&basemap=${grund}`;
		const weite = Math.round(Math.max(this.breiteM, this.hoeheM) * 1.6);
		return {
			mitte,
			zoom: z,
			karte: karte('roadmap'),
			luftbild: karte('satellite'),
			gelaende: karte('terrain'),
			strassenansicht: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${mitte}`,
			suche: `https://www.google.com/maps/search/?api=1&query=${mitte}`,
			erde: `https://earth.google.com/web/@${mitte},0a,${weite}d,35y,0h,45t,0r`
		};
	}

	/** Der Datenvertrag. Diese Datei lesen alle folgenden Schritte der Kette. */
	vertrag(zusatz: Record<string, unknown> = {}) {
		const g = this.eckenGrad;
		const r = (n: number, s = 1) => Math.round(n * 10 ** s) / 10 ** s;
		const u = this.eckenUtm;
		/**
		 * Alle Maße aus einer Quelle, damit sich der Vertrag nicht selbst
		 * widerspricht.
		 *
		 * Die Ecken werden auf zehn Zentimeter gerundet, weil das lesbar ist
		 * und weit unter jeder Toleranz liegt, die hier zählt. Breite, Höhe,
		 * Fläche und Meter je Pixel folgen dann aus diesen gerundeten Ecken
		 * statt aus den ungerundeten. Sonst stimmt jede Zahl für sich, aber
		 * `breite_m / pixel_breite` ergibt nicht `meter_pro_pixel`, und ein
		 * Werkzeug, das genau das nachprüft, meldet einen Widerspruch gegen
		 * die Datei, die ihn erzeugt hat. Genau das ist Umbra am 14.09.2026
		 * passiert.
		 *
		 * Meter je Pixel auf neun Stellen: Bei vier Stellen blieb ein Rest von
		 * 2,5 Hundertmillionsteln, was auf 1.600 Meter zehn Zentimeter Versatz
		 * bedeutet.
		 */
		const kasten = [r(this.x0), r(this.y0), r(this.x1), r(this.y1)];
		const breite = r(kasten[2] - kasten[0]), hoehe = r(kasten[3] - kasten[1]);
		return {
			nolli: '1', schritt: 1,
			// Das Arbeitsgitter: Mittelmeridian im Plangebiet, Massstab genau 1,
			// Gitternord gleich geographisch Nord. Deshalb steht der Rahmen auf
			// einer genordeten Karte gerade und Pixel sind reine Meter.
			gitter: { proj4: proj4Von(this.gitter), mittelmeridian: r(this.gitter.lon0, 7) },
			bbox_gitter: kasten,
			// Zum Anschluss an amtliche Daten, nicht zum Rechnen
			utm: { epsg: this.zone.epsg, bbox: u.map((v) => r(v)) },
			bbox_wgs84: { west: r(g.west, 6), sued: r(g.sued, 6), ost: r(g.ost, 6), nord: r(g.nord, 6) },
			breite_m: breite, hoehe_m: hoehe, flaeche_ha: r((breite * hoehe) / 1e4, 2),
			seitenverhaeltnis: this.verhaeltnis,
			pixel_breite: this.pixelBreite, pixel_hoehe: this.pixelHoehe,
			meter_pro_pixel: r(breite / this.pixelBreite, 9),
			// Restkonvergenz an der Rahmenkante. Nahe null, weil das Gitter am Ort
			// aufgespannt ist. Die Bildkanten zeigen damit nach Norden.
			restkonvergenz_grad: r(this.konvergenz, 4),
			pruefpixel_12m: r(this.pruefpixel, 1),
			// Damit sich der Ort ohne Umweg nachsehen lässt: Luftbild,
			// Straßenansicht, Gelände. Rein zum Nachschlagen, nicht zum Rechnen.
			google: this.google(),
			quelle: 'openstreetmap',
			lizenz: 'ODbL, © OpenStreetMap-Mitwirkende',
			erstellt: new Date().toISOString(),
			...zusatz
		};
	}
}
