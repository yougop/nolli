<script lang="ts">
	import { untrack } from 'svelte';
	import { z } from '$lib/zustand.svelte';
	import { t, zahl } from '$lib/sprache.svelte';
	import { Rahmen } from '$lib/geo/rahmen';
	import { zeichneBlatt } from '$lib/zeichnen';
	import type { druckMasse } from '$lib/export/druck';
	import type { Objekt } from '$lib/osm';
	import { drin, ringflaeche } from '$lib/schneiden';

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

	/**
	 * Kachelnähte und zu kleine Teile im Ausschnitt (Volker, 06.11.2026): Man
	 * soll den Ausschnitt so schieben können, dass keine Naht knapp an einem
	 * Haus vorbeigeht. Gezeichnet in Metern über dem Plan; rot ist jeder Bau,
	 * von dem ein Stück zu schmal druckt.
	 */
	const B = $derived(r.x1 - r.x0), H = $derived(r.y1 - r.y0);
	const rot = $derived(objekte.filter((o) => masse.kleinIds.has(o.id)).map((o) =>
		o.ringe.map((ring) => 'M' + ring.map(([x, y]) => `${(x - r.x0).toFixed(1)} ${(r.y1 - y).toFixed(1)}`).join('L') + 'Z').join('')).join(''));
	/** Bauten, die nur im Druck fehlen; gestrichelt ausgespart. */
	const wegPfad = $derived.by(() => {
		const weg = new Set(z.druck.weglassen ?? []);
		return objekte.filter((o) => weg.has(o.id)).map((o) =>
			o.ringe.map((ring) => 'M' + ring.map(([x, y]) => `${(x - r.x0).toFixed(1)} ${(r.y1 - y).toFixed(1)}`).join('L') + 'Z').join('')).join('');
	});
	/**
	 * Ein Klick ins Rechteck, ohne zu ziehen, nimmt den Bau darunter aus dem
	 * Druck oder holt ihn zurück. Bei mehreren übereinander gewinnt der
	 * kleinste, also das Bauteil vor dem Umriss.
	 */
	function umschalten(e: PointerEvent) {
		if (!flaeche) return;
		const b = flaeche.getBoundingClientRect();
		const x = r.x0 + ((e.clientX - b.left) / b.width) * B, y = r.y1 - ((e.clientY - b.top) / b.height) * H;
		let best: Objekt | null = null, fl = Infinity;
		for (const o of objekte) {
			if ((o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') || o.zustand === 'gestrichen' || !o.ringe.length) continue;
			if (!o.ringe.some((ring) => drin([x, y], ring))) continue;
			const f = Math.abs(ringflaeche(o.ringe[0]));
			if (f < fl) { fl = f; best = o; }
		}
		if (!best) return;
		const weg = new Set(z.druck.weglassen ?? []);
		if (weg.has(best.id)) weg.delete(best.id); else weg.add(best.id);
		z.druck.weglassen = [...weg];
	}
	const naehteX = $derived(Array.from({ length: Math.max(0, masse.nx - 1) }, (_, i) => (a.x0 + ((a.x1 - a.x0) * (i + 1)) / masse.nx) * B));
	const naehteY = $derived(Array.from({ length: Math.max(0, masse.ny - 1) }, (_, i) => (1 - (a.y0 + ((a.y1 - a.y0) * (i + 1)) / masse.ny)) * H));
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
		} else if (formatFest) {
			// Festes Format: Die Gegenecke bleibt stehen, das Rechteck wächst
			// oder schrumpft im gewählten Verhältnis (Volker, 06.11.2026).
			const B = r.breiteM, H = r.hoeheM, q = formatFest, west = zieht.art.includes('w'), sued = zieht.art.includes('s');
			const ax = west ? v.x1 : v.x0, ay = sued ? v.y1 : v.y0;
			const wRoh = Math.abs((west ? v.x0 + dx : v.x1 + dx) - ax), hRoh = Math.abs((sued ? v.y0 + dy : v.y1 + dy) - ay);
			let wM = Math.max(wRoh * B, hRoh * H * q);
			wM = Math.min(wM, (west ? ax : 1 - ax) * B, (sued ? ay : 1 - ay) * H * q);
			wM = Math.max(wM, MIN * B, MIN * H * q);
			const w = wM / B, h = wM / q / H;
			x0 = west ? ax - w : ax; x1 = x0 + w;
			y0 = sued ? ay - h : ay; y1 = y0 + h;
		} else {
			if (zieht.art.includes('w')) x0 = Math.min(x1 - MIN, Math.max(0, v.x0 + dx));
			if (zieht.art.includes('e')) x1 = Math.max(x0 + MIN, Math.min(1, v.x1 + dx));
			if (zieht.art.includes('s')) y0 = Math.min(y1 - MIN, Math.max(0, v.y0 + dy));
			if (zieht.art.includes('n')) y1 = Math.max(y0 + MIN, Math.min(1, v.y1 + dy));
		}
		z.druck.ausschnitt = { x0, y0, x1, y1 };
	}
	function hoch(e: PointerEvent) {
		const war = zieht;
		zieht = null;
		if (war?.art === 'mitte' && Math.hypot(e.clientX - war.x, e.clientY - war.y) < 4) umschalten(e);
	}

	/**
	 * Formatvorschläge (Volker, 06.11.2026). Ein Klick setzt das Rechteck auf
	 * das Seitenverhältnis in Metern, um seine Mitte und bei gleicher Fläche,
	 * und hält es im Rahmen. Hochkant dreht das Verhältnis.
	 */
	const FORMATE = [[1, 1], [4, 3], [3, 2], [16, 9]] as const;
	let hochkant = $state(false);
	/** Das gewählte Verhältnis in Metern, null heißt frei. Beim Ziehen an den Ecken hält es. */
	let formatFest = $state<number | null>(null);
	/** Seitenverhältnis des Rechtecks in Metern, Breite durch Höhe. */
	const verhaeltnisJetzt = $derived(((a.x1 - a.x0) * r.breiteM) / ((a.y1 - a.y0) * r.hoeheM));
	const istFormat = (q: number) => Math.abs(verhaeltnisJetzt / q - 1) < 0.01;
	const quote = (f: readonly [number, number], hk: boolean) => (hk ? f[1] / f[0] : f[0] / f[1]);
	// Ändert sich das Verhältnis von außen (Breite oder Höhe im Fenster), ist das Format frei.
	$effect(() => { if (formatFest && !istFormat(formatFest)) untrack(() => (formatFest = null)); });
	function formatSetzen(q: number) {
		formatFest = q;
		const B = r.breiteM, H = r.hoeheM;
		const flaeche = (a.x1 - a.x0) * B * (a.y1 - a.y0) * H;
		let w = Math.sqrt(flaeche * q), h = Math.sqrt(flaeche / q);
		const s = Math.min(1, B / w, H / h);
		w = (w * s) / B; h = (h * s) / H;
		const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
		const x0 = Math.min(1 - w, Math.max(0, cx - w / 2)), y0 = Math.min(1 - h, Math.max(0, cy - h / 2));
		z.druck.ausschnitt = { x0, y0, x1: x0 + w, y1: y0 + h };
	}
	function drehen() {
		hochkant = !hochkant;
		const q = 1 / (formatFest ?? verhaeltnisJetzt), fest = formatFest;
		formatSetzen(q);
		if (!fest) formatFest = null;
	}

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
<svelte:window onpointermove={bewegen} onpointerup={hoch} onpointercancel={() => (zieht = null)} />

<div class="buehne-druck">
	<div class="platz" bind:this={platz} onwheel={rad} onpointerdown={planRunter} oncontextmenu={(e) => e.preventDefault()} role="presentation" class:zieht={zieht?.art === 'plan'}>
	<div class="flaeche" bind:this={flaeche} style:width="{groesseFlaeche.b}px" style:height="{groesseFlaeche.h}px"
		style:transform="translate({ox + tx}px, {oy + ty}px) scale({zoom})" style:--z={zoom} role="presentation">
		{#if bild}<img src={bild} alt="" />{/if}
		<svg class="ueber" viewBox="0 0 {B} {H}" preserveAspectRatio="none" aria-hidden="true">
			{#if rot}<path class="rot" d={rot} />{/if}
			{#if wegPfad}<path class="weg" d={wegPfad} />{/if}
			{#each naehteX as x}<line class="naht" x1={x} y1={(1 - a.y1) * H} x2={x} y2={(1 - a.y0) * H} />{/each}
			{#each naehteY as y}<line class="naht" x1={a.x0 * B} y1={y} x2={a.x1 * B} y2={y} />{/each}
		</svg>
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
			<!-- Mittellinien wie im Rahmen auf der Karte (Volker, 06.11.2026). -->
			<!-- Weiß unterlegt, damit sie über schwarzen Häusern wie über hellem Grund liest (06.11.2026). -->
			<svg class="mitte" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
				<path class="saum" d="M0 50H100M50 0V100" />
				<path class="strich" d="M0 50H100M50 0V100" />
			</svg>
			<span class="mass mono">{zahl(Math.round(masse.breiteMm))} × {zahl(Math.round(masse.hoeheMm))} mm · 1:{zahl(masse.massstab)}</span>
			{#each ['nw', 'ne', 'sw', 'se'] as ecke}
				<span class="griff {ecke}" role="presentation" onpointerdown={(e) => runter(e, ecke as 'nw')}></span>
			{/each}
		</div>
	</div>
	</div>
	<div class="formate" role="group" aria-label={t().ausgeben.druckFormat}>
		<span>{t().ausgeben.druckFormat}</span>
		<button type="button" class:an={!formatFest} aria-pressed={!formatFest} onclick={() => (formatFest = null)}>{t().ausgeben.druckFrei}</button>
		{#each FORMATE as f}
			{@const q = quote(f, hochkant)}
			<button type="button" class:an={!!formatFest && Math.abs(formatFest / q - 1) < 1e-6} aria-pressed={!!formatFest && Math.abs(formatFest / q - 1) < 1e-6} onclick={() => formatSetzen(q)}>{hochkant ? `${f[1]}:${f[0]}` : `${f[0]}:${f[1]}`}</button>
		{/each}
		<button type="button" class="drehen" title={t().ausgeben.druckDrehen} aria-label={t().ausgeben.druckDrehen} onclick={drehen}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">{#if hochkant}<rect x="4.5" y="2" width="7" height="12" rx="1" />{:else}<rect x="2" y="4.5" width="12" height="7" rx="1" />{/if}</svg>
		</button>
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
	.ueber { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.rot { fill: #d2453a; fill-rule: nonzero; }
	/* Weggelassen: ausgespart wie Grund, gestrichelt umrandet. */
	.weg { fill: #f4f4f2; stroke: #1a1a1a; stroke-width: calc(1.25px / var(--z)); stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
	/* Nähte dunkel und durchgezogen, damit sie sich von den gestrichelten Mittellinien abheben. */
	.naht { stroke: #1a1a1a; stroke-opacity: 0.75; stroke-width: calc(1.25px / var(--z)); vector-effect: non-scaling-stroke; }
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
	.mitte { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
	.mitte path { fill: none; vector-effect: non-scaling-stroke; }
	.mitte .saum { stroke: rgb(255 255 255 / 0.85); stroke-width: calc(4px / var(--z)); }
	.mitte .strich { stroke: var(--akzent-tief); stroke-width: calc(2px / var(--z)); stroke-dasharray: calc(6px / var(--z)) calc(4px / var(--z)); }
	.formate {
		position: absolute; right: 18px; top: 18px; display: flex; align-items: center; gap: 2px;
		background: var(--blatt); border: 1px solid var(--linie); padding: 3px; border-radius: 2px; font-size: 11px;
	}
	.formate > span { color: var(--tinte-2); padding: 0 6px 0 4px; }
	.formate button {
		font: inherit; font-variant-numeric: tabular-nums; color: var(--tinte); background: none; border: 0;
		padding: 3px 7px; border-radius: 2px; cursor: pointer; display: flex; align-items: center;
	}
	.formate button:hover { background: var(--senke); }
	.formate button.an { background: var(--tinte); color: var(--blatt); }
	.formate .drehen { border-left: 1px solid var(--linie); border-radius: 0; margin-left: 2px; padding: 3px 6px; }
	.formate svg rect { fill: none; stroke: currentColor; stroke-width: 1.4; }
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
