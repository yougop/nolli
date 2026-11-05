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
</script>

<!-- Am Fenster, nicht am Griff: Mit Pointer Capture riss das Ziehen nach
     zwei Bewegungen ab (gemessen 05.11.2026). -->
<svelte:window onpointermove={bewegen} onpointerup={hoch} onpointercancel={hoch} />

<div class="buehne-druck">
	<div class="flaeche" bind:this={flaeche} style:aspect-ratio="{r.breiteM} / {r.hoeheM}" role="presentation">
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
	<p class="wink">{t().ausgeben.druckAusschnittWink}</p>
</div>

<style>
	.buehne-druck {
		position: absolute; inset: 0; z-index: 1; display: grid; place-items: center;
		padding: 28px 28px 56px; background: var(--grund, #eaeae9);
	}
	.flaeche {
		position: relative; max-width: 100%; max-height: 100%; width: 100%; height: auto;
		touch-action: none; user-select: none;
	}
	@supports (aspect-ratio: 1) { .flaeche { width: auto; height: 100%; } }
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
	.wink {
		position: absolute; right: 18px; bottom: 18px; margin: 0; font-size: 11px; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie); padding: 3px 8px; border-radius: 2px;
	}
</style>
