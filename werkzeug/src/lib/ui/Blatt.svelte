<script lang="ts">
	import { zahl } from '$lib/sprache.svelte';
	import { z } from '$lib/zustand.svelte';
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
		z.objekte; z.sichtbar; z.hervorgehoben; z.ausgewaehlt; z.darstellung;
		z.bereinigt; z.plangebiet; z.beschriftung; z.fanglinie; z.zoom; z.mitte; flott; z.baeume;
		const dpr = Math.min(devicePixelRatio || 1, 2);
		c.width = Math.round(r.pixelBreite * dpr);
		c.height = Math.round(r.pixelHoehe * dpr);
		c.style.width = `${anzeige.w}px`;
		c.style.height = `${anzeige.h}px`;
		const ctx = c.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		zeichneBlatt(ctx, z.objekte, r, {
			darstellung: z.darstellung, bereinigt: z.bereinigt,
			beschriftung: z.beschriftung, plangebiet: z.plangebiet, rahmenZeigen: true,
			sichtbar: z.sichtbar, hervorgehoben: z.hervorgehoben,
			ausgewaehlt: z.ausgewaehlt, fanglinie: z.fanglinie, ohneSchatten: flott,
			baeume: z.baeume ? z.baumpunkte : undefined,
			blattrand: z.kasten ? [z.kasten.x0, z.kasten.y0, z.kasten.x1, z.kasten.y1] : null
		});
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
		if (e.button !== 0) return;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		zieht = { x: e.clientX, y: e.clientY, mx: z.mitte.x, my: z.mitte.y, bewegt: false };
	}
	function schieben(e: PointerEvent) {
		zeigerM = meterAus(e);
		if (!zieht || !leinwand) return;
		const dx = e.clientX - zieht.x, dy = e.clientY - zieht.y;
		if (!zieht.bewegt && Math.hypot(dx, dy) < 5) return;
		if (z.werkzeug === 'polygon') return;   // im Polygonmodus wird gesetzt, nicht geschoben
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
		const gezogen = zieht?.bewegt ?? false;
		zieht = null;
		try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
		if (!gezogen) tippen(e);
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
		const treffer = z.objekte.filter((o) => z.sichtbar.has(sichtEbene(o)) && trifft(o, p[0], p[1], tol));
		if (!treffer.length) { if (!e.shiftKey) z.ausgewaehlt = new Set(); return; }
		// kleinstes Objekt gewinnt, damit ein Haus im Block anklickbar bleibt
		treffer.sort((a, b) => flaeche(a) - flaeche(b));
		const id = treffer[0].id;
		if (e.shiftKey) z.auswahlUmschalten(id);
		else z.ausgewaehlt = new Set([id]);
	}

	const flaeche = (o: { ringe: [number, number][][] }) => {
		const r = o.ringe[0]; let s = 0;
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
		return Math.abs(s / 2);
	};
</script>

<div class="huelle" bind:this={huelle}>
	{#if schirmRahmen}
		<canvas
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
			oncontextmenu={(e) => { if (z.werkzeug === 'polygon') { e.preventDefault(); z.letztenPunktZurueck(); } }}
			onpointerleave={() => (zeigerM = null)}
			role="presentation"
		></canvas>
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
		position: absolute; right: 34px; bottom: 34px; margin: 0;
		font-size: 11px; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie);
		padding: 3px 7px; border-radius: 2px; pointer-events: none;
	}
</style>
