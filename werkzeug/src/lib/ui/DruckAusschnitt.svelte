<script lang="ts">
	import { z } from '$lib/zustand.svelte';
	import { t, zahl } from '$lib/sprache.svelte';
	import { Rahmen } from '$lib/geo/rahmen';
	import { zeichneBlatt } from '$lib/zeichnen';
	import type { druckMasse } from '$lib/export/druck';
	import type { Objekt } from '$lib/osm';

	/**
	 * Den Druckausschnitt auf dem Plan wählen (Volker, 05.11.2026: nur einen
	 * Teil drucken, bis es druckbar ist). Der Rahmen als Schwarzplan, darüber
	 * ein Rechteck: in der Mitte ziehen verschiebt es, an den Ecken ziehen
	 * ändert die Größe. Im Rechteck steht, wie groß der Druck wird.
	 */
	/** `masse` kommt von der Seite, die sie ohnehin rechnet; eine zweite Zählung je Mausbewegung wäre zu teuer. */
	let { objekte, r, masse }: { objekte: Objekt[]; r: Rahmen; masse: ReturnType<typeof druckMasse> } = $props();

	let bild = $state('');
	$effect(() => {
		const c = document.createElement('canvas');
		// Fein genug, dass es beim Zoomen bis 6× noch trägt.
		c.width = 3200; c.height = Math.round((3200 * r.hoeheM) / r.breiteM);
		const klein = new Rahmen({ lon0: r.gitter.lon0, bbox: [r.x0, r.y0, r.x1, r.y1], pixelBreite: c.width, verhaeltnis: r.verhaeltnis });
		zeichneBlatt(c.getContext('2d')!, objekte, klein, {
			darstellung: 'schwarzplan', bereinigt: z.bereinigt, beschriftung: false,
			plangebiet: null, rahmenZeigen: false, sichtbar: z.sichtbar, hervorgehoben: null
		});
		bild = c.toDataURL('image/png');
	});

	const a = $derived(z.druck.ausschnitt);
	let flaeche = $state<HTMLDivElement | null>(null);
	/** Der Plan passt ganz in die Bühne: Größe aus dem freien Platz und dem Seitenverhältnis. */
	let platz = $state<HTMLDivElement | null>(null);
	let pb = $state(600), ph = $state(400);
	$effect(() => {
		const el = platz;
		if (!el) return;
		const messen = () => { pb = el.clientWidth; ph = el.clientHeight; };
		messen();
		const beob = new ResizeObserver(messen);
		beob.observe(el);
		return () => beob.disconnect();
	});
	/**
	 * Der Plan liegt über der ganzen Bühne und läuft beim Schieben unter das
	 * Druckfenster (Volker, 05.11.2026). Eingepasst wird er in den freien
	 * Platz rechts davon; Maßstab und Größe stehen im Fenster.
	 */
	const FREI = { links: 344, rechts: 28, oben: 28, unten: 56 };
	const groesseFlaeche = $derived.by(() => {
		const s = r.breiteM / r.hoeheM;
		const fb = Math.max(100, pb - FREI.links - FREI.rechts), fh = Math.max(100, ph - FREI.oben - FREI.unten);
		return fb / fh > s ? { b: fh * s, h: fh } : { b: fb, h: fb / s };
	});
	let zieht = $state.raw<null | { art: 'mitte' | 'nw' | 'ne' | 'sw' | 'se' | 'plan'; x: number; y: number; vorher: typeof a; tx: number; ty: number }>(null);

	/**
	 * Zoomen und Schieben (Volker, 05.11.2026): das Rad zoomt um den Zeiger,
	 * Ziehen neben dem Rechteck schiebt den Plan. Griffe und Maßangabe
	 * bleiben gleich groß.
	 */
	let zoom = $state(1), tx = $state(0), ty = $state(0);
	const ox = $derived(FREI.links + (pb - FREI.links - FREI.rechts - groesseFlaeche.b) / 2);
	const oy = $derived(FREI.oben + (ph - FREI.oben - FREI.unten - groesseFlaeche.h) / 2);
	function rad(e: WheelEvent) {
		if (!platz) return;
		e.preventDefault();
		const b = platz.getBoundingClientRect();
		const cx = e.clientX - b.left, cy = e.clientY - b.top;
		const neu = Math.min(6, Math.max(0.5, zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
		const ux = (cx - ox - tx) / zoom, uy = (cy - oy - ty) / zoom;
		tx = cx - ox - ux * neu; ty = cy - oy - uy * neu; zoom = neu;

	}
	function planRunter(e: PointerEvent) {
		if (e.button !== 0 && e.button !== 2) return;
		e.preventDefault();
		zieht = { art: 'plan', x: e.clientX, y: e.clientY, vorher: { ...a }, tx, ty };
	}

	function runter(e: PointerEvent, art: 'mitte' | 'nw' | 'ne' | 'sw' | 'se') {
		e.stopPropagation();
		e.preventDefault();
		zieht = { art, x: e.clientX, y: e.clientY, vorher: { ...a }, tx, ty };
	}
	function bewegen(e: PointerEvent) {
		if (!zieht || !flaeche) return;
		if (zieht.art === 'plan') { tx = zieht.tx + e.clientX - zieht.x; ty = zieht.ty + e.clientY - zieht.y; return; }
		const b = flaeche.getBoundingClientRect();
		const dx = (e.clientX - zieht.x) / b.width, dy = -(e.clientY - zieht.y) / b.height;   // y nach Norden
		const v = zieht.vorher, MIN = 0.05;
		let { x0, y0, x1, y1 } = v;
		if (zieht.art === 'mitte') {
			const w = x1 - x0, h = y1 - y0;
			x0 = Math.min(1 - w, Math.max(0, v.x0 + dx)); y0 = Math.min(1 - h, Math.max(0, v.y0 + dy));
			x1 = x0 + w; y1 = y0 + h;
		} else {
			if (zieht.art.includes('w')) x0 = Math.min(x1 - MIN, Math.max(0, v.x0 + dx));
			if (zieht.art.includes('e')) x1 = Math.max(x0 + MIN, Math.min(1, v.x1 + dx));
			if (zieht.art.includes('s')) y0 = Math.min(y1 - MIN, Math.max(0, v.y0 + dy));
			if (zieht.art.includes('n')) y1 = Math.max(y0 + MIN, Math.min(1, v.y1 + dy));
		}
		z.druck.ausschnitt = { x0, y0, x1, y1 };
	}
	const hoch = () => (zieht = null);

	/** Pfeiltasten schieben das Rechteck, mit Umschalt in größeren Schritten. */
	function taste(e: KeyboardEvent) {
		const d = e.shiftKey ? 0.05 : 0.01;
		const [dx, dy] = e.key === 'ArrowLeft' ? [-d, 0] : e.key === 'ArrowRight' ? [d, 0] : e.key === 'ArrowUp' ? [0, d] : e.key === 'ArrowDown' ? [0, -d] : [0, 0];
		if (!dx && !dy) return;
		e.preventDefault();
		const w = a.x1 - a.x0, h = a.y1 - a.y0;
		const x0 = Math.min(1 - w, Math.max(0, a.x0 + dx)), y0 = Math.min(1 - h, Math.max(0, a.y0 + dy));
		z.druck.ausschnitt = { x0, y0, x1: x0 + w, y1: y0 + h };
	}

</script>

<!-- Am Fenster, nicht am Griff: Mit Pointer Capture riss das Ziehen nach
     zwei Bewegungen ab (gemessen 05.11.2026). -->
<svelte:window onpointermove={bewegen} onpointerup={hoch} onpointercancel={hoch} />

<div class="buehne-druck">
	<div class="platz" bind:this={platz} onwheel={rad} onpointerdown={planRunter} oncontextmenu={(e) => e.preventDefault()} role="presentation" class:zieht={zieht?.art === 'plan'}>
	<div class="flaeche" bind:this={flaeche} style:width="{groesseFlaeche.b}px" style:height="{groesseFlaeche.h}px"
		style:transform="translate({ox + tx}px, {oy + ty}px) scale({zoom})" style:--z={zoom} role="presentation">
		{#if bild}<img src={bild} alt="" />{/if}
		<!-- Abgedunkelt wird nur der Plan außerhalb des Rechtecks, in vier Streifen.
		     Ein großer Schatten färbte die ganze Bühne mit (zwei Rahmen, Volker). -->
		<div class="maske" style:left="0" style:top="0" style:width="100%" style:height="{(1 - a.y1) * 100}%"></div>
		<div class="maske" style:left="0" style:top="{(1 - a.y0) * 100}%" style:width="100%" style:height="{a.y0 * 100}%"></div>
		<div class="maske" style:left="0" style:top="{(1 - a.y1) * 100}%" style:width="{a.x0 * 100}%" style:height="{(a.y1 - a.y0) * 100}%"></div>
		<div class="maske" style:left="{a.x1 * 100}%" style:top="{(1 - a.y1) * 100}%" style:width="{(1 - a.x1) * 100}%" style:height="{(a.y1 - a.y0) * 100}%"></div>
		<!-- Fokussierbar: Pfeiltasten schieben nur, wenn das Rechteck den Fokus hat,
		     nicht während man die Leiste mit Tab durchläuft. Ein eigenes Werkzeug
		     ohne passende ARIA-Rolle; die Beschriftung sagt, was es tut. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="auswahl" role="group" tabindex="0" aria-label={t().ausgeben.druckRechteckWas}
			style:left="{a.x0 * 100}%" style:width="{(a.x1 - a.x0) * 100}%"
			style:top="{(1 - a.y1) * 100}%" style:height="{(a.y1 - a.y0) * 100}%"
			onpointerdown={(e) => runter(e, 'mitte')} onkeydown={taste}>
			<span class="mass mono">{zahl(Math.round(masse.breiteMm))} × {zahl(Math.round(masse.hoeheMm))} mm · 1:{zahl(masse.massstab)}</span>
			{#each ['nw', 'ne', 'sw', 'se'] as ecke}
				<span class="griff {ecke}" role="presentation" onpointerdown={(e) => runter(e, ecke as 'nw')}></span>
			{/each}
		</div>
	</div>
	</div>
	<p class="wink">{t().ausgeben.druckAusschnittWink} · {t().ausgeben.druckZoomWink}</p>
</div>

<style>
	.buehne-druck { position: absolute; inset: 0; z-index: 1; background: var(--grund, #eaeae9); }
	/* Links Platz für das Druckfenster, rechts für die Tafel: Der Plan liegt dazwischen. */
	.platz { position: absolute; inset: 0; overflow: hidden; cursor: grab; }
	.platz.zieht { cursor: grabbing; }
	.flaeche { position: absolute; left: 0; top: 0; transform-origin: 0 0; touch-action: none; user-select: none; }
	img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
	.maske { position: absolute; background: rgb(255 255 255 / 0.6); pointer-events: none; }
	:global([data-schema='dunkel']) .maske { background: rgb(0 0 0 / 0.5); }
	.auswahl {
		position: absolute; border: calc(2px / var(--z)) solid var(--akzent); cursor: move;
	}
	.mass {
		/* Über dem Rechteck, damit sie auch bei kleinen Ausschnitten zu lesen ist. */
		transform: translateY(-100%) scale(calc(1 / var(--z))); transform-origin: 0 100%;
		position: absolute; left: -2px; top: -6px; font-size: 11px; padding: 2px 6px; white-space: nowrap;
		background: var(--blatt); color: var(--tinte); border-radius: 2px; pointer-events: none;
	}
	.griff {
		transform: scale(calc(1 / var(--z)));
		position: absolute; width: 12px; height: 12px; background: var(--blatt);
		border: 2px solid var(--akzent); border-radius: 2px;
	}
	.nw { left: -7px; top: -7px; cursor: nwse-resize; }
	.ne { right: -7px; top: -7px; cursor: nesw-resize; }
	.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
	.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
	.wink {
		position: absolute; right: 18px; bottom: 18px; margin: 0; font-size: 11px; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie); padding: 3px 8px; border-radius: 2px;
	}
</style>
