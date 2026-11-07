<script lang="ts">
	import { untrack } from 'svelte';
	import { mitte, filterWerte, istNeutral } from '$lib/anpassen';
	import { zahl } from '$lib/sprache.svelte';
	import { z, BAUM_ID } from '$lib/zustand.svelte';
	import { Rahmen } from '$lib/geo/rahmen';
	import { zeichneBlatt } from '$lib/zeichnen';
	import { trifft, sichtEbene } from '$lib/osm';

	let { waehlbar = false }: { waehlbar?: boolean } = $props();

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
		const k = z.kasten;
		if (!k || !breite || !hoehe) return null;
		const bm = k.x1 - k.x0, hm = k.y1 - k.y0;
		const buehne = breite / hoehe;
		// Grundansicht: das ganze Blatt mit etwas Luft, im Format der Bühne
		const grundB = bm / hm > buehne ? bm * 1.1 : hm * 1.1 * buehne;
		const b = grundB / z.zoom, h = b / buehne;
		const cx = k.x0 + bm * z.mitte.x;
		const cy = k.y1 - hm * z.mitte.y;
		return new Rahmen({
			lon0: k.lon0, bbox: [cx - b / 2, cy - h / 2, cx + b / 2, cy + h / 2],
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
		// Abhängigkeiten anmelden, damit jede Änderung neu zeichnet
		z.objekte; z.sichtbar; z.hervorgehoben; z.ausgewaehlt; z.darstellung; waehlbar;
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
			const w = Math.round(g.r.pixelBreite * g.dpr), h = Math.round(g.r.pixelHoehe * g.dpr);
			if (g.c.width !== w) g.c.width = w;
			if (g.c.height !== h) g.c.height = h;
			g.c.style.width = `${anzeige.w}px`;
			g.c.style.height = `${anzeige.h}px`;
			const ctx = g.c.getContext('2d')!;
			ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
			zeichneBlatt(ctx, z.objekte, g.r, g.wunsch);
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
			const schluessel = [z.darstellung, z.bereinigt, z.baeume, z.sichtbar.size, z.objekte.length].join('|');
			if (z.zoom === 1) { blattMitte = mitte(g.c); mitteFuer = schluessel; }
			else if (mitteFuer !== schluessel && z.kasten) {
				const k = z.kasten;
				const klein = new Rahmen({ lon0: k.lon0, bbox: [k.x0, k.y0, k.x1, k.y1], pixelBreite: 320, verhaeltnis: 'frei' });
				const c = document.createElement('canvas');
				c.width = klein.pixelBreite; c.height = klein.pixelHoehe;
				zeichneBlatt(c.getContext('2d')!, z.objekte, klein, { ...g.wunsch, blattrand: null, ausgewaehlt: undefined, fanglinie: undefined, ohneSchatten: true });
				blattMitte = mitte(c); mitteFuer = schluessel;
			}
		});
	});
	let geplant: { r: Rahmen; c: HTMLCanvasElement; dpr: number; wunsch: Parameters<typeof zeichneBlatt>[3] } | null = null;
	let takt = 0;
	let blattMitte = $state(0.5);
	let mitteFuer = '';

	// Während ein Regler der Karte oder der Kanten bewegt wird: ohne Schatten,
	// wie beim Zoomen. Das fertige Bild kommt, wenn er ruht.
	$effect(() => {
		z.kanten.dicke; z.kanten.deckkraft; z.kanten.karteDicke; z.kanten.karteDeckkraft; z.kanten.an; z.kanten.hell; z.kanten.flaeche; z.darstellung;
		untrack(() => bewegtSich());
	});

	/** Ein Lauf des Plotters: der einzige gestaltete Bewegungsmoment. */
	$effect(() => {
		if (!z.geladenFuer) return;
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
		// Beim Pflanzen verschiebt die rechte Taste, sonst die linke.
		if (e.button !== (malt ? 2 : 0)) return;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		zieht = { x: e.clientX, y: e.clientY, mx: z.mitte.x, my: z.mitte.y, bewegt: false };
	}
	function schieben(e: PointerEvent) {
		zeigerM = meterAus(e);
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
		z.mitte = { x: (zx - k.x0) / (k.x1 - k.x0), y: (k.y1 - zy) / (k.y1 - k.y0) };
		klemmen();
	}

	/** Masse der Ansicht bei einem gegebenen Zoom, ohne den Zustand zu ändern. */
	function schirmRahmenFuer(zz: number) {
		const k = z.kasten;
		if (!k || !breite || !hoehe) return null;
		const buehne = breite / hoehe;
		const bm = k.x1 - k.x0, hm = k.y1 - k.y0;
		const grundB = bm / hm > buehne ? bm * 1.1 : hm * 1.1 * buehne;
		const b = grundB / zz;
		return { b, h: b / buehne };
	}

	function tippen(e: PointerEvent) {
		if (!waehlbar) return;
		const p = meterAus(e), r = schirmRahmen;
		if (!p || !r) return;
		if (z.werkzeug === 'polygon') { z.punktSetzen(p[0], p[1]); return; }
		const tol = r.mpp * 4;
		// Neben das Blatt geklickt: Auswahl aufheben, dort steht nichts zur Wahl.
		const k = z.kasten;
		const draussen = !k || p[0] < k.x0 || p[0] > k.x1 || p[1] < k.y0 || p[1] > k.y1;
		const treffer = draussen ? [] : z.objekte.filter((o) => z.sichtbar.has(sichtEbene(o)) && trifft(o, p[0], p[1], tol));
		// Bäume, wenn sie zu sehen sind: getroffen ist die Krone.
		const baeume = draussen || !z.baeume ? [] : z.baumpunkte.filter((b) =>
			b.id && Math.hypot(b.x - p[0], b.y - p[1]) <= Math.max(b.krone / 2, tol));
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

	/** Escape hebt die Auswahl auf, solange gewählt werden kann. */
	function taste(e: KeyboardEvent) {
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

<svelte:window onkeydown={taste} />

<div class="huelle" bind:this={huelle}>
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
			class:zeichnet={z.werkzeug === 'polygon'}
			class:gezoomt={z.zoom > 1 && z.werkzeug !== 'polygon'}
			onpointerdown={runter}
			onpointermove={schieben}
			onpointerup={hoch}
			onpointercancel={hoch}
			onwheel={rad}
			oncontextmenu={(e) => { if (malt) { e.preventDefault(); return; } if (z.werkzeug === 'polygon') { e.preventDefault(); z.letztenPunktZurueck(); } }}
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
		{#if zeigerM && schirmRahmen}
			<p class="zeiger mono">
				{zahl(Math.round(zeigerM[0]))} · {zahl(Math.round(zeigerM[1]))}
			</p>
		{/if}
	{/if}
</div>

<style>
	.huelle { position: absolute; inset: 0; z-index: 1; }
	canvas { display: block; }
	canvas.waehlbar { cursor: crosshair; }
	canvas.zeichnet { cursor: copy; }
	canvas.gezoomt { cursor: grab; }
	canvas.gezoomt:active { cursor: grabbing; }
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
	.malhilfe .radiert { fill: rgb(210 69 58 / 0.12); stroke: #d2453a; stroke-dasharray: 4 3; }
</style>
