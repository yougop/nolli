<script lang="ts">
	import { z } from '$lib/zustand.svelte';
	import { t, zahl } from '$lib/sprache.svelte';
	import { Rahmen } from '$lib/geo/rahmen';
	import { zeichneBlatt } from '$lib/zeichnen';
	import { druckMasse } from '$lib/export/druck';
	import type { Objekt } from '$lib/osm';

	/**
	 * Den Druckausschnitt auf dem Plan wählen (Volker, 05.11.2026: nur einen
	 * Teil drucken, bis es druckbar ist). Der Rahmen als Schwarzplan, darüber
	 * ein Rechteck: in der Mitte ziehen verschiebt es, an den Ecken ziehen
	 * ändert die Größe. Im Rechteck steht, wie groß der Druck wird.
	 */
	let { objekte, r }: { objekte: Objekt[]; r: Rahmen } = $props();

	let bild = $state('');
	$effect(() => {
		const c = document.createElement('canvas');
		c.width = 1600; c.height = Math.round((1600 * r.hoeheM) / r.breiteM);
		const klein = new Rahmen({ lon0: r.gitter.lon0, bbox: [r.x0, r.y0, r.x1, r.y1], pixelBreite: c.width, verhaeltnis: r.verhaeltnis });
		zeichneBlatt(c.getContext('2d')!, objekte, klein, {
			darstellung: 'schwarzplan', bereinigt: z.bereinigt, beschriftung: false,
			plangebiet: null, rahmenZeigen: false, sichtbar: z.sichtbar, hervorgehoben: null
		});
		bild = c.toDataURL('image/png');
	});

	const a = $derived(z.druck.ausschnitt);
	const masse = $derived(druckMasse(objekte, r, z.druck));
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
	const groesseFlaeche = $derived.by(() => {
		const s = r.breiteM / r.hoeheM;
		return pb / ph > s ? { b: ph * s, h: ph } : { b: pb, h: pb / s };
	});
	let zieht: null | { art: 'mitte' | 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; vorher: typeof a } = null;

	function runter(e: PointerEvent, art: 'mitte' | 'nw' | 'ne' | 'sw' | 'se') {
		e.stopPropagation();
		e.preventDefault();
		zieht = { art, x: e.clientX, y: e.clientY, vorher: { ...a } };
	}
	function bewegen(e: PointerEvent) {
		if (!zieht || !flaeche) return;
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

	/** Das Rechteck auf eine Größe in mm setzen, um seine Mitte (nur im Maßstab sinnvoll). */
	function groesse(bMm: number, hMm: number) {
		const k = 1000 / z.druck.massstab;
		const w = Math.min(1, Math.max(0.02, bMm / k / r.breiteM)), h = Math.min(1, Math.max(0.02, hMm / k / r.hoeheM));
		const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
		const x0 = Math.min(1 - w, Math.max(0, cx - w / 2)), y0 = Math.min(1 - h, Math.max(0, cy - h / 2));
		z.druck.ausschnitt = { x0, y0, x1: x0 + w, y1: y0 + h };
	}
	/** Pfeiltasten schieben das Rechteck, mit Umschalt in größeren Schritten. */
	function taste(e: KeyboardEvent) {
		const t = (e.target as HTMLElement | null)?.tagName;
		if (t === 'INPUT' || t === 'TEXTAREA') return;
		const d = e.shiftKey ? 0.05 : 0.01;
		const [dx, dy] = e.key === 'ArrowLeft' ? [-d, 0] : e.key === 'ArrowRight' ? [d, 0] : e.key === 'ArrowUp' ? [0, d] : e.key === 'ArrowDown' ? [0, -d] : [0, 0];
		if (!dx && !dy) return;
		e.preventDefault();
		const w = a.x1 - a.x0, h = a.y1 - a.y0;
		const x0 = Math.min(1 - w, Math.max(0, a.x0 + dx)), y0 = Math.min(1 - h, Math.max(0, a.y0 + dy));
		z.druck.ausschnitt = { x0, y0, x1: x0 + w, y1: y0 + h };
	}
	const ganz = $derived(a.x0 <= 0 && a.y0 <= 0 && a.x1 >= 1 && a.y1 >= 1);
</script>

<!-- Am Fenster, nicht am Griff: Mit Pointer Capture riss das Ziehen nach
     zwei Bewegungen ab (gemessen 05.11.2026). -->
<svelte:window onpointermove={bewegen} onpointerup={hoch} onpointercancel={hoch} onkeydown={taste} />

<div class="buehne-druck">
	<div class="platz" bind:this={platz}>
	<div class="flaeche" bind:this={flaeche} style:width="{groesseFlaeche.b}px" style:height="{groesseFlaeche.h}px" role="presentation">
		{#if bild}<img src={bild} alt="" />{/if}
		<div class="schleier"></div>
		<div class="auswahl" role="presentation"
			style:left="{a.x0 * 100}%" style:width="{(a.x1 - a.x0) * 100}%"
			style:top="{(1 - a.y1) * 100}%" style:height="{(a.y1 - a.y0) * 100}%"
			onpointerdown={(e) => runter(e, 'mitte')}>
			<span class="mass mono">{zahl(Math.round(masse.breiteMm))} × {zahl(Math.round(masse.hoeheMm))} mm · 1:{zahl(masse.massstab)}</span>
			{#each ['nw', 'ne', 'sw', 'se'] as ecke}
				<span class="griff {ecke}" role="presentation" onpointerdown={(e) => runter(e, ecke as 'nw')}></span>
			{/each}
		</div>
	</div>
	</div>
	<!-- Maßstab und Größe gehören zum Ausschnitt (Volker, 05.11.2026). -->
	<div class="tafel">
		<span class="unter">{t().ausgeben.druckGroesse}</span>
		<div class="wahl" role="group" aria-label={t().ausgeben.druckGroesse}>
			<button type="button" class:an={z.druck.groesse === 'bett'} aria-pressed={z.druck.groesse === 'bett'} onclick={() => (z.druck.groesse = 'bett')}>{t().ausgeben.druckBett}</button>
			<button type="button" class:an={z.druck.groesse === 'massstab'} aria-pressed={z.druck.groesse === 'massstab'} onclick={() => (z.druck.groesse = 'massstab')}>{t().ausgeben.druckMassstab}</button>
		</div>
		{#if z.druck.groesse === 'massstab'}
			<div class="wahl" role="group" aria-label={t().ausgeben.druckMassstab}>
				{#each [500, 1000, 2000, 5000] as m}
					<button type="button" class:an={z.druck.massstab === m} aria-pressed={z.druck.massstab === m}
						onclick={() => (z.druck.massstab = m)}>1:{zahl(m)}</button>
				{/each}
			</div>
		{/if}
		<label class="zeile">
			<span>{t().ausgeben.druckBettMm}</span>
			<input type="range" min="100" max="400" step="10" bind:value={z.druck.bettMm} />
			<em class="mono">{z.druck.bettMm} mm</em>
		</label>
		{#if z.druck.groesse === 'massstab'}
			<span class="unter">{t().ausgeben.druckRechteck}</span>
			<div class="masse">
				<label><span>{t().ausgeben.druckBreite}</span>
					<input type="number" min="10" step="5" value={Math.round(masse.breiteMm)}
						onchange={(e) => groesse(Number((e.currentTarget as HTMLInputElement).value), masse.hoeheMm)} /><em>mm</em></label>
				<label><span>{t().ausgeben.druckHoehe}</span>
					<input type="number" min="10" step="5" value={Math.round(masse.hoeheMm)}
						onchange={(e) => groesse(masse.breiteMm, Number((e.currentTarget as HTMLInputElement).value))} /><em>mm</em></label>
			</div>
			<div class="wahl">
				<button type="button" onclick={() => groesse(z.druck.bettMm, z.druck.bettMm)}>{t().ausgeben.druckAufsBett}</button>
				<button type="button" disabled={ganz} onclick={() => (z.druck.ausschnitt = { x0: 0, y0: 0, x1: 1, y1: 1 })}>{t().ausgeben.druckGanz}</button>
			</div>
		{:else}
			<div class="wahl">
				<button type="button" disabled={ganz} onclick={() => (z.druck.ausschnitt = { x0: 0, y0: 0, x1: 1, y1: 1 })}>{t().ausgeben.druckGanz}</button>
			</div>
		{/if}
		{#if masse.nx * masse.ny > 1}<p>{t().ausgeben.druckKacheln(masse.nx, masse.ny)}</p>{/if}
	</div>
	<p class="wink">{t().ausgeben.druckAusschnittWink}</p>
</div>

<style>
	.buehne-druck { position: absolute; inset: 0; z-index: 1; background: var(--grund, #eaeae9); }
	/* Links Platz für das Druckfenster, rechts für die Tafel: Der Plan liegt dazwischen. */
	.platz { position: absolute; inset: 28px 290px 56px 344px; display: grid; place-items: center; }
	.flaeche { position: relative; touch-action: none; user-select: none; }
	img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
	.schleier { position: absolute; inset: 0; background: rgb(0 0 0 / 0.08); pointer-events: none; }
	.auswahl {
		position: absolute; border: 2px solid var(--akzent); cursor: move;
		box-shadow: 0 0 0 9999px rgb(255 255 255 / 0.55);
	}
	.mass {
		position: absolute; left: 6px; top: 6px; font-size: 11px; padding: 2px 6px;
		background: var(--blatt); color: var(--tinte); border-radius: 2px; pointer-events: none;
	}
	.griff {
		position: absolute; width: 12px; height: 12px; background: var(--blatt);
		border: 2px solid var(--akzent); border-radius: 2px;
	}
	.nw { left: -7px; top: -7px; cursor: nwse-resize; }
	.ne { right: -7px; top: -7px; cursor: nesw-resize; }
	.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
	.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
	.tafel {
		/* Rechts oben: links steht das Druckfenster. */
		position: absolute; right: 18px; top: 18px; z-index: 2; width: 248px;
		display: grid; gap: 7px; padding: 12px;
		background: var(--blatt); border: 1px solid var(--linie); border-radius: var(--rund); box-shadow: var(--heben);
		font-size: 12px; color: var(--tinte-2);
	}
	.tafel .unter { font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--tinte-3); }
	.tafel .wahl { display: flex; gap: 4px; flex-wrap: wrap; }
	.tafel .wahl button {
		flex: 1; padding: 5px 6px; font: inherit; font-size: 11.5px; cursor: pointer;
		background: var(--blatt); color: var(--tinte); border: 1px solid var(--linie); border-radius: var(--rund);
	}
	.tafel .wahl button.an { background: var(--tinte); color: var(--blatt); border-color: var(--tinte); }
	.tafel .wahl button:disabled { opacity: 0.42; cursor: default; }
	.tafel .zeile { display: grid; grid-template-columns: 74px 1fr 52px; align-items: center; gap: 6px; }
	.tafel .zeile input { width: 100%; accent-color: var(--tinte); }
	.tafel .zeile em { font-style: normal; font-size: 11px; text-align: right; color: var(--tinte); }
	.tafel .masse { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.tafel .masse label { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 4px; }
	.tafel .masse input { width: 100%; min-width: 0; padding: 3px 4px; font: inherit; border: 1px solid var(--linie); border-radius: var(--rund); background: var(--blatt); color: var(--tinte); }
	.tafel .masse em { font-style: normal; font-size: 11px; }
	.tafel p { margin: 0; font-size: 11px; color: var(--tinte-3); }
	.wink {
		position: absolute; right: 18px; bottom: 18px; margin: 0; font-size: 11px; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie); padding: 3px 8px; border-radius: 2px;
	}
</style>
