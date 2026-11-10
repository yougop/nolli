<script module lang="ts">
	/** Bis zu welchem Datenlauf der Einlauf schon lief. Er gehört zum Holen, nicht zum Umschalten oder Neuladen der Seite. */
	let geplottetLauf = 0;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { mitte, filterWerte, istNeutral } from '$lib/anpassen';
	import { zahl } from '$lib/sprache.svelte';
	import { z, BAUM_ID, type Absicht } from '$lib/zustand.svelte';
	import { Rahmen } from '$lib/geo/rahmen';
	import { zeichneBlatt } from '$lib/zeichnen';
	import { trifft, sichtEbene } from '$lib/osm';
	import { ausrichtungBei, fangen, gerade, rechteckAusEcken, rechteckRing, mitRechteck, gedreht, neubauGedreht, drehMitte, punktVersetzt,
		punktEingefuegt, fangFlucht, MIN_SEITE_M, type Punkt, type Rechteck, type Neubau, type Stelle, type Gestalt } from '$lib/entwurf';

	/**
	 * `links`: Breite der Arbeitsspalte in Bildschirmpunkten. Sie schwebt über
	 * der Leinwand (Volker, 09.11.2026: „Das Fenster schwebt, aber auch nicht so
	 * richtig"): Die Leinwand füllt die ganze Bühne, nur die Grundansicht hält
	 * das Blatt rechts der Spalte frei. Hineingezoomt läuft der Plan darunter weiter.
	 */
	let { waehlbar = false, entwirft = false, links = 0, aktiv = true }: { waehlbar?: boolean; entwirft?: boolean; links?: number; aktiv?: boolean } = $props();

	let huelle = $state<HTMLDivElement | null>(null);
	let leinwand = $state<HTMLCanvasElement | null>(null);
	let breite = $state(900);
	let hoehe = $state(600);
	let plottet = $state(false);
	let zeigerM = $state<[number, number] | null>(null);



	/**
	 * Der Rahmen der gerade sichtbaren Ausschnitts. Bei Zoom 1 ist er der
	 * ganze Rahmen; hineingezoomt ist er ein Teilrechteck davon, bei gleicher
	 * Leinwandgroesse. Dadurch wachsen auch die Strichbreiten richtig mit.
	 */
	const schirmRahmen = $derived.by(() => {
		const k = z.kasten, g = schirmRahmenFuer(z.zoom);
		if (!k || !g) return null;
		// Die Blattmitte steht in der Mitte der freien Fläche, also um die halbe Spalte nach rechts.
		const cx = k.x0 + (k.x1 - k.x0) * z.mitte.x - g.schub;
		const cy = k.y1 - (k.y1 - k.y0) * z.mitte.y;
		return new Rahmen({
			lon0: k.lon0, bbox: [cx - g.b / 2, cy - g.h / 2, cx + g.b / 2, cy + g.h / 2],
			pixelBreite: Math.max(320, Math.round(breite)), verhaeltnis: 'frei'
		});
	});

	/** Die Mitte so begrenzen, dass der Ausschnitt im Blatt bleibt. */
	const klemmen = () => z.mitteKlemmen();

	/**
	 * Anzeigegroesse des Blattes. Wird gerechnet, nicht dem Browser ueberlassen:
	 * max-width zusammen mit max-height und einem Seitenverhaeltnis fuehrt bei
	 * flachen Schirmen dazu, dass die Breite gewinnt und das Blatt unten
	 * abgeschnitten wird. Also beides selbst gegeneinander abwaegen.
	 */
	/**
	 * Die Leinwand füllt die ganze Arbeitsfläche, wie die Karte in Schritt 1.
	 * Das Blatt ist ein Rechteck darauf, kein Bild mit Rand.
	 */
	const anzeige = $derived({ w: Math.floor(breite), h: Math.floor(hoehe) });

	$effect(() => {
		const r = schirmRahmen, c = leinwand;
		if (!r || !c) return;
		// Hinter dem 3D-Modell ruht das Blatt und behält sein Bild, damit es beim Zurückschalten sofort dasteht.
		if (!aktiv && gezeichnet) return;
		// Abhängigkeiten anmelden, damit jede Änderung neu zeichnet
		z.objekte; z.entwurf; z.neubauFarbe; z.sichtbar; z.hervorgehoben; z.ausgewaehlt; z.darstellung; waehlbar;
		z.bereinigt; z.plangebiet; z.beschriftung; z.fanglinie; z.zoom; z.mitte; flott; z.baeume; z.baumGestrichen;
		JSON.stringify(z.baumLooks.plan); z.waldListe; z.bestandAn; z.naturListe; z.gepflanzt; z.gepflanztAn; z.pflanzAuswahl; z.pflanzOffen;
		const dpr = Math.min(devicePixelRatio || 1, 2);
		const wunsch = {
			darstellung: z.darstellung, bereinigt: z.bereinigt,
			beschriftung: z.beschriftung, plangebiet: z.plangebiet, rahmenZeigen: true,
			sichtbar: z.sichtbar, hervorgehoben: z.hervorgehoben,
			// Auswahl und Fanglinie gehören zum Bereinigen; im Ausgeben ist das
			// Blatt die Vorschau des Ergebnisses und zeigt sie nicht (06.11.2026).
			ausgewaehlt: waehlbar ? z.ausgewaehlt : undefined,
			fanglinie: waehlbar ? z.fanglinie : undefined, ohneSchatten: flott,
			// Mit den Waldbäumen und den Baumwerten der Darstellung (07.11.2026).
			baeume: z.baeume ? z.baeumeModell : undefined,
			baumSatz: $state.snapshot(z.baumLooks.plan),
			baumGestrichen: z.baumGestrichen,
			// Beim Pflanzen die Bäume der gewählten Gebiete, sonst die gewählten Bäume.
			baumGewaehlt: z.pflanzOffen && z.pflanzAuswahl.size
				? new Set(z.gepflanzt.filter((b) => b.gebiet !== undefined && z.pflanzAuswahl.has(b.gebiet)).map((b) => b.id!))
				: waehlbar && z.ausgewaehlt.size
				? new Set([...z.ausgewaehlt].filter((id) => id.startsWith(BAUM_ID)).map((id) => id.slice(BAUM_ID.length)))
				: undefined,
			kanten: { ...z.kanten },
			sonne: { ...z.sonne },
			neubauFarbe: z.neubauFarbe,
			blattrand: (z.kasten ? [z.kasten.x0, z.kasten.y0, z.kasten.x1, z.kasten.y1] : null) as [number, number, number, number] | null
		};
		/**
		 * Gezeichnet wird höchstens einmal je Bildtakt, mit dem letzten Stand.
		 * Ein Regler meldet dutzendfach je Sekunde; bisher zeichnete jede
		 * Meldung das ganze Blatt, und die Ansicht lief der Hand hinterher.
		 */
		geplant = { r, c, dpr, wunsch };
		if (!takt) takt = requestAnimationFrame(() => {
			takt = 0;
			const g = geplant; if (!g) return;
			gezeichnet = true;
			const w = Math.round(g.r.pixelBreite * g.dpr), h = Math.round(g.r.pixelHoehe * g.dpr);
			if (g.c.width !== w) g.c.width = w;
			if (g.c.height !== h) g.c.height = h;
			g.c.style.width = `${anzeige.w}px`;
			g.c.style.height = `${anzeige.h}px`;
			const ctx = g.c.getContext('2d')!;
			ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
			zeichneBlatt(ctx, z.alle, g.r, g.wunsch);
			// Die Mitte für den Kontrast vom ganzen Blatt, also nur ungezoomt;
			// beim Hineinzoomen bleibt sie stehen, wie in der Datei.
			/**
			 * Die Mitte für den Kontrast vom ganzen Blatt. Gezoomt wurde sie bis
			 * 07.11.2026 gar nicht gemessen: Wechselte man gezoomt vom hellen
			 * Schwarzplan ins dunkle Invertiert, galt dessen Mitte weiter, und der
			 * Kontrast drückte Straßen und Grün auf Schwarz (Volker: „manchmal
			 * fehlen die Straßen, Raus- und Reinzoomen hilft“). Jetzt gezoomt aus
			 * einer kleinen Fassung des ganzen Blattes, sobald sich etwas ändert.
			 */
			const schluessel = [z.darstellung, z.bereinigt, z.baeume, z.sichtbar.size, z.objekte.length, z.entwurf.length].join('|');
			if (z.zoom === 1) { blattMitte = mitte(g.c); mitteFuer = schluessel; }
			else if (mitteFuer !== schluessel && z.kasten) {
				const k = z.kasten;
				const klein = new Rahmen({ lon0: k.lon0, bbox: [k.x0, k.y0, k.x1, k.y1], pixelBreite: 320, verhaeltnis: 'frei' });
				const c = document.createElement('canvas');
				c.width = klein.pixelBreite; c.height = klein.pixelHoehe;
				zeichneBlatt(c.getContext('2d')!, z.alle, klein, { ...g.wunsch, blattrand: null, ausgewaehlt: undefined, fanglinie: undefined, ohneSchatten: true });
				blattMitte = mitte(c); mitteFuer = schluessel;
			}
		});
	});
	let gezeichnet = false;
	let geplant: { r: Rahmen; c: HTMLCanvasElement; dpr: number; wunsch: Parameters<typeof zeichneBlatt>[3] } | null = null;
	let takt = 0;
	let letzteDarstellung = '';
	let blattMitte = $state(0.5);
	let mitteFuer = '';

	// Während ein Regler der Karte oder der Kanten bewegt wird: ohne Schatten,
	// wie beim Zoomen. Das fertige Bild kommt, wenn er ruht.
	$effect(() => {
		z.kanten.dicke; z.kanten.deckkraft; z.kanten.karteDicke; z.kanten.karteDeckkraft; z.kanten.an; z.kanten.hell; z.kanten.flaeche;
		// Beim Wechsel der Darstellung gleich das fertige Bild, nicht erst eines ohne Schatten.
		const d = z.darstellung;
		if (d !== letzteDarstellung) { letzteDarstellung = d; return; }
		untrack(() => bewegtSich());
	});

	/** Ein Lauf des Plotters: der einzige gestaltete Bewegungsmoment. */
	$effect(() => {
		const lauf = z.datenLaeufe;
		if (lauf === geplottetLauf) return;
		geplottetLauf = lauf;
		plottet = true;
		const t = setTimeout(() => (plottet = false), 820);
		return () => clearTimeout(t);
	});

	function messen() {
		if (!huelle) return;
		breite = Math.max(120, huelle.clientWidth);
		hoehe = Math.max(90, huelle.clientHeight);
	}
	$effect(() => {
		if (!huelle) return;
		messen();
		const b = new ResizeObserver(messen);
		b.observe(huelle);
		return () => b.disconnect();
	});

	function meterAus(e: PointerEvent): [number, number] | null {
		const r = schirmRahmen, c = leinwand;
		if (!r || !c) return null;
		const b = c.getBoundingClientRect();
		return r.pixelZuUtm(((e.clientX - b.left) / b.width) * r.pixelBreite, ((e.clientY - b.top) / b.height) * r.pixelHoehe);
	}

	let zieht: null | { x: number; y: number; mx: number; my: number; bewegt: boolean } = null;

	/**
	 * Bäume pflanzen (07.11.2026): Bei offenem Fenster malt die linke Taste,
	 * die rechte verschiebt, das Rad zoomt. Pinsel pflanzt beim Ziehen, das
	 * Lasso füllt die umfahrene Fläche, Einzel setzt einen Baum je Klick.
	 */
	const malt = $derived(z.pflanzOffen);
	/** `waehlt`: auf gepflanzte Bäume gedrückt; ohne Ziehen wählt das ihr Gebiet, mit Ziehen wird gemalt. */
	let malZug = $state<null | { letzter: [number, number]; ring: [number, number][]; bewegt: boolean; sx: number; sy: number; waehlt: boolean }>(null);
	function malen(p: [number, number]) {
		const w = z.pflanzWahl;
		if (w.werkzeug === 'pinsel') z.pflanzKreis(p[0], p[1]);
	}

	/**
	 * Waehrend einer Bewegung wird schnell gezeichnet.
	 *
	 * Das Weissmodell und die Aufsicht setzen ihre Schatten aus mehreren Lagen
	 * zusammen. Bei jedem Radschritt dieselbe Rechnung zu machen laesst die
	 * Ansicht der Hand hinterherlaufen. Also waehrend der Bewegung ohne
	 * Schatten, und ein Sechstel Sekunde nach dem letzten Radschritt das
	 * fertige Bild.
	 */
	let flott = $state(false);
	let ruheTakt: ReturnType<typeof setTimeout>;
	function bewegtSich() {
		flott = true;
		clearTimeout(ruheTakt);
		ruheTakt = setTimeout(() => (flott = false), 170);
	}

	function runter(e: PointerEvent) {
		if (malt && e.button === 0) {
			const p = meterAus(e);
			if (!p) return;
			(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
			const waehlt = !z.pflanzWahl.radieren && z.pflanzTrifft(p[0], p[1]);
			malZug = { letzter: p, ring: [p], bewegt: false, sx: e.clientX, sy: e.clientY, waehlt };
			if (z.pflanzWahl.werkzeug === 'pinsel' && !waehlt) z.pflanzZugBeginnen(p[0], p[1]);
			return;
		}
		if (entwirft && e.button === 0 && entwurfRunter(e)) return;
		// Beim Pflanzen und beim Rechteck verschiebt die rechte Taste, sonst die linke.
		if (e.button !== (malt || (entwirft && z.entwurfWerkzeug === 'rechteck') ? 2 : 0)) return;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		zieht = { x: e.clientX, y: e.clientY, mx: z.mitte.x, my: z.mitte.y, bewegt: false };
	}
	function schieben(e: PointerEvent) {
		zeigerM = meterAus(e);
		if (entwirft && zeigerM) {
			const unter = z.neubauBei(zeigerM);
			const w = z.entwurfWerkzeug;
			ueberNeubau = (!!griffUnter(e) || (!!(unter || z.formBei(zeigerM)) && (w === 'waehlen'
				|| (!aufBau && (w === 'rechteck' || (!z.entwurfLinie.length && !!unter && z.entwurfAuswahl.has(unter.id)))))));
			if (entZug) { entwurfZiehen(e, zeigerM); return; }
		}
		if (malZug && zeigerM) {
			const p = zeigerM, w = z.pflanzWahl;
			if (!malZug.bewegt && Math.hypot(e.clientX - malZug.sx, e.clientY - malZug.sy) > 4) {
				malZug.bewegt = true;
				// Doch gezogen: dann malen, ab dem Punkt, an dem gedrückt wurde.
				if (malZug.waehlt && w.werkzeug === 'pinsel') z.pflanzZugBeginnen(malZug.letzter[0], malZug.letzter[1]);
			}
			if (w.werkzeug === 'pinsel' && Math.hypot(p[0] - malZug.letzter[0], p[1] - malZug.letzter[1]) >= Math.max(1, w.pinselM / 4)) {
				malZug.letzter = p; malen(p);
			} else if (w.werkzeug === 'lasso' && schirmRahmen && Math.hypot(p[0] - malZug.letzter[0], p[1] - malZug.letzter[1]) >= schirmRahmen.mpp * 4) {
				malZug.letzter = p; malZug.ring = [...malZug.ring, p];
			}
			return;
		}
		if (!zieht || !leinwand) return;
		const dx = e.clientX - zieht.x, dy = e.clientY - zieht.y;
		if (!zieht.bewegt && Math.hypot(dx, dy) < 5) return;
		// Auch beim Polygon wird geschoben: Ein Punkt entsteht nur beim Klick
		// ohne Bewegung, siehe `hoch` (06.11.2026).
		zieht.bewegt = true;
		schiebtAnsicht = true;
		bewegtSich();
		const r = schirmRahmen, k = z.kasten;
		if (!r || !k) return;
		const b = leinwand.getBoundingClientRect();
		z.mitte = {
			x: zieht.mx - (dx / b.width) * (r.breiteM / (k.x1 - k.x0)),
			y: zieht.my - (dy / b.height) * (r.hoeheM / (k.y1 - k.y0))
		};
		klemmen();
	}
	function hoch(e: PointerEvent) {
		if (entZug) {
			const zug = entZug;
			entZug = null;
			try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
			entwurfHoch(zug, e);
			z.neubauZugEnde();
			return;
		}
		if (malZug) {
			const zug = malZug, w = z.pflanzWahl;
			malZug = null;
			try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
			// Als einfache Kopie: Der Ring kommt aus einem reaktiven Zustand, und ein
			// Proxy ließ sich nicht ablegen; gespeichert blieb der Stand davor.
			// Ein Klick ohne Ziehen auf gepflanzte Bäume wählt ihr Gebiet, in jedem Werkzeug.
			if (zug.waehlt && !zug.bewegt) z.pflanzWaehlen(zug.letzter[0], zug.letzter[1], e.shiftKey);
			else if (w.werkzeug === 'lasso' && zug.bewegt) z.pflanzRing(zug.ring.map(([x, y]) => [x, y] as [number, number]));
			else if (w.werkzeug === 'einzel' && !zug.bewegt) z.pflanzEinzel(zug.letzter[0], zug.letzter[1]);
			else if (!zug.bewegt && !zug.waehlt && z.pflanzAuswahl.size) z.pflanzAuswahl = new Set();
			return;
		}
		const war = zieht;
		schiebtAnsicht = false;
		zieht = null;
		try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
		// Nur die linke Taste setzt oder wählt. Bisher setzte auch das Loslassen
		// der rechten einen Punkt, und das Kontextmenü nahm genau diesen wieder
		// zurück — der Punkt davor blieb stehen.
		if (war && !war.bewegt && e.button === 0 && !malt) tippen(e);
	}
	/** Zoomt so, dass der Punkt unter dem Zeiger stehen bleibt. */
	function rad(e: WheelEvent) {
		const k = z.kasten;
		if (!k) return;
		e.preventDefault();
		bewegtSich();
		const unter = meterAus(e as unknown as PointerEvent);
		z.zoom = Math.min(z.MAXZOOM, Math.max(1, z.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
		if (!unter) return;
		// Nach dem Zoomen die Mitte so setzen, dass derselbe Punkt am Zeiger liegt
		const b = leinwand!.getBoundingClientRect();
		const fx = (e.clientX - b.left) / b.width - 0.5;
		const fy = (e.clientY - b.top) / b.height - 0.5;
		const neu = schirmRahmenFuer(z.zoom);
		if (!neu) return;
		const zx = unter[0] - fx * neu.b;
		const zy = unter[1] + fy * neu.h;
		z.mitte = { x: (zx + neu.schub - k.x0) / (k.x1 - k.x0), y: (k.y1 - zy) / (k.y1 - k.y0) };
		klemmen();
	}

	/**
	 * Maße der Ansicht bei einem Zoom, in Metern: Breite, Höhe und der Schub,
	 * um den die Blattmitte rechts der Leinwandmitte steht. Die Grundansicht
	 * passt das Blatt mit etwas Luft in die Fläche rechts der Arbeitsspalte.
	 */
	function schirmRahmenFuer(zz: number) {
		const k = z.kasten;
		if (!k || !breite || !hoehe) return null;
		const sp = breite - links >= 240 ? links : 0;
		const frei = breite - sp, verh = frei / hoehe;
		const bm = k.x1 - k.x0, hm = k.y1 - k.y0;
		const meterJePunkt = (bm / hm > verh ? bm * 1.1 : hm * 1.1 * verh) / frei / zz;
		return { b: breite * meterJePunkt, h: hoehe * meterJePunkt, schub: (sp / 2) * meterJePunkt };
	}

	function tippen(e: PointerEvent) {
		if (entwirft) { entwurfTippen(e); return; }
		if (!waehlbar) return;
		const p = meterAus(e), r = schirmRahmen;
		if (!p || !r) return;
		if (z.werkzeug === 'polygon') { z.punktSetzen(p[0], p[1]); return; }
		const tol = r.mpp * 4;
		// Neben das Blatt geklickt: Auswahl aufheben, dort steht nichts zur Wahl.
		const k = z.kasten;
		const draussen = !k || p[0] < k.x0 || p[0] > k.x1 || p[1] < k.y0 || p[1] > k.y1;
		// Ausgeblendetes ist nicht zu greifen (Volker, 09.11.2026): Bei „ausblenden" fallen gestrichene Objekte und Bäume aus der Wahl.
		const weg = (o: { zustand?: string }) => z.bereinigt && o.zustand === 'gestrichen';
		const treffer = draussen ? [] : z.objekte.filter((o) => z.sichtbar.has(sichtEbene(o)) && !weg(o) && trifft(o, p[0], p[1], tol));
		// Bäume, wenn sie zu sehen sind: getroffen ist die Krone.
		const baeume = draussen || !z.baeume ? [] : z.baumpunkte.filter((b) =>
			b.id && !(z.bereinigt && z.baumGestrichen.has(b.id)) && Math.hypot(b.x - p[0], b.y - p[1]) <= Math.max(b.krone / 2, tol));
		if (!treffer.length && !baeume.length) { if (!e.shiftKey) z.ausgewaehlt = new Set(); return; }
		// kleinstes gewinnt, damit ein Haus im Block anklickbar bleibt — eine
		// Krone zählt mit ihrer Kreisfläche
		const kandidaten = [
			// Eine Linie hat keine Fläche und gewönne immer; liegt der Klick in
			// einer Krone, geht der Baum vor dem Weg darunter.
			...treffer.map((o) => ({ id: o.id, f: baeume.length && o.art === 'linie' ? Infinity : flaeche(o) })),
			...baeume.map((b) => ({ id: BAUM_ID + b.id, f: Math.PI * (b.krone / 2) ** 2 }))
		].sort((a, b) => a.f - b.f);
		const id = kandidaten[0].id;
		// Ein Gebäudeteil bringt sein Haus mit, sonst bleibt beim Streichen der
		// Umriss darunter stehen (`hausVon`).
		const haus = z.hausVon([id]);
		const alleDrin = [...haus].every((x) => z.ausgewaehlt.has(x));
		if (e.shiftKey) {
			const s = new Set(z.ausgewaehlt);
			for (const x of haus) alleDrin ? s.delete(x) : s.add(x);
			z.ausgewaehlt = s;
		}
		// Ein zweiter Klick auf das allein gewählte Haus hebt die Wahl auf.
		else if (alleDrin && z.ausgewaehlt.size === haus.size) z.ausgewaehlt = new Set();
		else z.ausgewaehlt = haus;
	}

	// ---- Entwerfen (09.11.2026) -------------------------------------------
	type Griff =
		| { art: 'punkt'; st: Stelle }
		| { art: 'mitte'; st: Stelle }
		| { art: 'drehen' };
	type EntZug =
		| { art: 'rechteck'; a: Punkt; b: Punkt; winkel: number; auf: string | null }
		| { art: 'schieben'; letzt: Punkt; bewegt: boolean; sx: number; sy: number; tippen?: boolean; start?: Punkt; korr?: Punkt; ecken?: Punkt[]; rest?: typeof z.alle }
		| { art: 'punkt'; id: string; form: string | null; st: Stelle; orig: Gestalt }
		| { art: 'mitte'; id: string; form: string | null; st: Stelle; orig: Gestalt; start: Punkt }
		| { art: 'drehen'; id: string; form: string | null; orig: Gestalt; mitte: Punkt; start: number };
	// Einfach, nicht tief reaktiv: `orig` landet in `z.entwurf`, und ein Proxy darin ließ das Sichern scheitern.
	let entZug = $state.raw<EntZug | null>(null);
	let ueberNeubau = $state(false);
	/** Wo zuletzt gefangen wurde, damit man es sieht. */
	let fangPunkt = $state.raw<Punkt | null>(null);
	/** Fangweite in Metern: acht Bildschirmpunkte. */
	const fangM = () => (schirmRahmen ? schirmRahmen.mpp * 8 * (schirmRahmen.pixelBreite / Math.max(1, anzeige.w)) : 1);
	const pixel = (x: number, y: number): Punkt => {
		const r = schirmRahmen!, sk = anzeige.w / r.pixelBreite, q = r.utmZuPixel(x, y);
		return [q[0] * sk, q[1] * sk];
	};
	const bildschirm = (e: PointerEvent | MouseEvent): Punkt => {
		const b = leinwand!.getBoundingClientRect();
		return [e.clientX - b.left, e.clientY - b.top];
	};
	/** Auf Ecken fangen und den Fangpunkt zeigen. */
	/** Ecke oder Flucht: wohin der Punkt rastet, und welche Fluchten das sind. */
	function rasten(objekte: typeof z.alle, p: Punkt, ohne?: string): { p: Punkt; ecke: boolean; linien: { von: Punkt; bis: Punkt }[] } | null {
		const q = fangen(objekte, p, fangM(), ohne);
		if (q[0] !== p[0] || q[1] !== p[1]) return { p: q, ecke: true, linien: [] };
		const f = fangFlucht(objekte, p, fangM() * 0.8, ohne, 150);
		return f ? { p: f.p, ecke: false, linien: f.linien } : null;
	}
	function fang(p: Punkt, ohne?: string): Punkt {
		const r = rasten(z.alle, p, ohne);
		fangPunkt = r?.ecke ? r.p : null;
		flucht = r && !r.ecke ? r.linien : [];
		return r ? r.p : p;
	}
	/** Die Flucht, auf die gerade gefangen wird: von der Nachbarkante bis zum Punkt. */
	let flucht = $state.raw<{ von: Punkt; bis: Punkt }[]>([]);
	/** Wird die Ansicht gerade geschoben? Nur dann zeigt der Zeiger die greifende Hand. */
	let schiebtAnsicht = $state(false);
	const meterText = (m: number) => `${zahl(Math.round(m * 10) / 10, { maximumFractionDigits: 1 })} m`;
	/**
	 * Die Griffe dessen, was bearbeitet wird (`z.ziel`: eine Form oder das
	 * allein gewählte Gebäude), in Bildschirmpunkten: jede Ecke, jede
	 * Kantenmitte, oben der Drehgriff, dazu die Kantenlängen.
	 */
	const griffe = $derived.by(() => {
		const zi = entwirft && schirmRahmen ? z.ziel : null;
		if (!zi) return null;
		const g = zi.g;
		const punkte: { st: Stelle; q: Punkt }[] = [], mitten: { st: Stelle; q: Punkt }[] = [];
		const masse: { q: Punkt; text: string }[] = [];
		const ringe = [...g.ringe.map((r, k) => ({ r, loch: false, k })), ...(g.loecher ?? []).map((r, k) => ({ r, loch: true, k }))];
		let oben = Infinity;
		for (const { r, loch, k } of ringe)
			r.forEach(([x, y], i) => {
				const q = pixel(x, y), [nx, ny] = r[(i + 1) % r.length], n = pixel(nx, ny);
				punkte.push({ st: { loch, r: k, i }, q });
				const m: Punkt = [(q[0] + n[0]) / 2, (q[1] + n[1]) / 2];
				mitten.push({ st: { loch, r: k, i }, q: m });
				if (q[1] < oben) oben = q[1];
				// Maße an den Außenkanten, nach außen versetzt, wo Platz ist
				const lp = Math.hypot(n[0] - q[0], n[1] - q[1]);
				if (!loch && lp > 46 && masse.length < 24) {
					const ux = (n[0] - q[0]) / lp, uy = (n[1] - q[1]) / lp;
					// Bildschirm-y zeigt nach unten: außen liegt hier rechts der Kante
					// Abstand nach der Lage der Kante: Eine senkrechte Kante braucht die halbe Textbreite.
					const ab = 8 + 20 * Math.abs(uy) + 5 * Math.abs(ux);
					masse.push({ q: [m[0] - uy * ab, m[1] + ux * ab], text: meterText(Math.hypot(nx - x, ny - y)) });
				}
			});
		const mm = drehMitte(g), mq = pixel(mm[0], mm[1]);
		// Das Maß der obersten Kante weicht dem Drehgriff aus.
		for (const m of masse) if (Math.abs(m.q[0] - mq[0]) < 34 && m.q[1] < oben + 4 && m.q[1] > oben - 44) m.q = [m.q[0] + 58, m.q[1]];
		return { id: zi.o.id, form: zi.form?.id ?? null, g, punkte, mitten, masse, anker: [mq[0], oben] as Punkt, dreh: [mq[0], oben - 30] as Punkt };
	});
	function griffUnter(e: PointerEvent | MouseEvent): Griff | null {
		const g = griffe;
		if (!g || !leinwand) return null;
		const [mx, my] = bildschirm(e);
		const nah = (q: Punkt, r: number) => Math.hypot(q[0] - mx, q[1] - my) <= r;
		if (nah(g.dreh, 9)) return { art: 'drehen' };
		const p = g.punkte.find((x) => nah(x.q, 7));
		if (p) return { art: 'punkt', st: p.st };
		const m = g.mitten.find((x) => nah(x.q, 6));
		if (m) return { art: 'mitte', st: m.st };
		return null;
	}
	/** Wo die Geschosszahl steht: in der Mitte der Fläche. */
	const mittePunkt = (g: Gestalt): Punkt => drehMitte(g);
	const winkelZu = (m: Punkt, p: Punkt) => (Math.atan2(p[1] - m[1], p[0] - m[0]) * 180) / Math.PI;
	/** Fertige Form: Gebäude, Grünfläche oder, im Modus Aussparen, eine Aussparung. */
	function formFertig(ring: Punkt[], rechteck?: Rechteck) {
		if (z.entwurfModus === 'aussparen') z.aussparen(ring, rechteck);
		else if (z.entwurfModus === 'aufsatz') z.aufstocken(ring, rechteck);
		else z.neubauSetzen(ring, rechteck);
	}

	/** Linke Taste im Entwerfen. Wahr, wenn sie verbraucht ist; sonst schiebt sie die Ansicht. */
	function entwurfRunter(e: PointerEvent): boolean {
		const w = z.entwurfWerkzeug;
		const p = meterAus(e);
		if (!p) return false;
		const halten = () => (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		const linie = z.entwurfLinie.length > 0;
		// Die Griffe gehen vor, in jedem Werkzeug, solange kein Polygon entsteht.
		const g = linie ? null : griffUnter(e);
		const zi = z.ziel;
		if (g && zi) {
			z.neubauZugBeginnen();
			const form = zi.form?.id ?? null;
			const orig = $state.snapshot(form ? zi.g : zi.o) as Gestalt;
			if (g.art === 'drehen') { const m = drehMitte(orig); entZug = { art: 'drehen', id: zi.o.id, form, orig, mitte: m, start: winkelZu(m, p) }; }
			else if (g.art === 'punkt') entZug = { art: 'punkt', id: zi.o.id, form, st: g.st, orig };
			else entZug = { art: 'mitte', id: zi.o.id, form, st: g.st, orig, start: p };
			halten(); return true;
		}
		const unter = z.neubauBei(p);
		const formHier = z.formBei(p);
		const schieben = (tippen = false) => {
			entZug = { art: 'schieben', letzt: p, bewegt: false, sx: e.clientX, sy: e.clientY, tippen };
			halten(); return true;
		};
		const waehle = (): boolean => {
			if (formHier) { if (z.formWahl?.form !== formHier.f.id) z.formWaehlen(formHier.o.id, formHier.f.id); return true; }
			if (!unter) return false;
			if (e.shiftKey) {
				const s = new Set(z.entwurfAuswahl);
				s.has(unter.id) ? s.delete(unter.id) : s.add(unter.id);
				z.gebaeudeWaehlen(s);
				return false;
			}
			if (!z.entwurfAuswahl.has(unter.id) || z.formWahl) z.gebaeudeWaehlen(new Set([unter.id]));
			return true;
		};
		/**
		 * Verschieben in jedem Werkzeug (Volker, 09.11.2026: „Schieben kann ich
		 * das Rechteck aber nicht"): Beim Bauen zieht man einen Neubau mit der
		 * Maus fort. Nur beim Aussparen zeichnet das Ziehen über ihm, für den Hof.
		 */
		if (w === 'polygon') {
			if (linie || aufBau) return false;
			const schonGewaehlt = formHier ? z.formWahl?.form === formHier.f.id : !!unter && z.entwurfAuswahl.has(unter.id) && !z.formWahl;
			// Ein Klick ohne Ziehen bleibt ein Polygonpunkt.
			return schonGewaehlt ? schieben(true) : false;
		}
		if (w === 'waehlen' || (w === 'rechteck' && !aufBau && (unter || formHier))) {
			if (!formHier && !unter) return false;
			return waehle() ? schieben() : true;
		}
		// Rechteck: Ziehen zeichnet, im Modus Aussparen auch über Gebäuden; ein Klick wählt.
		const a = fang(p);
		const winkel = e.altKey ? 0 : (unter?.rechteck?.winkel ?? ausrichtungBei(z.alle, a) ?? 0);
		entZug = { art: 'rechteck', a, b: a, winkel, auf: unter?.id ?? null };
		halten(); return true;
	}
	function entwurfZiehen(e: PointerEvent, p: Punkt) {
		const zug = entZug!;
		if (zug.art === 'rechteck') { entZug = { ...zug, b: fang(p) }; return; }
		bewegtSich();
		if (zug.art === 'drehen') {
			let d = winkelZu(zug.mitte, p) - zug.start;
			if (e.shiftKey) d = Math.round(d / 15) * 15;
			if (zug.form) z.zielSetzen(zug.id, zug.form, gedreht(zug.orig, d));
			else z.neubauErsetzen(zug.id, neubauGedreht(zug.orig as Neubau, d));
			return;
		}
		if (zug.art === 'punkt') {
			const o = zug.orig, i = zug.st.i;
			// Am Rechteck bleibt es ein Rechteck: die Gegenecke steht fest. Mit Alt wird es frei.
			if (o.rechteck && !zug.st.loch && !e.altKey) {
				const r = rechteckAusEcken(o.ringe[0][(i + 2) % 4], fang(p, zug.id), o.rechteck.winkel);
				if (r.l >= MIN_SEITE_M && r.t >= MIN_SEITE_M) z.zielSetzen(zug.id, zug.form, mitRechteck(o, r));
			} else z.zielSetzen(zug.id, zug.form, punktVersetzt(o, zug.st, fang(p, zug.id)));
			return;
		}
		if (zug.art === 'mitte') {
			const o = zug.orig, i = zug.st.i;
			if (o.rechteck && !zug.st.loch && !e.altKey) {
				// Eine Seite verschieben: die Ecke quer zur Kante, die Gegenecke fest.
				const ring = o.ringe[0], a = ring[i], b = ring[(i + 1) % 4];
				const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n: Punkt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
				const d = (p[0] - zug.start[0]) * n[0] + (p[1] - zug.start[1]) * n[1];
				const r = rechteckAusEcken(ring[(i + 2) % 4], [a[0] + n[0] * d, a[1] + n[1] * d], o.rechteck.winkel);
				if (r.l >= MIN_SEITE_M && r.t >= MIN_SEITE_M) z.zielSetzen(zug.id, zug.form, mitRechteck(o, r));
				return;
			}
			if (Math.hypot(p[0] - zug.start[0], p[1] - zug.start[1]) < fangM() / 4) return;
			const neu = punktEingefuegt(o, zug.st, fang(p, zug.id));
			z.zielSetzen(zug.id, zug.form, neu);
			// Ab jetzt zieht man den neuen Punkt.
			entZug = { art: 'punkt', id: zug.id, form: zug.form, st: { ...zug.st, i: i + 1 }, orig: neu };
			return;
		}
		if (!zug.bewegt) {
			if (Math.hypot(e.clientX - zug.sx, e.clientY - zug.sy) < 4) return;
			zug.bewegt = true;
			z.neubauZugBeginnen();
			/**
			 * Auch ein ganzes Gebäude rastet ein (Volker, 09.11.2026): Seine Ecken
			 * suchen Ecken und Fluchten der anderen. Gemerkt werden die Ecken beim
			 * Start und alles, was nicht mitzieht.
			 */
			const zi = z.ziel, mit = z.formWahl ? new Set<string>() : z.entwurfAuswahl;
			zug.start = zug.letzt; zug.korr = [0, 0];
			zug.ecken = (zi ? zi.g.ringe.flat() : z.gewaehlteNeubauten.flatMap((o) => o.ringe.flat())).slice(0, 24).map(([x, y]) => [x, y] as Punkt);
			zug.rest = z.alle.filter((o) => !mit.has(o.id) && !(o.entwurf && mit.has(o.entwurf)));
		}
		let korr: Punkt = [0, 0];
		const linien: { von: Punkt; bis: Punkt }[] = [];
		let ecke: Punkt | null = null;
		if (!e.altKey && zug.start && zug.ecken && zug.rest) {
			let best = Infinity;
			for (const v of zug.ecken) {
				const q: Punkt = [v[0] + p[0] - zug.start[0], v[1] + p[1] - zug.start[1]];
				const r = rasten(zug.rest, q);
				if (!r) continue;
				// Ecken gehen vor Fluchten; sonst gewinnt der kleinste Ruck.
				const d = Math.hypot(r.p[0] - q[0], r.p[1] - q[1]) + (r.ecke ? 0 : 1000);
				if (d < best) { best = d; korr = [r.p[0] - q[0], r.p[1] - q[1]]; ecke = r.ecke ? r.p : null; linien.length = 0; linien.push(...r.linien); }
			}
		}
		fangPunkt = ecke; flucht = linien;
		const alt = zug.korr ?? [0, 0];
		z.neubauVerschieben(p[0] - zug.letzt[0] + korr[0] - alt[0], p[1] - zug.letzt[1] + korr[1] - alt[1], false);
		zug.letzt = p; zug.korr = korr;
	}
	function entwurfHoch(zug: EntZug, e: PointerEvent) {
		fangPunkt = null;
		flucht = [];
		if (zug.art === 'schieben' && zug.tippen && !zug.bewegt) { entwurfTippen(e); return; }
		if (zug.art !== 'rechteck') return;
		const r = rechteckAusEcken(zug.a, zug.b, zug.winkel);
		if (r.l >= MIN_SEITE_M && r.t >= MIN_SEITE_M) { formFertig(rechteckRing(r), r); return; }
		// Ein Klick: auf einem Gebäude wählt er es, daneben hebt er die Wahl auf.
		if (zug.auf) {
			const s = new Set(e.shiftKey ? z.entwurfAuswahl : []);
			s.has(zug.auf) && e.shiftKey ? s.delete(zug.auf) : s.add(zug.auf);
			z.gebaeudeWaehlen(s);
		} else if (!e.shiftKey) z.gebaeudeWaehlen(new Set());
	}
	/** Rechtsklick auf einen Punkt der freien Form nimmt ihn heraus. */
	function entwurfRechts(e: MouseEvent) {
		if (z.entwurfLinie.length) { z.entwurfLinie = z.entwurfLinie.slice(0, -1); return; }
		const g = griffUnter(e), zi = z.ziel;
		if (g?.art === 'punkt' && zi && !(zi.g.rechteck && !g.st.loch)) z.neubauPunktEntfernen(zi.o.id, zi.form?.id ?? null, g.st);
	}
	/** Ein Klick ohne Ziehen: Polygonpunkt setzen oder die Auswahl aufheben. */
	function entwurfTippen(e: PointerEvent) {
		const p = meterAus(e);
		if (!p) return;
		if (z.entwurfWerkzeug === 'polygon') {
			const l = z.entwurfLinie;
			if (l.length >= 3) {
				const q = pixel(l[0][0], l[0][1]), [mx, my] = bildschirm(e);
				if (Math.hypot(q[0] - mx, q[1] - my) <= 9) { polygonSchliessen(); return; }
			}
			z.entwurfLinie = [...l, polygonPunkt(p, e.shiftKey)];
			return;
		}
		if (!e.shiftKey) z.gebaeudeWaehlen(new Set());
	}
	/** Der nächste Punkt: auf Ecken gefangen, mit Umschalt in 45°-Schritten. */
	function polygonPunkt(p: Punkt, gerad: boolean): Punkt {
		const l = z.entwurfLinie;
		if (gerad && l.length) {
			const bezug = l.length >= 2
				? (Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]) * 180) / Math.PI
				: ausrichtungBei(z.alle, l[0]) ?? 0;
			return gerade(l[l.length - 1], p, bezug);
		}
		const q = fangen(z.alle, p, fangM());
		if (q[0] !== p[0] || q[1] !== p[1]) return q;
		return fangFlucht(z.alle, p, fangM() * 0.8, undefined, 150)?.p ?? p;
	}
	function polygonSchliessen() {
		if (z.entwurfLinie.length >= 3) formFertig(z.entwurfLinie.map(([x, y]) => [x, y] as Punkt));
		z.entwurfLinie = [];
	}
	let umschalt = $state(false);
	/** Vorschau des Rechtecks und seine Maße. */
	const rechteckJetzt = $derived<Rechteck | null>(entZug?.art === 'rechteck' ? rechteckAusEcken(entZug.a, entZug.b, entZug.winkel) : null);
	/** Hof und Aufsatz zeichnet man über einem Gebäude; dort verschiebt das Ziehen dann nicht. */
	const aufBau = $derived(z.entwurfModus === 'aussparen' || z.entwurfModus === 'aufsatz');
	const KUERZEL: Record<string, Absicht> = { v: 'waehlen', b: 'gebaeude', g: 'gruen', a: 'hof', u: 'aufsatz', t: 'baeume' };

	function entwurfTaste(e: KeyboardEvent) {
		const ziel = e.target as HTMLElement | null;
		if (ziel?.closest('input, textarea, select, [contenteditable]')) return;
		const mod = e.ctrlKey || e.metaKey;
		const linie = z.entwurfLinie.length > 0;
		if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); z.neubauDuplizieren(); return; }
		const k = e.key.toLowerCase();
		if (!mod && !e.altKey && KUERZEL[k] && !linie) { z.absichtSetzen(KUERZEL[k]); return; }
		if (!mod && !e.altKey && (k === 'r' || k === 'p') && !linie) { z.zeichenFormSetzen(k === 'r' ? 'rechteck' : 'polygon'); return; }
		if (e.key === 'Escape') {
			if (linie) z.entwurfLinie = [];
			else if (z.formWahl) z.formWahl = null;
			else z.gebaeudeWaehlen(new Set());
			return;
		}
		if (e.key === 'Enter' && linie) { e.preventDefault(); polygonSchliessen(); return; }
		if (e.key === 'Backspace' && linie) { e.preventDefault(); z.entwurfLinie = z.entwurfLinie.slice(0, -1); return; }
		if ((e.key === 'Delete' || e.key === 'Backspace') && z.entwurfAuswahl.size) { e.preventDefault(); z.neubauLoeschen(); return; }
		const pfeil: Record<string, Punkt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
		if (pfeil[e.key] && z.entwurfAuswahl.size) {
			e.preventDefault();
			const m = e.shiftKey ? 10 : 1;
			z.neubauVerschieben(pfeil[e.key][0] * m, pfeil[e.key][1] * m);
		}
	}

	/** Escape hebt die Auswahl auf, solange gewählt werden kann. */
	function taste(e: KeyboardEvent) {
		if (!aktiv) return;
		umschalt = e.shiftKey;
		if (entwirft) { entwurfTaste(e); return; }
		// Bereinigen: V wählen, P Polygon, wie die Palette links.
		if (waehlbar && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) {
			const k = e.key.toLowerCase();
			if (k === 'v') { z.polygonAbbrechen(); return; }
			if (k === 'p') { z.werkzeug = 'polygon'; return; }
		}
		if (e.key !== 'Escape' || !waehlbar || !z.ausgewaehlt.size || z.werkzeug === 'polygon') return;
		const ziel = e.target as HTMLElement | null;
		if (ziel?.closest('input, textarea, select, [contenteditable]')) return;
		z.ausgewaehlt = new Set();
	}

	const flaeche = (o: { ringe: [number, number][][] }) => {
		const r = o.ringe[0]; let s = 0;
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
		return Math.abs(s / 2);
	};
</script>

<svelte:window onkeydown={taste} onkeyup={(e) => (umschalt = e.shiftKey)} />

<div class="huelle" class:ruht={!aktiv} bind:this={huelle}>
	{#if schirmRahmen}
		<!-- Karte anpassen als SVG-Filter: dieselbe Rechnung wie `anpassen.ts`
		     (Sättigung nach Rec. 709, Kontrast um die mittlere Helligkeit des
		     Blattes, Helligkeit als Faktor), ohne das Blatt neu zu zeichnen.
		     Ein CSS-Filter ginge nicht: `contrast()` spreizt fest um 50 %. -->
		<svg class="filterhalter" aria-hidden="true">
			<filter id="nolli-karte" color-interpolation-filters="sRGB">
				<feColorMatrix type="matrix" values={filterWerte(z.karte, blattMitte).matrix} />
				<feComponentTransfer>
					<feFuncR type="linear" slope={filterWerte(z.karte, blattMitte).steigung} intercept={filterWerte(z.karte, blattMitte).achse} />
					<feFuncG type="linear" slope={filterWerte(z.karte, blattMitte).steigung} intercept={filterWerte(z.karte, blattMitte).achse} />
					<feFuncB type="linear" slope={filterWerte(z.karte, blattMitte).steigung} intercept={filterWerte(z.karte, blattMitte).achse} />
				</feComponentTransfer>
			</filter>
		</svg>
		<canvas
			style:filter={istNeutral(z.karte) ? null : 'url(#nolli-karte)'}
			bind:this={leinwand}
			class:plottet
			class:waehlbar
			class:zeichnet={(waehlbar && z.werkzeug === 'polygon') || (entwirft && z.entwurfWerkzeug !== 'waehlen')}
			class:gezoomt={z.zoom > 1 && !waehlbar && !entwirft}
			class:entwirft
			class:schiebt={entwirft && ueberNeubau}
			class:greift={schiebtAnsicht}
			onpointerdown={runter}
			onpointermove={schieben}
			onpointerup={hoch}
			onpointercancel={hoch}
			onwheel={rad}
			oncontextmenu={(e) => { if (malt) { e.preventDefault(); return; }
				if (entwirft) { e.preventDefault(); entwurfRechts(e); return; } if (z.werkzeug === 'polygon') { e.preventDefault(); z.letztenPunktZurueck(); } }}
			class:malt
			onpointerleave={() => (zeigerM = null)}
		></canvas>
		{#if malt && schirmRahmen}
			<!-- Pinselkreis und Lassolinie über dem Blatt, in Bildschirmpunkten. -->
			{@const sk = anzeige.w / schirmRahmen.pixelBreite}
			<svg class="malhilfe" width={anzeige.w} height={anzeige.h} aria-hidden="true">
				{#if z.pflanzWahl.werkzeug === 'pinsel' && zeigerM}
					{@const q = schirmRahmen.utmZuPixel(zeigerM[0], zeigerM[1])}
					<circle cx={q[0] * sk} cy={q[1] * sk} r={(z.pflanzWahl.pinselM / 2 / schirmRahmen.mpp) * sk} class:radiert={z.pflanzWahl.radieren} />
				{/if}
				{#if malZug && z.pflanzWahl.werkzeug === 'lasso' && malZug.ring.length > 1}
					<polygon points={malZug.ring.map(([x, y]) => { const q = schirmRahmen!.utmZuPixel(x, y); return `${q[0] * sk},${q[1] * sk}`; }).join(' ')} class:radiert={z.pflanzWahl.radieren} />
				{/if}
			</svg>
		{/if}
		{#if entwirft && schirmRahmen}
			<!-- Auswahl, Formen, Griffe, Maße und was gerade entsteht, in Bildschirmpunkten über dem Blatt. -->
			{@const zug = (ring: Punkt[]) => ring.map(([x, y]) => pixel(x, y).join(',')).join(' ')}
			<svg class="entwurfhilfe" width={anzeige.w} height={anzeige.h} aria-hidden="true">
				<!-- Bestand unter Neubauten, der noch nicht gestrichen ist -->
				{#each z.konflikte as o (o.id)}
					{#each o.ringe as ring}<polygon class="konflikt" points={zug(ring)} />{/each}
				{/each}
				<!-- Geschosse als Zahl im Plan: am Gebäude seine Geschosse, an jeder Aufstockung, wie viele dazukommen. -->
				{#each z.entwurf.filter((o) => !o.typ) as o (o.id)}
					<!-- Unten links im Gebäude, damit die Zahl nicht unter einer Aufstockung in der Mitte verschwindet. -->
					{@const pq = o.ringe.flat().map(([x, y]) => pixel(x, y))}
					{@const m = [Math.min(...pq.map((q) => q[0])) + 14, Math.max(...pq.map((q) => q[1])) - 9]}
					<text class="geschosse" x={m[0]} y={m[1]}>{o.geschosse}</text>
					{#each (o.formen ?? []).filter((f) => f.art === 'masse' && !f.aus && f.bis !== null) as f (f.id)}
						{@const q = pixel(...mittePunkt(f))}
						<text class="geschosse plus" x={q[0]} y={q[1] + 4}>+{(f.bis ?? 0) - f.von}</text>
					{/each}
				{/each}
				{#each z.gewaehlteNeubauten as o (o.id)}
					{#each [...o.ringe, ...(o.loecher ?? [])] as ring}
						<polygon class="gewaehlt" class:neben={!!z.formWahl} points={zug(ring)} />
					{/each}
					<!-- Die Formen im Stapel: Aussparungen rot gestrichelt, weitere Massen im Akzent -->
					{#each o.formen ?? [] as f (f.id)}
						{#each f.ringe as ring}
							<polygon class="form" class:spart={f.art === 'aussparung'} class:aus={f.aus} class:jetzt={z.formWahl?.form === f.id} points={zug(ring)} />
						{/each}
					{/each}
				{/each}
				{#if griffe && !z.entwurfLinie.length}
					<line class="drehstiel" x1={griffe.anker[0]} y1={griffe.anker[1]} x2={griffe.dreh[0]} y2={griffe.dreh[1]} />
					<circle class="drehgriff" cx={griffe.dreh[0]} cy={griffe.dreh[1]} r="6" />
					{#each griffe.masse as m}
						<text class="kantenmass" x={m.q[0]} y={m.q[1] + 3.5}>{m.text}</text>
					{/each}
					{#each griffe.mitten as m}
						<circle class="mittel" cx={m.q[0]} cy={m.q[1]} r="3.5" />
					{/each}
					{#each griffe.punkte as g}
						<rect class="griff" x={g.q[0] - 4} y={g.q[1] - 4} width="8" height="8" />
					{/each}
				{/if}
				{#if rechteckJetzt}
					{@const ring = rechteckRing(rechteckJetzt)}
					{@const m = pixel(rechteckJetzt.cx, rechteckJetzt.cy)}
					<polygon class="entsteht" class:spart={z.entwurfModus === 'aussparen'} class:gruen={z.entwurfModus === 'gruen'} class:auf={z.entwurfModus === 'aufsatz'} points={zug(ring)}
						style:fill={z.entwurfModus === 'bauen' ? z.neubauFarbe ?? '#8A8A88' : null} />
					<text class="mass" x={m[0]} y={m[1]}>{zahl(rechteckJetzt.l, { maximumFractionDigits: 1 })} × {zahl(rechteckJetzt.t, { maximumFractionDigits: 1 })} m</text>
				{/if}
				{#if z.entwurfLinie.length}
					{@const l = z.entwurfLinie}
					{@const naechster = zeigerM ? polygonPunkt(zeigerM, umschalt) : null}
					<polyline class="linie" class:spart={z.entwurfModus === 'aussparen'} points={zug(naechster ? [...l, naechster] : l)} />
					{#each l as [x, y], i}
						{@const q = pixel(x, y)}
						<circle class="punkt" class:erster={i === 0 && l.length >= 3} cx={q[0]} cy={q[1]} r={i === 0 && l.length >= 3 ? 6 : 3.5} />
					{/each}
					{#if naechster}
						{@const letzt = l[l.length - 1]}
						{@const m = pixel((letzt[0] + naechster[0]) / 2, (letzt[1] + naechster[1]) / 2)}
						<text class="kantenmass" x={m[0]} y={m[1] - 8}>{meterText(Math.hypot(naechster[0] - letzt[0], naechster[1] - letzt[1]))}</text>
					{/if}
				{/if}
				{#each flucht as fl}
					<!-- Die Flucht von der Nachbarkante bis zum Punkt und ein Stück darüber hinaus -->
					{@const a = pixel(...fl.von)}
					{@const b = pixel(...fl.bis)}
					{@const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1}
					<line class="flucht" x1={a[0]} y1={a[1]} x2={b[0] + ((b[0] - a[0]) / l) * 60} y2={b[1] + ((b[1] - a[1]) / l) * 60} />
					<circle class="fluchtpunkt" cx={b[0]} cy={b[1]} r="3" />
				{/each}
				{#if z.schnitt && !z.entwurfLinie.length && z.entwurfWerkzeug === 'waehlen'}
					<!-- Wo der Schnitt im Arbeitsfenster liegt -->
					{@const a = pixel(...z.schnitt.von)}
					{@const b = pixel(...z.schnitt.bis)}
					<line class="schnittlinie" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
				{/if}
				{#if fangPunkt}
					{@const q = pixel(...fangPunkt)}
					<circle class="fang" cx={q[0]} cy={q[1]} r="7" />
				{/if}
			</svg>
		{/if}
		{#if zeigerM && schirmRahmen}
			<p class="zeiger mono">
				{zahl(Math.round(zeigerM[0]))} · {zahl(Math.round(zeigerM[1]))}
			</p>
		{/if}
	{/if}
</div>

<style>
	.huelle { position: absolute; inset: 0; z-index: 1; }
	.huelle.ruht { visibility: hidden; }
	canvas { display: block; }
	/*
	 * Der Zeiger sagt, was ein Klick tut (Volker, 09.11.2026: „die Maus ist ein
	 * Handsymbol"): Pfeil zum Wählen, Fadenkreuz zum Zeichnen. Die Hand kommt
	 * nur, während die Ansicht wirklich geschoben wird, und in der Ausgabe, wo
	 * es nichts zu wählen gibt.
	 */
	canvas.waehlbar, canvas.entwirft { cursor: default; }
	canvas.zeichnet { cursor: crosshair; }
	canvas.gezoomt { cursor: grab; }
	canvas.greift { cursor: grabbing !important; }
	canvas.plottet {
		animation: lauf 800ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes lauf {
		from { clip-path: inset(0 100% 0 0); }
		to { clip-path: inset(0 0 0 0); }
	}
	.zeiger {
		position: absolute; right: 66px; bottom: 18px; margin: 0;
		font-size: 11px; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie);
		padding: 3px 7px; border-radius: 2px; pointer-events: none;
	}
	.filterhalter { position: absolute; width: 0; height: 0; overflow: hidden; }
	canvas.malt { cursor: crosshair; }
	.malhilfe { position: absolute; left: 0; top: 0; pointer-events: none; }
	.malhilfe circle, .malhilfe polygon { fill: var(--akzent-flor); stroke: var(--akzent-tief); stroke-width: 1.5; }
	canvas.entwirft.schiebt { cursor: move; }
	.entwurfhilfe { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
	.entwurfhilfe .gewaehlt { fill: none; stroke: var(--akzent-tief); stroke-width: 2; }
	.entwurfhilfe .griff { fill: var(--blatt); stroke: var(--akzent-tief); stroke-width: 1.5; }
	.entwurfhilfe .mittel { fill: var(--blatt); stroke: var(--akzent-tief); stroke-width: 1; opacity: 0.8; }
	.entwurfhilfe .drehstiel { stroke: var(--akzent-tief); stroke-width: 1; }
	.entwurfhilfe .drehgriff { fill: var(--akzent-flor); stroke: var(--akzent-tief); stroke-width: 1.5; }
	.entwurfhilfe .spart { stroke: #d2453a; stroke-dasharray: 5 3; }
	.entwurfhilfe .gewaehlt.neben { stroke-opacity: 0.45; stroke-dasharray: 3 3; }
	.entwurfhilfe .form { fill: none; stroke: var(--akzent-tief); stroke-width: 1.25; stroke-dasharray: 2 3; }
	.entwurfhilfe .form.spart { fill: rgb(210 69 58 / 0.08); stroke: #d2453a; stroke-dasharray: 5 3; }
	.entwurfhilfe .form.jetzt { stroke-width: 2.25; }
	.entwurfhilfe .form.aus { opacity: 0.35; }
	.entwurfhilfe .entsteht.gruen { fill: #9FB27E; }
	.entwurfhilfe .konflikt { fill: none; stroke: #d2453a; stroke-width: 1.25; stroke-dasharray: 1.5 2.5; }
	.entwurfhilfe .entsteht.auf { fill: var(--akzent-flor); }
	.entwurfhilfe .geschosse {
		font: 600 11px/1 var(--mono, ui-monospace, monospace); fill: var(--tinte); text-anchor: middle;
		paint-order: stroke; stroke: var(--blatt); stroke-width: 3px; pointer-events: none;
	}
	.entwurfhilfe .fang { fill: none; stroke: var(--akzent-tief); stroke-width: 1.5; }
	/* Kräftig genug, um auf Schwarz und auf Weiß zu lesen: Akzent mit hellem Saum. */
	.entwurfhilfe .flucht { stroke: var(--akzent); stroke-width: 1.75; stroke-dasharray: 8 3 2 3; filter: drop-shadow(0 0 1px var(--blatt)); }
	.entwurfhilfe .fluchtpunkt { fill: var(--akzent); stroke: var(--blatt); stroke-width: 1; }
	.entwurfhilfe .schnittlinie { stroke: var(--tinte-2); stroke-width: 1; stroke-dasharray: 9 3 2 3; opacity: 0.8; }
	.entwurfhilfe .kantenmass {
		font: 500 11px/1 var(--mono, ui-monospace, monospace); fill: var(--tinte-2); text-anchor: middle;
		paint-order: stroke; stroke: var(--blatt); stroke-width: 3px;
	}
	.entwurfhilfe .entsteht { fill-opacity: 0.55; stroke: var(--akzent-tief); stroke-width: 1.5; }
	.entwurfhilfe .linie { fill: none; stroke: var(--akzent-tief); stroke-width: 1.5; stroke-dasharray: 5 3; }
	.entwurfhilfe .punkt { fill: var(--blatt); stroke: var(--akzent-tief); stroke-width: 1.5; }
	.entwurfhilfe .punkt.erster { fill: var(--akzent-flor); }
	.entwurfhilfe .mass {
		font: 600 11px/1 var(--mono, ui-monospace, monospace); fill: var(--tinte); text-anchor: middle;
		paint-order: stroke; stroke: var(--blatt); stroke-width: 3px;
	}
	.malhilfe .radiert { fill: rgb(210 69 58 / 0.12); stroke: #d2453a; stroke-dasharray: 4 3; }
</style>
