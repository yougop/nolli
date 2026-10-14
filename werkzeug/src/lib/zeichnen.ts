import type { Rahmen } from './geo/rahmen';
import type { Objekt } from './osm';
import { STIFTE, stift, type StiftId } from './stifte';
import { darstellung, type Darstellung } from './darstellung';

export type Zeichenwunsch = {
	darstellung: string;
	bereinigt: boolean;          // gestrichene Objekte weglassen
	beschriftung: boolean;
	plangebiet?: [number, number][] | null;
	rahmenZeigen: boolean;
	/** Der echte Blattrand in Gitterkoordinaten. Noetig, sobald die Ansicht
	 *  hineinzoomt und der Blattrand nicht mehr die Leinwandkante ist. */
	blattrand?: [number, number, number, number] | null;
	sichtbar: Set<StiftId>;
	hervorgehoben?: StiftId | null;
	ausgewaehlt?: Set<string>;
	fanglinie?: [number, number][] | null;   // Polygon im Entstehen
	/**
	 * Ohne Schlagschatten und Fusssaum zeichnen.
	 *
	 * Zwei Verwendungen. Beim Zoomen und Schieben kosten die plastischen
	 * Schatten den Loewenanteil der Rechenzeit; sie fallen waehrend der
	 * Bewegung weg und kommen zurueck, sobald die Hand stillhaelt.
	 *
	 * Und fuer den Ausgang: Wer die Aufsicht als Bodenbild unter ein eigenes
	 * Modell legt und die Sonne selbst rechnet, bekommt sonst zwei Schatten je
	 * Haus — einen gemalten aus Nordwesten, der steht, und einen gerechneten,
	 * der wandert. Fuer ein Werkzeug, dessen Zweck der Schattenwurf ist, ist
	 * das der schlimmstmoegliche Bildfehler.
	 */
	ohneSchatten?: boolean;
	/**
	 * Nur den Grund zeichnen, ohne Baukoerper.
	 *
	 * Fuer ein Werkzeug, das die Haeuser selbst als Koerper stellt. Legt es
	 * die gewoehnliche Aufsicht als Bodenbild darunter, steckt jedes Gebaeude
	 * zweimal im Bild: als gezeichnete Grundflaeche und als Volumen darueber.
	 * Solange beide deckungsgleich sind, faellt es nicht auf — aber nur so
	 * lange, bis jemand etwas aendert. Wer ein Haus abreisst oder einen
	 * Entwurf einsetzt, hat danach den alten Grundriss unter dem neuen Koerper
	 * liegen.
	 *
	 * Drin bleibt alles, was am Boden liegt: Wasser, Gruen, Strassen, Bahn,
	 * Baustellen, Plangebiet, Beschriftung. Draussen bleiben Gebaeude,
	 * Erhaltungsbestand, ihre Schatten und die Geister des Gestrichenen.
	 */
	ohneBauten?: boolean;
	/** Baeume, wenn sie zugeschaltet sind. Ort und Kronendurchmesser in Metern. */
	baeume?: { x: number; y: number; krone: number }[];
};

const AKZENT = '#8CA82F';

/**
 * Schattenwurf je Meter Bauhoehe, nach Osten und nach Sueden.
 *
 * Abgeleitet aus dem Sonnenstand der Raumansicht: Die Sonne steht dort um
 * (-0,55 | 0,85 | -0,50) vom Mittelpunkt versetzt, also im Nordwesten und
 * knapp 49 Grad ueber dem Horizont. Der Schatten faellt entgegengesetzt,
 * seine Laenge ist der waagerechte Anteil geteilt durch den senkrechten.
 * Aendert sich das Licht in raum.ts, gehoert diese Zahl mitgezogen.
 */
const SONNE: [number, number] = [0.55 / 0.85, 0.5 / 0.85];

/**
 * Einen Footprint an den laufenden Pfad eines Kontexts anhaengen, versetzt.
 *
 * Absichtlich auf dem Kontext und nicht auf `Path2D`, und absichtlich ohne
 * `closePath`. Beides sind Messergebnisse, keine Vorlieben: Ein `Path2D` aus
 * dreitausend Haeusern kostete 477 Millisekunden je Bild, und ein `closePath`
 * je Teilpfad noch einmal acht Mikrosekunden — bei den 54.000 Vierecken der
 * Schleppe sind das 441 Millisekunden fuer nichts. Beim Fuellen schliesst die
 * Leinwand jeden Teilpfad ohnehin von selbst; nur beim Umranden waere
 * `closePath` noetig, und umrandet wird hier nichts.
 */
/** Aussenteile und Loecher eines Objekts, in einer Liste. */
export const alleRinge = (o: Objekt) => (o.loecher?.length ? [...o.ringe, ...o.loecher] : o.ringe);

function ringeZeichnen(k: CanvasRenderingContext2D, o: Objekt, r: Rahmen, dx: number, dy: number) {
	for (const ring of alleRinge(o)) {
		for (let i = 0; i < ring.length; i++) {
			const [px, py] = r.utmZuPixel(ring[i][0], ring[i][1]);
			if (i) k.lineTo(px + dx, py + dy);
			else k.moveTo(px + dx, py + dy);
		}
	}
}

/**
 * Die Schleppe zwischen Footprint und versetzter Kopie.
 *
 * Der Schatten eines Baukoerpers ist nicht die versetzte Flaeche, sondern
 * alles, was der Footprint auf dem Weg dorthin ueberstreicht. Ohne diesen
 * Teil schwebt eine losgeloeste Silhouette neben dem Haus.
 *
 * Ueberstrichen wird: der Footprint selbst, seine Kopie am Ende, und je Kante
 * das Viereck dazwischen. Dass auch die Kanten der Innenhoefe mitlaufen, ist
 * kein Versehen — dadurch bleibt vom Hof genau der Teil hell, den kein Stand
 * des Footprints je verdeckt.
 *
 * Die Vierecke kommen alle im selben Umlaufsinn, damit sie sich beim Fuellen
 * nach der Nichtnull-Regel vereinigen statt gegenseitig auszustanzen.
 */
function schleppeZeichnen(k: CanvasRenderingContext2D, o: Objekt, r: Rahmen, dx: number, dy: number) {
	for (const ring of alleRinge(o)) {
		const n = ring.length;
		if (n < 2) continue;
		let [ax, ay] = r.utmZuPixel(ring[n - 1][0], ring[n - 1][1]);
		for (let i = 0; i < n; i++) {
			const [bx, by] = r.utmZuPixel(ring[i][0], ring[i][1]);
			if ((bx - ax) * dy - (by - ay) * dx >= 0) {
				k.moveTo(ax, ay);
				k.lineTo(bx, by);
				k.lineTo(bx + dx, by + dy);
				k.lineTo(ax + dx, ay + dy);
			} else {
				k.moveTo(ax + dx, ay + dy);
				k.lineTo(bx + dx, by + dy);
				k.lineTo(bx, by);
				k.lineTo(ax, ay);
			}
			ax = bx; ay = by;
		}
	}
}

/**
 * Eine wiederverwendete Leinwand fuer die Schattenlage.
 *
 * Der Schatten muss erst deckend zusammengesetzt und dann als Ganzes mit
 * einer Deckkraft aufgelegt werden. Direkt aufs Blatt gemalt wuerden sich
 * Footprint, Kopie und Schleppe an ihren Ueberschneidungen aufaddieren, und
 * das Haus saesse in einem dunklen Fleck.
 */
const lagen = new Map<number, HTMLCanvasElement>();
function lagenblatt(ctx: CanvasRenderingContext2D, b: number, h: number, teil: number) {
	const dichte = (ctx.getTransform().a || 1) * teil;
	const bg = Math.max(1, Math.round(b * dichte)), hg = Math.max(1, Math.round(h * dichte));
	let l = lagen.get(teil);
	if (!l) { l = document.createElement('canvas'); lagen.set(teil, l); }
	if (l.width !== bg || l.height !== hg) { l.width = bg; l.height = hg; }
	const k = l.getContext('2d');
	if (!k) return null;
	k.setTransform(dichte, 0, 0, dichte, 0, 0);
	k.clearRect(0, 0, b, h);
	return { leinwand: l, k };
}

/**
 * Zeichnet das Blatt. Derselbe Zeichner bedient den Bildschirm und die
 * 4K-Ausgabe; nur die Pixelbreite des Rahmens unterscheidet sich.
 * Genau deshalb zeigt der Bildschirm, was die Datei enthaelt.
 */
export function zeichneBlatt(
	ctx: CanvasRenderingContext2D, objekte: Objekt[], r: Rahmen, w: Zeichenwunsch
) {
	const d = darstellung(w.darstellung);
	const W = r.pixelBreite, H = r.pixelHoehe;
	const farbe = (id: StiftId) => d.farbe[id] ?? stift(id).hell;

	ctx.save();
	ctx.clearRect(0, 0, W, H);

	/**
	 * Liegt ein Blattrand vor, ist die Leinwand die Arbeitsflaeche und das
	 * Blatt ein Rechteck darauf, wie die Karte in Schritt 1. Alles wird dann
	 * auf das Blatt beschnitten, und daneben bleibt die Leinwand durchsichtig,
	 * sodass der Grund der Buehne durchscheint.
	 *
	 * Ohne Blattrand, also bei der Ausgabe, ist die Leinwand das Blatt.
	 */
	let blatt: [number, number, number, number] = [0, 0, W, H];
	if (w.blattrand) {
		const [ax, ay] = r.utmZuPixel(w.blattrand[0], w.blattrand[3]);
		const [bx, by] = r.utmZuPixel(w.blattrand[2], w.blattrand[1]);
		blatt = [ax, ay, bx - ax, by - ay];
		ctx.save();
		ctx.shadowColor = 'rgba(20,22,24,.20)';
		ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
		ctx.fillStyle = d.grund;
		ctx.fillRect(...blatt);
		ctx.restore();
		ctx.beginPath();
		ctx.rect(...blatt);
		ctx.clip();
	}
	ctx.fillStyle = d.grund;
	ctx.fillRect(...blatt);
	ctx.lineJoin = 'round'; ctx.lineCap = 'round';

	const pfad = (o: Objekt, schliessen: boolean) => {
		ctx.beginPath();
		// Mit Loechern: Hoefe und Durchfahrten werden beim Fuellen nach der
		// Gerade-Ungerade-Regel ausgestanzt und beim Umranden mitgezeichnet.
		for (const ring of alleRinge(o)) {
			ring.forEach(([x, y], i) => {
				const [px, py] = r.utmZuPixel(x, y);
				i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
			});
			if (schliessen) ctx.closePath();
		}
	};
	const sichtbarIst = (o: Objekt, id: StiftId) => {
		if (!w.sichtbar.has(id)) return false;
		if (o.zustand === 'gestrichen' && w.bereinigt) return false;
		return true;
	};
	const nach = (id: StiftId) => objekte.filter((o) => o.ebene === id && sichtbarIst(o, id));
	const dick = (id: StiftId) => r.strich(stift(id).mm) * (w.hervorgehoben === id ? 2.4 : 1);

	const nurLinie = d.bauweise === 'linie';

	/**
	 * Im Linienbild bekommt jede Flaeche zuerst eine Fuellung in der Farbe des
	 * Grundes und dann ihre Kontur. Ohne das schiene alles durcheinander
	 * hindurch, und ein Gebaeude ueber einem Gleisfeld waere nicht mehr als
	 * Koerper zu lesen. Verdecken ist Teil der Zeichnung, nicht ihr Gegenteil.
	 */
	/**
	 * Die Farbe eines Objekts nach seiner Erfassungstiefe.
	 *
	 * Die Leiter ist bewusst grob: Sechs Stufen, die letzte ab acht Merkmalen.
	 * Feiner abzustufen würde eine Genauigkeit vortäuschen, die eine Zählung
	 * von Merkmalen nicht hat.
	 */
	const nachTiefe = (o: Objekt) => {
		const leiter = d.nachTiefe!;
		const t = o.tiefe ?? 0;
		const stufe = t <= 1 ? 0 : t <= 2 ? 1 : t <= 3 ? 2 : t <= 5 ? 3 : t <= 7 ? 4 : 5;
		return leiter[Math.min(stufe, leiter.length - 1)];
	};
	const farbeVon = (o: Objekt, wenn: string) => (d.nachTiefe ? nachTiefe(o) : wenn);

	const flaeche = (o: Objekt, f: string, kante?: string, breite?: number) => {
		pfad(o, true);
		if (nurLinie) {
			ctx.fillStyle = d.grund; ctx.fill('evenodd');
			ctx.strokeStyle = kante ?? f; ctx.lineWidth = breite ?? r.strich(0.18); ctx.stroke();
		} else {
			ctx.fillStyle = f; ctx.fill('evenodd');
			if (kante) { ctx.strokeStyle = kante; ctx.lineWidth = breite ?? r.strich(0.13); ctx.stroke(); }
		}
	};

	// 1 Flaechen von hinten nach vorn
	for (const id of ['gruen', 'wasser'] as StiftId[])
		for (const o of nach(id)) flaeche(o, farbeVon(o, farbe(id)));
	/**
	 * 2 Strassen als Netz mit Rangfolge, dann Bahn.
	 *
	 * Vorher bekam jeder Weg denselben Strich in derselben Farbe, nur
	 * verschieden breit. Im Plan wurde daraus ein Haufen Linien: Der
	 * Trampelpfad hinterm Block sah aus wie eine Wohnstrasse.
	 *
	 * Jetzt drei Stufen. Befahrbare Strassen bis Rang 6 bekommen einen Saum
	 * und lesen dadurch als Koerper statt als Strich. Erschliessungswege
	 * bleiben Flaeche ohne Saum. Fuss- und Radwege, Treppen und Feldwege
	 * werden zur duennen Linie zurueckgenommen — sie gehoeren in den Plan,
	 * aber nicht in dieselbe Reihe wie eine Strasse.
	 *
	 * Alle Saeume liegen unter allen Fuellungen, sonst schneidet der Saum
	 * einer Nebenstrasse quer durch die Hauptstrasse. Runde Enden und Ecken,
	 * damit an der Kreuzung keine Kerbe stehen bleibt.
	 */
	const strassen = [...nach('strasse')].sort((a, b) => (b.rang ?? 9) - (a.rang ?? 9));
	const fahrbahn = (o: Objekt) =>
		nurLinie ? dick('strasse') : Math.max(dick('strasse'), (o.breiteM ?? 6) / r.mpp);
	const saum = d.kante?.strasse;
	ctx.save();
	ctx.lineCap = 'round'; ctx.lineJoin = 'round';
	if (saum && !nurLinie) {
		ctx.save();
		ctx.strokeStyle = saum; ctx.globalAlpha = 0.45;
		ctx.lineWidth = r.strich(0.22);
		for (const o of strassen) { if ((o.rang ?? 9) >= 9) { pfad(o, false); ctx.stroke(); } }
		ctx.restore();
		ctx.strokeStyle = saum;
		for (const o of strassen) {
			if ((o.rang ?? 9) > 6) continue;
			ctx.lineWidth = fahrbahn(o) + r.strich(0.45);
			pfad(o, false); ctx.stroke();
		}
	}
	for (const o of strassen) {
		if (saum && !nurLinie && (o.rang ?? 9) >= 9) continue;
		ctx.strokeStyle = farbeVon(o, farbe('strasse'));
		ctx.lineWidth = fahrbahn(o);
		pfad(o, false); ctx.stroke();
	}
	ctx.restore();

	// Bahn: Streckengleis voll, Abstellgleis zurueckgenommen
	ctx.save();
	ctx.strokeStyle = farbe('bahn');
	ctx.setLineDash([r.strich(2), r.strich(1.4)]);
	for (const o of nach('bahn')) {
		const neben = (o.rang ?? 4) >= 9;
		ctx.globalAlpha = neben ? 0.42 : 1;
		ctx.lineWidth = dick('bahn') * (neben ? 0.6 : 1);
		pfad(o, false); ctx.stroke();
	}
	ctx.restore();

	// 3 Baustellen: gefuellt und gestrichelt umrandet
	ctx.setLineDash([r.strich(4), r.strich(2.5)]);
	for (const o of nach('bau')) {
		pfad(o, true);
		if (nurLinie) { ctx.fillStyle = d.grund; ctx.fill('evenodd'); }
		else { ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = farbe('bau'); ctx.fill('evenodd'); ctx.restore(); }
		ctx.strokeStyle = farbe('bau'); ctx.lineWidth = dick('bau'); ctx.stroke();
	}
	ctx.setLineDash([]);

	// 4 Gestrichenes bleibt sichtbar, aber als Geist mit Streichung.
	//   Die Ebenensichtbarkeit gilt auch hier: Wer die Ebene Gebaeude
	//   ausblendet, will weder Fuellung noch Umriss noch Streichung sehen.
	if (!w.bereinigt && !w.ohneBauten) {
		ctx.strokeStyle = farbe('gestrichen');
		ctx.lineWidth = r.strich(stift('gestrichen').mm);
		for (const o of objekte) {
			if (o.zustand !== 'gestrichen') continue;
			if (!w.sichtbar.has(o.ebene)) continue;
			pfad(o, true); ctx.stroke(); streichen(ctx, o, r);
		}
	}

	// 5 Gebaeude
	const bauten = w.ohneBauten ? [] : objekte.filter(
		(o) => (o.ebene === 'gebaeude' || o.ebene === 'erhalt')
			&& w.sichtbar.has(o.ebene) && o.zustand !== 'gestrichen'
	);
	if (d.bauweise === 'weissmodell') {
		/**
		 * Aufsicht auf das Weissmodell, so nah am 3D-Modell wie es in der
		 * Flaeche geht.
		 *
		 * Drei Sachen machen den Unterschied zum ausgeschnittenen Papier:
		 *
		 * 1. **Dieselbe Sonne.** Richtung und Laenge des Schlagschattens sind
		 *    aus dem Sonnenstand der Raumansicht gerechnet, nicht geschaetzt.
		 *    Beide Darstellungen zeigen damit denselben Tag.
		 * 2. **Weiche Kante und ein Saum am Fuss.** Der Halbschatten waechst
		 *    mit der Hoehe; dazu kommt eine richtungslose Abdunklung rings um
		 *    jeden Fuss. Im 3D-Modell macht das die Verdeckungsrechnung.
		 * 3. **Von niedrig nach hoch gezeichnet.** Dadurch liegt der Schatten
		 *    eines hohen Hauses auf dem niedrigen Nachbardach statt darunter
		 *    zu verschwinden. Das ist der Punkt, an dem eine flache Aufsicht
		 *    sonst als flach auffliegt.
		 *
		 * Der Grundriss bleibt unangetastet: keine Wandstreifen, keine
		 * Verzerrung. Was hier steht, ist in der Vektorisierung noch derselbe
		 * Footprint.
		 *
		 * Gezeichnet wird in Hoehenbaendern, nicht Haus fuer Haus. Jede
		 * Weichzeichnung kostet einen eigenen Durchgang ueber die Flaeche;
		 * bei sechshundert Haeusern einzeln waere die Ansicht unbedienbar.
		 * Pro Band ein Sammelpfad, also vier Weichzeichnungen statt tausend.
		 * Der Sammelpfad hat den Nebennutzen, dass sich ueberlappende
		 * Schatten nicht aufaddieren und dunkle Klumpen bilden.
		 */
		const kante = r.strich(0.18);
		const geordnet = [...bauten].sort((a, b) => (a.hoeheM ?? 8) - (b.hoeheM ?? 8));
		const BAENDER = 3;
		const proBand = Math.ceil(geordnet.length / BAENDER) || 1;
		const wurfVon = (o: Objekt): [number, number] => {
			const h = o.hoeheM ?? 8;
			return [(h * SONNE[0]) / r.mpp, (h * SONNE[1]) / r.mpp];
		};
		/** Eine fertige Lage mit der gewuenschten Deckkraft aufs Blatt legen. */
		const auflegen = (l: HTMLCanvasElement, deckung: number) => {
			ctx.save();
			ctx.globalAlpha = deckung;
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'low';
			ctx.drawImage(l, 0, 0, W, H);
			ctx.restore();
		};

		/**
		 * Umgebungsverschattung: enger Saum am Fuss jedes Koerpers, richtungslos.
		 * Im 3D-Modell macht das die Verdeckungsrechnung.
		 *
		 * Einmal fuer alle, nicht je Hoehenband. Jedes Auflegen kostet einen
		 * Durchgang ueber das ganze Blatt; der Gewinn, den Fusssaum eines hohen
		 * Hauses auch noch auf dem niedrigen Nachbardach zu sehen, waere den
		 * dreifachen Preis nicht wert.
		 */
		if (!w.ohneSchatten) {
			const eng = lagenblatt(ctx, W, H, 0.3);
			if (eng) {
				eng.k.fillStyle = '#000';
				eng.k.beginPath();
				for (const o of bauten) ringeZeichnen(eng.k, o, r, 0, 0);
				eng.k.fill('evenodd');
				auflegen(eng.leinwand, 0.16);
			}
		}

		let stufe = 0;
		for (let anfang = 0; anfang < geordnet.length; anfang += proBand, stufe++) {
			const band = geordnet.slice(anfang, anfang + proBand);

			/**
			 * Schlagschatten, deckend auf einer groben Lage zusammengesetzt.
			 *
			 * Grob ist Absicht, nicht Sparsamkeit: Beim Hochziehen auf
			 * Blattgroesse entsteht der weiche Rand von selbst. Eine echte
			 * Weichzeichnung ueber die ganze Flaeche kostete 1.949 Millisekunden
			 * je Bild, das Hochziehen kostet zwanzig. Hoehere Baender bekommen
			 * eine groebere Lage und damit einen breiteren Halbschatten.
			 *
			 * Von niedrig nach hoch, damit der Schatten eines hohen Hauses auf
			 * dem niedrigen Nachbardach landet statt darunter zu verschwinden.
			 */
			const grob = lagenblatt(ctx, W, H, 1 / (2.5 + stufe));
			if (grob && !w.ohneSchatten) {
				const k = grob.k;
				k.fillStyle = '#000';
				k.beginPath();
				for (const o of band) ringeZeichnen(k, o, r, 0, 0);
				for (const o of band) { const [dx, dy] = wurfVon(o); ringeZeichnen(k, o, r, dx, dy); }
				k.fill('evenodd');
				k.beginPath();
				for (const o of band) { const [dx, dy] = wurfVon(o); schleppeZeichnen(k, o, r, dx, dy); }
				k.fill();
				auflegen(grob.leinwand, 0.2);
			}

			ctx.fillStyle = farbe('gebaeude');
			ctx.strokeStyle = d.kante?.gebaeude ?? '#3A3C3E';
			ctx.lineWidth = kante;
			for (const o of band) { pfad(o, true); ctx.fill('evenodd'); ctx.stroke(); }
		}
	} else {
		for (const o of bauten) {
			const f = d.nachTiefe
				? nachTiefe(o)
				: d.nachNutzung ? d.nachNutzung[o.klasse ?? 'unbestimmt'] : farbe(o.ebene);
			flaeche(o, f, nurLinie ? f : d.kante?.[o.ebene], nurLinie ? dick('gebaeude') : undefined);
		}
	}
	// Erhaltungsbestand bekommt die dicke Feder
	ctx.strokeStyle = d.kante?.erhalt ?? farbe('gebaeude');
	ctx.lineWidth = dick('erhalt');
	for (const o of bauten) { if (o.ebene === 'erhalt') { pfad(o, true); ctx.stroke(); } }

	/**
	 * 5b Baeume, wenn zugeschaltet.
	 *
	 * Nach den Baukoerpern, weil eine Krone ueber dem Dach steht und nicht
	 * darunter. Als Kreis im Kronendurchmesser, nicht als Zeichen: Der Plan ist
	 * masstaeblich, und ein Baum mit zwoelf Metern Krone nimmt zwoelf Meter ein.
	 */
	if (w.baeume?.length) {
		const laub = d.farbe.baum ?? (d.grund === '#111111' ? '#3E4A34' : '#9FB27E');
		ctx.save();
		ctx.fillStyle = laub;
		ctx.globalAlpha = 0.5;
		ctx.strokeStyle = laub;
		ctx.lineWidth = r.strich(0.18);
		for (const b of w.baeume) {
			const [px, py] = r.utmZuPixel(b.x, b.y);
			const rad = Math.max(r.strich(0.4), b.krone / 2 / r.mpp);
			ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
		}
		ctx.globalAlpha = 1;
		for (const b of w.baeume) {
			const [px, py] = r.utmZuPixel(b.x, b.y);
			const rad = Math.max(r.strich(0.4), b.krone / 2 / r.mpp);
			ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.stroke();
		}
		ctx.restore();
	}

	// 6 Beschriftung
	if (w.beschriftung) beschriften(ctx, objekte, r, d, w);

	// 7 Auswahl, Fanglinie, Plangebiet und Rahmen
	if (w.ausgewaehlt?.size) {
		const gewaehlt = objekte.filter((o) => w.ausgewaehlt!.has(o.id));
		ctx.strokeStyle = d.grund === '#111111' ? 'rgba(17,17,17,.85)' : 'rgba(255,255,255,.85)';
		ctx.lineWidth = r.strich(2.6);
		for (const o of gewaehlt) { pfad(o, o.art === 'flaeche'); ctx.stroke(); }
		ctx.strokeStyle = AKZENT; ctx.lineWidth = r.strich(1.0);
		for (const o of gewaehlt) { pfad(o, o.art === 'flaeche'); ctx.stroke(); }
	}
	if (w.plangebiet?.length && w.sichtbar.has('plangebiet'))
		zug(ctx, w.plangebiet, r, AKZENT, r.strich(stift('plangebiet').mm), [6, 3], true);
	if (w.fanglinie?.length) {
		zug(ctx, w.fanglinie, r, AKZENT, r.strich(0.5), [3, 2], false);
		ctx.fillStyle = AKZENT;
		for (const [x, y] of w.fanglinie) {
			const [px, py] = r.utmZuPixel(x, y);
			ctx.beginPath(); ctx.arc(px, py, r.strich(1.2), 0, Math.PI * 2); ctx.fill();
		}
	}
	ctx.restore();   // Beschneidung auf das Blatt aufheben

	if (w.rahmenZeigen) {
		const s = Math.max(1.5, r.strich(stift('rahmen').mm));
		ctx.save();
		ctx.strokeStyle = AKZENT; ctx.lineWidth = s;
		ctx.strokeRect(blatt[0] + s / 2, blatt[1] + s / 2, blatt[2] - s, blatt[3] - s);
		ctx.restore();
	}
}

function zug(ctx: CanvasRenderingContext2D, punkte: [number, number][], r: Rahmen,
	farbe: string, breite: number, strich: [number, number], schliessen: boolean) {
	ctx.save();
	ctx.strokeStyle = farbe; ctx.lineWidth = breite;
	ctx.setLineDash([r.strich(strich[0]), r.strich(strich[1])]);
	ctx.beginPath();
	punkte.forEach(([x, y], i) => {
		const [px, py] = r.utmZuPixel(x, y);
		i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
	});
	if (schliessen) ctx.closePath();
	ctx.stroke();
	ctx.restore();
}

/**
 * Strassennamen und Flurnamen ins Blatt schreiben.
 *
 * Der Name sitzt auf dem laengsten geraden Stueck des Weges und dreht sich
 * mit ihm. Ein grobes Belegungsraster verhindert, dass Namen uebereinander
 * fallen; wichtige Strassen kommen zuerst und gewinnen den Platz.
 *
 * Fuer den Eingang ins Bildmodell gehoert die Beschriftung ausgeschaltet:
 * Der bewaehrte Prompt verlangt ausdruecklich ein Blatt ohne Schrift.
 */
function beschriften(ctx: CanvasRenderingContext2D, objekte: Objekt[], r: Rahmen,
	d: Darstellung, w: Zeichenwunsch) {
	const grad = Math.max(9, Math.min(30, r.pixelBreite / 110));
	const zelle = grad * 2.2;
	const belegt = new Set<string>();
	const frei = (x: number, y: number, halbBreite: number) => {
		const keys: string[] = [];
		for (let i = -halbBreite; i <= halbBreite; i += zelle / 2) {
			const k = `${Math.round((x + i) / zelle)}:${Math.round(y / zelle)}`;
			if (belegt.has(k)) return null;
			keys.push(k);
		}
		return keys;
	};

	const kandidaten = objekte
		.filter((o) => o.name && w.sichtbar.has(o.ebene) && o.zustand !== 'gestrichen')
		.filter((o) => (o.ebene === 'strasse' && (o.rang ?? 9) <= 6) || o.ebene === 'wasser' || o.ebene === 'gruen')
		.sort((a, b) => (a.rang ?? 7) - (b.rang ?? 7));

	ctx.save();
	ctx.font = `500 ${grad}px Satoshi, system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.lineJoin = 'round';

	const gesetzt = new Set<string>();
	for (const o of kandidaten) {
		if (gesetzt.has(o.name!)) continue;
		const platz = o.ebene === 'strasse' ? entlang(o, r) : mitte(o, r);
		if (!platz) continue;
		const [px, py, winkel] = platz;
		if (px < grad || py < grad || px > r.pixelBreite - grad || py > r.pixelHoehe - grad) continue;
		const breite = ctx.measureText(o.name!).width;
		if (o.ebene === 'strasse' && breite > platz[3]!) continue;
		const keys = frei(px, py, breite / 2);
		if (!keys) continue;
		keys.forEach((k) => belegt.add(k));
		gesetzt.add(o.name!);

		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(winkel);
		ctx.strokeStyle = d.schriftFlor;
		ctx.lineWidth = grad * 0.32;
		ctx.strokeText(o.name!, 0, 0);
		ctx.fillStyle = d.schrift;
		ctx.fillText(o.name!, 0, 0);
		ctx.restore();
	}
	ctx.restore();
}

/** Laengstes gerades Stueck eines Weges, in Pixeln, mit Drehwinkel. */
function entlang(o: Objekt, r: Rahmen): [number, number, number, number] | null {
	let best: [number, number, number, number] | null = null;
	let lang = 0;
	for (const ring of o.ringe) {
		for (let i = 1; i < ring.length; i++) {
			const [ax, ay] = r.utmZuPixel(...ring[i - 1]);
			const [bx, by] = r.utmZuPixel(...ring[i]);
			const l = Math.hypot(bx - ax, by - ay);
			if (l <= lang) continue;
			lang = l;
			let wk = Math.atan2(by - ay, bx - ax);
			if (wk > Math.PI / 2) wk -= Math.PI;
			if (wk < -Math.PI / 2) wk += Math.PI;
			best = [(ax + bx) / 2, (ay + by) / 2, wk, l];
		}
	}
	return best;
}

function mitte(o: Objekt, r: Rahmen): [number, number, number, number] | null {
	const ring = o.ringe[0];
	if (!ring?.length) return null;
	let x = 0, y = 0;
	for (const p of ring) { x += p[0]; y += p[1]; }
	const [px, py] = r.utmZuPixel(x / ring.length, y / ring.length);
	return [px, py, 0, Infinity];
}

/** Ein gestrichenes Objekt wird durchgestrichen, nicht geloescht. */
function streichen(ctx: CanvasRenderingContext2D, o: Objekt, r: Rahmen) {
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const ring of o.ringe) for (const [x, y] of ring) {
		const [px, py] = r.utmZuPixel(x, y);
		x0 = Math.min(x0, px); y0 = Math.min(y0, py);
		x1 = Math.max(x1, px); y1 = Math.max(y1, py);
	}
	ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

export const ebenenZaehlen = (objekte: Objekt[]) => {
	const z = new Map<StiftId, number>();
	for (const s of STIFTE) z.set(s.id, 0);
	for (const o of objekte) z.set(o.ebene, (z.get(o.ebene) ?? 0) + 1);
	return z;
};
