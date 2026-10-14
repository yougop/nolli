<script lang="ts">
	import { t } from '$lib/sprache.svelte';
	import { Map as Karte, NavigationControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre sucht seinen Arbeiter ueber `import.meta.url` neben sich selbst.
	// Im gebuendelten Stand liegt er dort nicht, und die Karte bleibt leer, weil
	// die Kacheln in genau diesem Arbeiter zerlegt werden. Also wird er hier
	// ausdruecklich mitgebuendelt und die Adresse gesetzt.
	import arbeiterUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	setWorkerUrl(arbeiterUrl);
	import { onMount, onDestroy } from 'svelte';
	import { z } from '$lib/zustand.svelte';
	import { nachGitter, nachGrad, ortsgitter } from '$lib/geo/utm';

	let { schema = 'hell' }: { schema?: 'hell' | 'dunkel' } = $props();

	/** Womit das Werkzeug aufmacht. HafenCity, weil dort gearbeitet wird. */
	const STARTORT = {
		name: 'HafenCity', wo: 'Hamburg',
		lon: 10.0049, lat: 53.5403, bbox: null
	};

	let huelle = $state<HTMLDivElement | null>(null);
	let karte: Karte | null = null;
	let bereit = $state(false);
	let armiert = $state(false);
	let rahmenSichtbar = $state(true);
	let takt = $state(0); // zwingt Neuberechnung der Ecken bei Kartenbewegung
	let zieht = $state<null | { art: 'neu' | 'schieben' | 'ecke'; ecke?: number; ax: number; ay: number; start?: typeof z.kasten }>(null);

	/**
	 * OpenFreeMap. Kostenlos, ohne Schluessel, und die Kacheln stammen aus
	 * denselben OSM-Daten wie unser Plan.
	 *
	 * Der fertige Stil bringt blaues Wasser und gruene Parks mit. Das
	 * widerspricht der Grauleiter, in der dieses Werkzeug arbeitet, also
	 * wird jede Farbe im Stil auf ihren Grauwert gezogen, bevor die Karte
	 * ihn bekommt. Der Akzent bleibt damit allein dem Rahmen vorbehalten.
	 */
	const QUELLE = (dunkel: boolean) =>
		`https://tiles.openfreemap.org/styles/${dunkel ? 'dark' : 'positron'}`;

	/**
	 * Rueckfallebene ohne Kartenbild.
	 *
	 * OpenFreeMap ist ein Geschenk der Allgemeinheit und entsprechend manchmal
	 * langsam oder gar nicht da. Frueher sprangen hier die Rasterkacheln von
	 * openstreetmap.org ein. Deren Nutzungsregeln verbieten aber ausdruecklich,
	 * sie als Kartenebene in eine Webseite einzubinden, und Nolli steht
	 * oeffentlich. Also bleibt der Grund leer und sagt das auch.
	 *
	 * Verloren geht dabei nichts ausser dem Bild: Rechteck, Gitter und Abfrage
	 * rechnen in Meter und brauchen keine Kachel.
	 */
	const NOTSTIL = (dunkel: boolean): StyleSpecification => ({
		version: 8,
		sources: {},
		layers: [{
			id: 'leer', type: 'background',
			paint: { 'background-color': dunkel ? '#1A1A1A' : '#E8E8E6' }
		}]
	});

	const stileGemerkt = new Map<string, unknown>();
	const GEDULD_MS = 7000;

	async function stil(dunkel: boolean) {
		const url = QUELLE(dunkel);
		if (stileGemerkt.has(url)) { z.kartenquelle = 'openfreemap'; return stileGemerkt.get(url); }
		try {
			const ab = new AbortController();
			const uhr = setTimeout(() => ab.abort(), GEDULD_MS);
			const a = await fetch(url, { signal: ab.signal });
			clearTimeout(uhr);
			if (!a.ok) throw new Error(String(a.status));
			const s = await a.json();
			entfaerben(s, dunkel);
			stileGemerkt.set(url, s);
			z.kartenquelle = 'openfreemap';
			return s;
		} catch {
			z.kartenquelle = 'ohne';
			return NOTSTIL(dunkel);
		}
	}

	/** Jede Farbe im Stil auf ihren Grauwert ziehen, Deckung bleibt. */
	function entfaerben(wert: unknown, dunkel: boolean, tiefe = 0): void {
		if (tiefe > 24 || wert === null || typeof wert !== 'object') return;
		for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
			if (typeof v === 'string') {
				const g = grauWert(v, dunkel);
				if (g) (wert as Record<string, unknown>)[k] = g;
			} else entfaerben(v, dunkel, tiefe + 1);
		}
	}

	/**
	 * Im dunklen Stil liegen Grund und Zeichnung eng beieinander. Nach dem
	 * Entfaerben faellt der Unterschied fast weg, und man erkennt nichts mehr.
	 * Deshalb wird der Abstand zum Grund gespreizt: Der Grund bleibt dunkel,
	 * alles darueber ruecken wir deutlich nach oben.
	 */
	const GRUND_DUNKEL = 14;
	const SPREIZUNG = 2.4;
	const spreizen = (y: number) =>
		Math.max(0, Math.min(255, Math.round(GRUND_DUNKEL + (y - GRUND_DUNKEL) * SPREIZUNG)));

	function grauWert(s: string, dunkel: boolean): string | null {
		let r: number, g: number, b: number, a = 1;
		const h = s.trim();
		const kurz = /^#([0-9a-f]{3})$/i.exec(h);
		const lang = /^#([0-9a-f]{6})$/i.exec(h);
		const funk = /^rgba?\(([^)]+)\)$/i.exec(h);
		if (kurz) {
			[r, g, b] = [...kurz[1]].map((c) => parseInt(c + c, 16));
		} else if (lang) {
			const n = parseInt(lang[1], 16);
			[r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		} else if (funk) {
			const p = funk[1].split(',').map((x) => parseFloat(x));
			if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
			[r, g, b] = p as [number, number, number];
			if (p.length > 3) a = p[3];
		} else return null;
		// Wahrnehmungsgewichtet, sonst wird Blau zu dunkel und Gruen zu hell
		let y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
		if (dunkel) y = spreizen(y);
		return a < 1 ? `rgba(${y},${y},${y},${a})` : `rgb(${y},${y},${y})`;
	}

	onMount(() => {
		karte = new Karte({
			container: huelle!,
			style: { version: 8, sources: {}, layers: [] },
			center: [STARTORT.lon, STARTORT.lat],
			zoom: 13.2,
			attributionControl: false
		});
		karte.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
		stil(schema === 'dunkel').then((s) => karte?.setStyle(s as never));
		karte.on('style.load', async () => {
			bereit = true;
			// Erst nachsehen, ob aus der letzten Sitzung ein Rahmen vorliegt.
			// Ohne dieses Warten setzt der Startort ihn ueberholend zurueck.
			await z.bereit;
			// Arbeitsbereit oeffnen: ein Rahmen ueber der HafenCity steht schon da.
			if (!z.kasten) {
				z.ort = STARTORT;
				z.rahmenUmOrt(STARTORT);
			}
			einpassen();
		});
		karte.on('move', () => takt++);
		karte.on('error', (e) => console.error('Karte:', e?.error?.message ?? e));
		karte.on('resize', () => takt++);
		return () => karte?.remove();
	});

	export function fliegeZu(lon: number, lat: number, bbox: number[] | null) {
		if (!karte) return;
		if (bbox && bbox.length === 4) karte.fitBounds([[bbox[0], bbox[3]], [bbox[2], bbox[1]]], { padding: 90, duration: 900 });
		else karte.flyTo({ center: [lon, lat], zoom: 14, duration: 900 });
	}

	/** Die vier Rahmenecken in Bildschirmkoordinaten. */
	const ecken = $derived.by(() => {
		takt;
		const k = z.kasten;
		if (!k || !karte || !bereit) return null;
		const gi = ortsgitter(k.lon0);
		return ([[k.x0, k.y1], [k.x1, k.y1], [k.x1, k.y0], [k.x0, k.y0]] as [number, number][]).map(([x, y]) => {
			const g = nachGrad(x, y, gi);
			const p = karte!.project([g.lon, g.lat]);
			return [p.x, p.y] as [number, number];
		});
	});

	/**
	 * Zeigerposition im Ortsgitter. Liegt schon ein Kasten vor, wird dessen
	 * Gitter weiterbenutzt; sonst wird am Zeiger ein neues aufgespannt.
	 */
	function gitterVonZeiger(e: PointerEvent): { x: number; y: number; lon0: number } {
		const r = huelle!.getBoundingClientRect();
		const g = karte!.unproject([e.clientX - r.left, e.clientY - r.top]);
		const gi = ortsgitter(z.kasten ? z.kasten.lon0 : g.lng);
		const p = nachGitter(g.lng, g.lat, gi);
		return { x: p.x, y: p.y, lon0: gi.lon0 };
	}

	function runter(e: PointerEvent, art: 'neu' | 'schieben' | 'ecke', ecke?: number) {
		if (e.button !== 0) return;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		const p = gitterVonZeiger(e);
		if (art === 'ecke' && z.kasten) {
			const k = z.kasten;
			const gegen: [number, number][] = [[k.x1, k.y0], [k.x0, k.y0], [k.x0, k.y1], [k.x1, k.y1]];
			zieht = { art, ecke, ax: gegen[ecke!][0], ay: gegen[ecke!][1] };
		} else {
			zieht = { art, ax: p.x, ay: p.y, start: z.kasten ? { ...z.kasten } : null };
		}
		e.stopPropagation();
		e.preventDefault();
	}

	function bewegen(e: PointerEvent) {
		if (!zieht) return;
		const p = gitterVonZeiger(e);
		if (zieht.art === 'schieben' && zieht.start) {
			const s = zieht.start;
			const dx = p.x - zieht.ax, dy = p.y - zieht.ay;
			z.kasten = { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy };
		} else {
			z.setzeKasten(zieht.ax, zieht.ay, p.x, p.y, p.lon0);
		}
		e.stopPropagation();
	}

	function hoch(e: PointerEvent) {
		if (!zieht) return;
		if (zieht.art === 'neu') armiert = false;
		zieht = null;
		try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
	}

	/** Den Rahmen ins Bild holen, mit Luft ringsum. */
	export function einpassen() {
		const k = z.kasten;
		if (!k || !karte) return;
		const gi = ortsgitter(k.lon0);
		const a = nachGrad(k.x0, k.y0, gi), b = nachGrad(k.x1, k.y1, gi);
		karte.fitBounds([[a.lon, a.lat], [b.lon, b.lat]], { padding: 76, duration: 700 });
	}

	/**
	 * Ueber dem Rechteck und seinen Griffen faengt die Auflage die Ereignisse
	 * ab, damit man schieben und ziehen kann. Das Mausrad soll aber weiterhin
	 * die Karte zoomen, also wird es durchgereicht.
	 */
	function radWeiter(e: WheelEvent) {
		const ziel = karte?.getCanvas();
		if (!ziel) return;
		e.preventDefault();
		ziel.dispatchEvent(new WheelEvent('wheel', {
			deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,
			clientX: e.clientX, clientY: e.clientY,
			bubbles: true, cancelable: true
		}));
	}

	$effect(() => {
		const d = schema === 'dunkel';
		if (karte && bereit) stil(d).then((s) => karte?.setStyle(s as never));
	});
</script>

<div class="karte" bind:this={huelle}></div>

<svg
	class="lage"
	class:armiert
	onpointerdown={(e) => armiert && runter(e, 'neu')}
	onpointermove={bewegen}
	onpointerup={hoch}
	onpointercancel={hoch}
	onwheel={radWeiter}
	role="presentation"
>
	{#if ecken && rahmenSichtbar}
		{@const d = ecken.map((p) => p.join(',')).join(' ')}
		<path class="schleier" d="M0,0 H4000 V4000 H0 Z M{ecken.map((p) => p.join(' ')).join(' L')} Z" fill-rule="evenodd" />
		<polygon class="rahmen" points={d} />
		<polygon
			class="griff-flaeche"
			points={d}
			onpointerdown={(e) => runter(e, 'schieben')}
			role="presentation"
		/>
		{#each ecken as [x, y], i}
			<rect
				class="griff"
				x={x - 6} y={y - 6} width="12" height="12"
				onpointerdown={(e) => runter(e, 'ecke', i)}
				role="presentation"
			/>
		{/each}
		<line class="kreuz" x1={ecken[0][0]} y1={(ecken[0][1] + ecken[3][1]) / 2} x2={ecken[1][0]} y2={(ecken[1][1] + ecken[2][1]) / 2} />
		<line class="kreuz" x1={(ecken[0][0] + ecken[1][0]) / 2} y1={ecken[0][1]} x2={(ecken[3][0] + ecken[2][0]) / 2} y2={ecken[3][1]} />

		<!-- Nordpfeil. Weil das Gitter am Plangebiet aufgespannt ist, faellt
		     Gitternord mit geographisch Nord zusammen; der Pfeil steht senkrecht
		     und die Rahmenkante ist parallel dazu. Er wird trotzdem aus den
		     Rahmenecken berechnet und nicht fest gesetzt, damit eine Abweichung
		     sichtbar wuerde, statt verdeckt zu bleiben. -->
		{@const nx = ecken[0][0] - ecken[3][0]}
		{@const ny = ecken[0][1] - ecken[3][1]}
		{@const dreh = (Math.atan2(nx, -ny) * 180) / Math.PI}
		<g class="nord" transform="translate(56 86)">
			<rect x="-34" y="-46" width="68" height="92" rx="3" />
			<g transform="rotate({dreh})">
				<line x1="0" y1="22" x2="0" y2="-24" />
				<path d="M0,-30 L5.5,-17 L0,-21.5 L-5.5,-17 Z" />
			</g>
			<text x="0" y="38">{t().karte.nord}</text>
		</g>
	{/if}
</svg>

{#if z.kartenquelle !== 'openfreemap'}
	<p class="quelle" class:wartet={z.kartenquelle === 'lade'}>
		{#if z.kartenquelle === 'lade'}
			{t().karte.laedt}
		{:else}
			{t().karte.keinBild}
		{/if}
	</p>
{/if}

<div class="werkzeuge">
	{#if armiert}
		<p class="wink">{t().karte.ziehen}</p>
	{:else}
		<button type="button" onclick={() => (armiert = true)}>{t().karte.neu}</button>
		{#if z.kasten}
			<button type="button" onclick={einpassen}>{t().karte.einpassen}</button>
			<button type="button" class:aus={!rahmenSichtbar}
				onclick={() => (rahmenSichtbar = !rahmenSichtbar)}
			>{rahmenSichtbar ? t().karte.ausblenden : t().karte.einblenden}</button>
		{/if}
	{/if}
</div>

<style>
	.karte { position: absolute; inset: 0; }
	.lage { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.lage.armiert { pointer-events: auto; cursor: crosshair; }

	.schleier { fill: rgba(15, 17, 19, 0.34); pointer-events: none; }
	.rahmen { fill: none; stroke: var(--akzent); stroke-width: 2; pointer-events: none; }
	.kreuz { stroke: var(--akzent); stroke-width: 1; stroke-dasharray: 3 5; opacity: 0.55; pointer-events: none; }
	.griff-flaeche { fill: transparent; pointer-events: auto; cursor: grab; }
	.griff-flaeche:active { cursor: grabbing; }
	.griff {
		fill: var(--blatt); stroke: var(--akzent); stroke-width: 2;
		pointer-events: auto; cursor: nwse-resize;
	}

	.nord { pointer-events: none; }
	.nord rect { fill: var(--blatt); stroke: var(--linie); stroke-width: 1; }
	.nord line { stroke: var(--tinte); stroke-width: 1.5; }
	.nord path { fill: var(--tinte); }
	.nord text {
		fill: var(--tinte-2); font-size: 9px; font-weight: 500;
		letter-spacing: 0.06em; text-anchor: middle; font-family: var(--schrift);
	}

	.quelle {
		position: absolute; right: 16px; top: 16px; z-index: 2;
		max-width: 42ch; margin: 0; padding: 9px 12px;
		font-size: 12px; line-height: 1.45; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie);
		border-radius: var(--rund); box-shadow: var(--heben-klein);
	}
	.quelle.wartet { color: var(--tinte-3); }

	.werkzeuge {
		position: absolute; left: 16px; bottom: 16px; z-index: 2;
		display: flex; gap: 6px;
	}
	.werkzeuge > * {
		font-size: 12px; font-weight: 500;
		padding: 7px 12px; margin: 0;
		background: var(--blatt); color: var(--tinte);
		border: 1px solid var(--linie); border-radius: var(--rund);
		box-shadow: var(--heben-klein);
	}
	.werkzeuge button { cursor: pointer; transition: border-color 120ms; }
	.werkzeuge button:hover { border-color: var(--linie-stark); }
	.werkzeuge button.aus { color: var(--tinte-3); }
	.wink { pointer-events: none; color: var(--tinte-2); }

	:global(.maplibregl-ctrl-group) {
		border: 1px solid var(--linie) !important;
		box-shadow: var(--heben-klein) !important;
		background: var(--blatt) !important;
	}
	:global(.maplibregl-ctrl-group button + button) { border-top: 1px solid var(--linie) !important; }
</style>
