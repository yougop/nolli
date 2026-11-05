<script lang="ts">
	import * as THREE from 'three';
	import { untrack } from 'svelte';
	import { z } from '$lib/zustand.svelte';
	import { t } from '$lib/sprache.svelte';
	import type { Rahmen } from '$lib/geo/rahmen';
	import type { Objekt } from '$lib/osm';
	import { ohneSchnitte } from '$lib/export/druck';

	/**
	 * Die Vorschau des Druckmodells (Volker, 05.11.2026): alle Kacheln des
	 * Ausschnitts, so wie sie in die Dateien gehen, in Millimetern, groß auf der Bühne statt
	 * der Ansicht. Ziehen dreht, das Rad zoomt. Neu gerechnet wird erst, wenn die Einstellungen eine Viertel-
	 * sekunde ruhen; ein großer Ausschnitt braucht dafür einen Moment.
	 *
	 * Mehrfarbig zeigt Platte, Häuser, Straßen und Grün in vier Tönen — so
	 * viele Spulen fasst das AMS der Bambu X1 Carbon —, einfarbig alles in
	 * einem: so, wie es aus dem Drucker käme.
	 */
	let { objekte, r }: { objekte: Objekt[]; r: Rahmen } = $props();

	let leinwand = $state<HTMLCanvasElement | null>(null);
	let rechnet = $state(false);
	let renderer: THREE.WebGLRenderer | null = null;
	const szene = new THREE.Scene();
	const kamera = new THREE.PerspectiveCamera(30, 1.5, 1, 20000);
	// Härter als im 3D-Modell: Einfarbig zeigt nur das Licht, ob die Straßen erhaben sind.
	szene.add(new THREE.HemisphereLight(0xe0e8f2, 0xfbf8ef, 0.7));
	const sonne = new THREE.DirectionalLight(0xffffff, 3);
	sonne.position.set(-1, -0.6, 0.8);
	szene.add(sonne);
	const gruppe = new THREE.Group();
	szene.add(gruppe);
	let winkel = -0.6, neigung = 0.75, abstand = 1, mitte = new THREE.Vector3(), weite = 200;
	let eingepasst = '';

	const FARBEN = { platte: 0xcfcdc7, haeuser: 0xf4f3ef, strassen: 0x5f5f5c, gruen: 0x8aa874, klein: 0xd2453a };

	function netz(q: number[], farbe: number) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ohneSchnitte(q)), 3));
		g.computeVertexNormals();
		return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: farbe }));
	}

	function zeichnen() {
		if (!renderer || !leinwand) return;
		const b = leinwand.clientWidth, h = leinwand.clientHeight;
		renderer.setSize(b, h, false);
		kamera.aspect = b / Math.max(1, h);
		const d = weite * 2.1 * abstand;
		kamera.position.set(
			mitte.x + d * Math.cos(neigung) * Math.sin(winkel),
			mitte.y - d * Math.cos(neigung) * Math.cos(winkel),
			mitte.z + d * Math.sin(neigung)
		);
		kamera.up.set(0, 0, 1);
		kamera.lookAt(mitte);
		kamera.updateProjectionMatrix();
		renderer.render(szene, kamera);
	}

	async function rechnen() {
		rechnet = true;
		await new Promise((f) => setTimeout(f, 30));
		try {
			const { druckModell } = await import('$lib/export/druck');
			const { kacheln } = druckModell(objekte, r, z.gelaendeJetzt, $state.snapshot(z.druck));
			gruppe.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
			gruppe.clear();
			const ein = z.druck.farben === 'ein';
			// Alle Kacheln an ihrer Stelle, mit einer Fuge von 3 mm: So zeigt die
			// Vorschau den ganzen Ausschnitt und sieht man, wo geteilt wird. Bis
			// 05.11.2026 zeigte sie nur die erste Kachel (Volker: passte nicht zum Ausschnitt).
			const FUGE = kacheln.length > 1 ? 3 : 0;
			for (const k of kacheln) {
				const teil = new THREE.Group();
				teil.add(netz(k.platte, ein ? FARBEN.haeuser : FARBEN.platte));
				if (k.haeuser.length) teil.add(netz(k.haeuser, FARBEN.haeuser));
				// Zu kleine Teile rot, damit man sieht, was nicht sauber druckt.
				if (k.kleine.length) teil.add(netz(k.kleine, FARBEN.klein));
				if (k.strassen.length) teil.add(netz(k.strassen, ein ? FARBEN.haeuser : FARBEN.strassen));
				if (k.gruen.length) teil.add(netz(k.gruen, ein ? FARBEN.haeuser : FARBEN.gruen));
				teil.position.set(k.i * (k.bMm + FUGE), k.j * (k.hMm + FUGE), 0);
				gruppe.add(teil);
			}
			// Neu einpassen nur, wenn sich zeigt, was zu sehen ist: Ausschnitt
			// und Maßstab. Sonst sprang das Bild bei jeder Einstellung, etwa der
			// Plattendicke, und Schieben und Zoomen gingen verloren (Volker, 05.11.2026).
			const d = z.druck, schluessel = JSON.stringify([d.ausschnitt, d.groesse, d.massstab, d.bettMm, r.x0, r.y0, r.x1, r.y1]);
			if (schluessel !== eingepasst) {
				eingepasst = schluessel;
				const box = new THREE.Box3().setFromObject(gruppe);
				box.getCenter(mitte);
				mitte.z = 0;
				weite = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
				abstand = 1;
			}
			zeichnen();
		} finally {
			rechnet = false;
		}
	}

	$effect(() => {
		const el = leinwand;
		if (!el) return;
		renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
		const beob = new ResizeObserver(() => zeichnen());
		beob.observe(el);
		return () => { beob.disconnect(); renderer?.dispose(); renderer = null; };
	});

	let takt: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// Neu rechnen, wenn sich Einstellungen, Daten oder Gelände ändern.
		JSON.stringify(z.druck); objekte; r; z.gelaendeJetzt;
		clearTimeout(takt);
		takt = setTimeout(() => untrack(rechnen), 250);
		return () => clearTimeout(takt);
	});

	/**
	 * Bedienung wie im 3D-Modell: links ziehen dreht, rechts oder mit Umschalt
	 * schiebt, das Rad zoomt (Volker, 05.11.2026: Schieben fehlte). Am Fenster
	 * verfolgt, damit das Ziehen nicht abreißt, wenn die Maus die Bühne verlässt.
	 */
	let zieht: { art: 'drehen' | 'schieben'; x: number; y: number; w: number; n: number; m: THREE.Vector3 } | null = null;
	const runter = (e: PointerEvent) => {
		e.preventDefault();
		zieht = { art: e.button === 2 || e.shiftKey ? 'schieben' : 'drehen', x: e.clientX, y: e.clientY, w: winkel, n: neigung, m: mitte.clone() };
	};
	const bewegen = (e: PointerEvent) => {
		if (!zieht || !leinwand) return;
		const dx = e.clientX - zieht.x, dy = e.clientY - zieht.y;
		if (zieht.art === 'drehen') {
			winkel = zieht.w - dx * 0.008;
			neigung = Math.min(1.5, Math.max(0.1, zieht.n + dy * 0.006));
		} else {
			// Auf der Platte schieben: ein Bildpunkt so viele mm, wie die Ansicht breit ist.
			const mmJePx = (weite * 2.1 * abstand * 0.55) / Math.max(1, leinwand.clientHeight);
			const rx = Math.cos(winkel), ry = Math.sin(winkel);   // rechts in der Ansicht
			const vx = -Math.sin(winkel), vy = Math.cos(winkel);  // nach hinten
			mitte.set(zieht.m.x - (dx * rx - dy * vx) * mmJePx, zieht.m.y - (dx * ry - dy * vy) * mmJePx, zieht.m.z);
		}
		zeichnen();
	};
	const hoch = () => (zieht = null);
	const taste = (e: KeyboardEvent) => {
		const s = e.shiftKey ? 0.3 : 0.1;
		if (e.key === 'ArrowLeft') winkel -= s; else if (e.key === 'ArrowRight') winkel += s;
		else if (e.key === 'ArrowUp') neigung = Math.min(1.5, neigung + s); else if (e.key === 'ArrowDown') neigung = Math.max(0.1, neigung - s);
		else if (e.key === '+' || e.key === '=') abstand = Math.max(0.2, abstand * 0.9); else if (e.key === '-') abstand = Math.min(3, abstand * 1.1);
		else return;
		e.preventDefault(); zeichnen();
	};
	const rad = (e: WheelEvent) => { e.preventDefault(); abstand = Math.min(3, Math.max(0.2, abstand * (e.deltaY > 0 ? 1.1 : 0.9))); zeichnen(); };
</script>

<svelte:window onpointermove={bewegen} onpointerup={hoch} onpointercancel={hoch} />

<div class="vorschau">
	<!-- Pfeiltasten drehen und kippen, +/− zoomen, damit die Vorschau auch ohne Maus geht. -->
	<canvas bind:this={leinwand} tabindex="0" onpointerdown={runter} onwheel={rad} onkeydown={taste}
		oncontextmenu={(e) => e.preventDefault()}
		aria-label={t().ausgeben.druckVorschau}></canvas>
	<p class="wink">{t().raum.wink}</p>
	{#if rechnet}<span class="mono">{t().ausgeben.druckRechnet}</span>{/if}
</div>

<style>
	.vorschau { position: absolute; inset: 0; z-index: 1; background: var(--grund, #eaeae9); }
	canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
	canvas:active { cursor: grabbing; }
	.wink {
		position: absolute; right: 18px; bottom: 18px; margin: 0; font-size: 11px; color: var(--tinte-2);
		background: var(--blatt); border: 1px solid var(--linie); padding: 3px 8px; border-radius: 2px;
	}
	span {
		position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 10.5px; color: var(--tinte-2);
		background: var(--blatt); padding: 2px 6px; border-radius: 2px;
	}
</style>
