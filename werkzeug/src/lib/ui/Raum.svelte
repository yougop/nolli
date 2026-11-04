<script lang="ts">
	import { t } from '$lib/sprache.svelte';
	import * as THREE from 'three';
	import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
	import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
	import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
	import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
	import { z } from '$lib/zustand.svelte';
	import { sichtEbene } from '$lib/osm';
	import { Rahmen, BILDFORMATE } from '$lib/geo/rahmen';
	import { zeichneBlatt } from '$lib/zeichnen';
	import { baukoerper, baukanten, hoechstes } from '$lib/raum';
	import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
	import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
	import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
	import { feldImRahmen, tiefsteUnter, hoeheBei } from '$lib/geo/gelaende';
	import { BAUM } from '$lib/analysedaten';
	import type { StiftId } from '$lib/stifte';
	import { KARTE_GLSL } from '$lib/anpassen';

	let huelle = $state<HTMLDivElement | null>(null);
	let breite = $state(900), hoehe = $state(600);

	let renderer: THREE.WebGLRenderer | null = null;
	let composer: EffectComposer | null = null;
	let gtao: GTAOPass | null = null;
	let szene: THREE.Scene | null = null;
	let kamera: THREE.PerspectiveCamera | null = null;
	const geloescht: THREE.Object3D[] = [];

	/** Ausgangsblick: leicht von links, gut ein Drittel Neigung. */
	const ANSICHT_W = -0.85;
	const ANSICHT_N = 0.72;

	/** Kamerastand in Kugelkoordinaten um die Rahmenmitte. */
	let winkel = $state(ANSICHT_W);
	let neigung = $state(ANSICHT_N);
	let abstand = $state(1);
	let versatz = $state({ x: 0, z: 0 });
	export function zuruecksetzen() {
		winkel = ANSICHT_W; neigung = ANSICHT_N; abstand = 1; versatz = { x: 0, z: 0 };
	}

	/**
	 * `seite`: Höhe durch Breite der Ansicht, nach außen gereicht. Das 3D-Bild
	 * hat dieses Seitenverhältnis, nicht das des Rahmens — sonst zeigte es
	 * einen anderen Ausschnitt als die Ansicht (Volker, 04.11.2026).
	 */
	let { schema = 'hell', seite = $bindable(0.75) }: { schema?: 'hell' | 'dunkel'; seite?: number } = $props();

	/**
	 * Der Grund der Buehne, neutral gehalten.
	 *
	 * Am 15.09.2026 nachgemessen: Der Modellbereich lag im Mittel bei R 193,
	 * G 191, B 185 — Farbton 49 Grad, also beige. Das kam nicht aus dem
	 * Bodenbild, sondern aus dem Licht: Die Sonne stand auf 0xfff4e2, also
	 * 29 Stufen Rot ueber Blau. Sonne, Koerperfarben und dieser Grund sind
	 * jetzt neutral; die Farbe im Bild soll aus dem Bodenbild kommen, wo sie
	 * gewaehlt ist, und nicht aus der Beleuchtung, wo sie nur passiert.
	 */
	const GRUND = { hell: 0xeaeae9, dunkel: 0x1c1c1c };

	/**
	 * Der Grund hinter dem Modell: nach Schema, oder die gewählte Farbe, oder
	 * durchsichtig (Volker, 04.11.2026). Durchsichtig heißt kein Hintergrund und
	 * ein klarer Alphakanal; das PNG trägt ihn mit.
	 */
	function hintergrund() {
		if (!szene || !renderer) return;
		/**
		 * Eine eigene Farbe liegt nicht in der Szene, sondern darunter: in der
		 * Ansicht als Grund der Hülle, im Bild als Fläche unter dem Render. In der
		 * Szene liefe sie durch die Tonwertanpassung, und aus #ff8800 wurde
		 * (238, 159, 36). So kommt sie an, wie gewählt.
		 */
		const eigen = z.bild3d.transparent || !!z.bild3d.hintergrund;
		szene.background = eigen ? null : new THREE.Color(GRUND[schema]);
		renderer.setClearColor(0x000000, eigen ? 0 : 1);
		if (huelle) huelle.style.background = z.bild3d.transparent
			? 'repeating-conic-gradient(#d8d8d8 0 25%, #f4f4f4 0 50%) 0 0 / 16px 16px'
			: (z.bild3d.hintergrund ?? '');
	}

	/**
	 * Kronenfarbe, je Schema eine. Abgestimmt mit der Umbra-Sitzung, damit ein
	 * Baum in der ganzen Kette derselbe Gegenstand ist.
	 */
	const KRONE = { hell: 0x4f7f4a, dunkel: 0x6ea368 };

	/**
	 * Der Grund folgt dem Schema der Oberflaeche.
	 *
	 * Eine helle Buehne in einer dunklen Oberflaeche ist ein Loch im Blatt, und
	 * umgekehrt. Das Modell selbst bleibt in beiden Faellen gleich beleuchtet:
	 * Ein Weissmodell wird nicht dunkel, nur weil der Raum dunkel ist.
	 */
	$effect(() => {
		schema; z.bild3d.hintergrund; z.bild3d.transparent;
		if (!szene) return;
		hintergrund();
		anfordern();
	});

	/**
	 * Aufbau ohne beobachteten Zustand.
	 *
	 * Die Größe kommt als Zahl herein, nicht aus `breite` und `hoehe`. Las der
	 * Aufbau sie als Zustand, während `messen()` sie im selben Effekt schrieb,
	 * riss der Effekt sich selbst immer wieder ab und baute neu auf. Zurück
	 * blieb bei jedem Durchgang eine verwaiste Leinwand.
	 */
	function aufbauen(el: HTMLDivElement, b: number, h: number) {
		if (renderer) return;
		// Mit Alphakanal, damit das 3D-Bild auf Wunsch einen durchsichtigen Grund hat.
		renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
		renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1;
		el.appendChild(renderer.domElement);
		renderer.domElement.style.display = 'block';

		szene = new THREE.Scene();
		hintergrund();
		kamera = new THREE.PerspectiveCamera(38, 1, 1, 20000);

		/**
		 * Drei Lichter, wie bei einem fotografierten Arbeitsmodell.
		 *
		 * Grundlicht hebt alles gleichmäßig an, die Sonne von Nordwesten setzt
		 * die Plastik und wirft den Schlagschatten, ein schwaches Gegenlicht
		 * verhindert, dass abgewandte Wände zu einer Fläche verschmelzen.
		 *
		 * Das Verhältnis ist absichtlich etwa drei zu zwei zwischen besonnter
		 * und beschatteter Seite. Weiter auseinander und die Nordseiten saufen
		 * ab, enger und das Modell wird flach.
		 */
		const grundlicht = new THREE.AmbientLight(0xffffff, 0.62);
		const sonne = new THREE.DirectionalLight(0xfffcf7, 2.0);
		sonne.castShadow = true;
		sonne.shadow.mapSize.set(2048, 2048);
		sonne.shadow.bias = -0.0005;
		sonne.shadow.normalBias = 0.5;
		sonne.shadow.radius = 1.2;
		sonne.shadow.intensity = 0.62;
		const gegenlicht = new THREE.DirectionalLight(0xdfe8f2, 0.38);
		szene.add(grundlicht, sonne, sonne.target, gegenlicht, gegenlicht.target);
		szene.userData.sonne = sonne;
		szene.userData.gegenlicht = gegenlicht;

		/**
		 * Verdeckungsschatten. Ein Weißmodell lebt davon: Ohne sie
		 * verschmelzen Hofwände, enge Gassen und Gebäudefugen zu einer
		 * einzigen hellen Fläche, weil dort überall dieselbe Farbe liegt.
		 */
		composer = new EffectComposer(renderer);
		composer.addPass(new RenderPass(szene, kamera));
		gtao = new GTAOPass(szene, kamera, b, h);
		gtao.updateGtaoMaterial({
			radius: 14, distanceExponent: 1, thickness: 30,
			scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false
		});
		composer.addPass(gtao);
		composer.addPass(new OutputPass());
	}

	/** Ein Stoff für alle Kanten; Breite und Auflösung setzt `zeichne`. */
	const kantenStoff = new LineMaterial({ color: 0x3a3a37, linewidth: 0.75, worldUnits: false });

	/**
	 * Sättigung, Kontrast und Helligkeit des Bodens als Shaderwerte. Ein Zug am
	 * Regler setzt nur diese drei Zahlen; das Bodenbild bleibt, wie es ist.
	 * Die Rechnung steht in `anpassen.ts` und gilt dort auch für die Datei.
	 */
	const karteWerte = {
		uSaettigung: { value: 1 }, uKontrast: { value: 1 }, uHelligkeit: { value: 1 }
	};
	function bodenStoff(map: THREE.Texture) {
		const m = new THREE.MeshLambertMaterial({ map });
		m.onBeforeCompile = (sh) => {
			Object.assign(sh.uniforms, karteWerte);
			sh.fragmentShader = 'uniform float uSaettigung;\nuniform float uKontrast;\nuniform float uHelligkeit;\n'
				+ sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + KARTE_GLSL);
		};
		return m;
	}

	/** Der Plan als Bodenbild. Derselbe Zeichner wie in der Aufsicht. */
	function bodenbild(r: Rahmen) {
		const c = document.createElement('canvas');
		// 2048 waren bei eineinhalb Kilometer Rahmenbreite 0,72 Meter je Bildpunkt;
		// eine zwei Meter breite Gasse bekam drei Punkte und franste aus.
		//
		// Seit 04.11.2026 so breit wie die gewählte Ausgabe, bis 8K (Volker: nah
		// dran wirkte der Boden pixelig, obwohl Rhino schon 8K bekam). Die
		// Ansicht zeigt damit dieselbe Schärfe wie `model_texture.png`. Begrenzt
		// durch das, was die Grafikkarte als Textur annimmt.
		const k = Math.min(z.ausgabeBreite, renderer?.capabilities.maxTextureSize ?? 4096);
		c.width = k; c.height = Math.round((k * r.hoeheM) / r.breiteM);
		const tex = new Rahmen({
			lon0: r.gitter.lon0, bbox: [r.x0, r.y0, r.x1, r.y1],
			pixelBreite: c.width, verhaeltnis: r.verhaeltnis
		});
		const ohneBauten = new Set<StiftId>(
			[...z.sichtbar].filter((s) => s !== 'gebaeude' && s !== 'erhalt' && s !== 'overture')
		);
		zeichneBlatt(c.getContext('2d')!, z.objekte, tex, {
			kanten: { ...z.kanten },
			darstellung: 'modell3d', bereinigt: z.bereinigt, beschriftung: false,
			plangebiet: z.plangebiet, rahmenZeigen: false,
			sichtbar: ohneBauten, hervorgehoben: null
		});
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1;
		return t;
	}

	/**
	 * Das Gelände in der Raumansicht.
	 *
	 * Gezeigt wird relativ zum tiefsten Punkt im Rahmen, nicht über dem Meer:
	 * Die Kamera, die Einrahmung und der Griff ins Bild rechnen mit einem Boden
	 * nahe null. Die absoluten Höhen stehen im Paket.
	 */
	const feld = $derived(z.gelaendeJetzt && z.rahmen ? feldImRahmen(z.gelaendeJetzt, z.rahmen) : null);
	/** Wie hoch das Modell über seinem tiefsten Punkt reicht. Für Kamera und Einrahmung. */
	const modellHoehe = () => Math.max(hoechstes(z.objekte) + (feld ? feld.max - feld.min : 0), 1);

	function bauen() {
		const r = z.rahmen;
		if (!r || !szene) return;
		const g = z.gelaendeJetzt, f = feld;
		const bezug = f ? f.min : 0;
		for (const alt of geloescht.splice(0)) {
			szene.remove(alt);
			const m = alt as THREE.Mesh;
			m.geometry?.dispose?.();
		}

		const sichtbar = (o: (typeof z.objekte)[number]) =>
			z.sichtbar.has(sichtEbene(o)) && o.zustand !== 'gestrichen';
		const bauten = z.objekte.filter((o) => o.ebene === 'gebaeude' && sichtbar(o));
		const bleibt = z.objekte.filter((o) => o.ebene === 'erhalt' && sichtbar(o));

		const koerper = (liste: typeof bauten, farbe: number) => {
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(
				baukoerper(liste, r, g ? (o) => tiefsteUnter(g, o.ringe) - bezug : undefined), 3));
			geo.computeVertexNormals();
			// Rückseiten werden weggeschnitten. Das ist nur erlaubt, weil die
			// Umlaufrichtung der Ringe in raum.ts vereinheitlicht wird.
			// Die Flächen ein wenig nach hinten, damit die Kanten auf ihnen
			// durchgezogen stehen statt mit ihnen um die Tiefe zu streiten.
			const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
				color: farbe, side: THREE.FrontSide,
				polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
			}));
			m.castShadow = true; m.receiveShadow = true;
			szene!.add(m); geloescht.push(m);

			/**
			 * Kanten. Weiß auf Weiß braucht eine Linie, sonst endet ein Körper
			 * dort, wo zufällig das Licht wechselt, und nicht dort, wo er
			 * wirklich endet. Aus dem Grundriss (`baukanten`), nicht aus den
			 * Dreiecken; als breite Linien, weil WebGL einfache Linien immer
			 * nur einen Bildpunkt breit zeichnet.
			 */
			if (z.kanten.an) {
				const lg = new LineSegmentsGeometry();
				lg.setPositions(baukanten(liste, r, g ? (o) => tiefsteUnter(g, o.ringe) - bezug : undefined));
				const kanten = new LineSegments2(lg, kantenStoff);
				szene!.add(kanten); geloescht.push(kanten);
			}
			return m;
		};
		koerper(bauten, 0xeeeeed);
		koerper(bleibt, 0xc7c5c1);

		/**
		 * Kronen als Ikosaeder, eine Instanz je Baum.
		 *
		 * Ikosaeder ohne Unterteilung, also zwanzig Dreiecke. Gemessen in der
		 * Umbra-Sitzung an 1.781 Kronen: eine Kugel mit 12 × 8 Segmenten kostet
		 * 168 Dreiecke je Krone, ein Ikosaeder der Stufe 1 achtzig, Stufe 0
		 * zwanzig. Bei 1.781 Baeumen sind das 51.446 Dreiecke gegen 315.034 —
		 * und die Baukoerper dieses Ausschnitts sind 15.826. Eine feinere
		 * Kugel kostet also ein Vielfaches des ganzen uebrigen Modells, um bei
		 * Kronengroesse eine Rundung zu zeigen, die niemand sieht.
		 *
		 * Undurchsichtig, und das ist keine Sparmassnahme: Eine halbdurch-
		 * sichtige Krone saehe aus wie ein gerechneter Durchlass. Der ist die
		 * zentrale offene Groesse jeder Verschattungsrechnung und von niemandem
		 * gesetzt. Lieber ein Koerper, der sichtbar zu dicht ist, als einer,
		 * der eine Genauigkeit vortaeuscht.
		 *
		 * Die Baeume reichen ueber den Rahmen hinaus, weil `rest.json` nicht
		 * beschnitten ist. Hier werden sie es, wie im Paket: Ein Baum vor der
		 * Kante darf nicht verschatten, wo ein Haus an derselben Stelle es
		 * nicht tut.
		 */
		if (z.baeume && z.baumpunkte.length) {
			const drin = z.baumpunkte.filter(
				(b) => b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1
			);
			if (drin.length) {
				const kugel = new THREE.InstancedMesh(
					new THREE.IcosahedronGeometry(1, 0),
					new THREE.MeshLambertMaterial({ color: KRONE[schema], flatShading: true }),
					drin.length
				);
				const m = new THREE.Matrix4();
				for (let i = 0; i < drin.length; i++) {
					const b = drin[i];
					const rad = Math.max(0.5, b.krone / 2) * BAUM.silhouetteFaktor;
					m.makeScale(rad, rad, rad);
					m.setPosition(b.x - r.x0, (g ? hoeheBei(g, b.x, b.y) - bezug : 0) + BAUM.stammhoeheM + Math.max(0.5, b.krone / 2), -(b.y - r.y0));
					kugel.setMatrixAt(i, m);
				}
				kugel.instanceMatrix.needsUpdate = true;
				kugel.castShadow = true; kugel.receiveShadow = true;
				szene.add(kugel); geloescht.push(kugel);
			}
		}

		const platte = f
			? new THREE.PlaneGeometry(r.breiteM, r.hoeheM, f.nx - 1, f.ny - 1)
			: new THREE.PlaneGeometry(r.breiteM, r.hoeheM);
		if (f) {
			// Die Ebene läuft zeilenweise von Norden nach Süden, das Feld von
			// Süden nach Norden. Nach der Drehung um −90° ist das lokale Z die Höhe.
			const pos = platte.attributes.position as THREE.BufferAttribute;
			for (let zeile = 0; zeile < f.ny; zeile++)
				for (let i = 0; i < f.nx; i++)
					pos.setZ(zeile * f.nx + i, f.z[(f.ny - 1 - zeile) * f.nx + i] - bezug);
			pos.needsUpdate = true;
			platte.computeVertexNormals();
		}
		const boden = new THREE.Mesh(
			platte,
			bodenStoff(bodenbild(r))
		);
		boden.rotation.x = -Math.PI / 2;
		boden.position.set(r.breiteM / 2, 0, -r.hoeheM / 2);
		boden.receiveShadow = true;
		szene.add(boden); geloescht.push(boden);

		const sonne = szene.userData.sonne as THREE.DirectionalLight;
		const gegen = szene.userData.gegenlicht as THREE.DirectionalLight;
		const w = Math.max(r.breiteM, r.hoeheM);
		const mitte = new THREE.Vector3(r.breiteM / 2, 0, -r.hoeheM / 2);
		sonne.position.set(mitte.x - w * 0.55, w * 0.85, mitte.z - w * 0.5);
		sonne.target.position.copy(mitte);
		gegen.position.set(mitte.x + w * 0.7, w * 0.35, mitte.z + w * 0.6);
		gegen.target.position.copy(mitte);
		const s = sonne.shadow.camera as THREE.OrthographicCamera;
		const halb = w * 0.78;
		s.left = -halb; s.right = halb; s.top = halb; s.bottom = -halb;
		s.near = 1; s.far = w * 3;
		s.updateProjectionMatrix();
	}

	let zuletzt = { b: 0, h: 0 };

	type Stand = { w: number; n: number; a: number; vx: number; vz: number; b: number; h: number };
	let stand: Stand = { w: ANSICHT_W, n: ANSICHT_N, a: 1, vx: 0, vz: 0, b: 900, h: 600 };
	let angefordert = false;

	/**
	 * Zeichnen auf den nächsten Bildschirmtakt legen.
	 *
	 * Ein Zug mit der Maus setzt den Zustand dutzendfach je Sekunde. Würde
	 * jedes Mal sofort gerendert, liefe die Anzeige der Eingabe hinterher und
	 * auf schwacher Grafik bliebe der Hauptfaden ganz stehen. So wird immer
	 * nur der zuletzt gültige Stand gezeichnet.
	 */
	function anfordern() {
		if (angefordert) return;
		angefordert = true;
		const los = () => {
			if (!angefordert) return;
			angefordert = false;
			zeichne();
		};
		requestAnimationFrame(los);
		// Notnagel: In einem Hintergrundreiter und bei mancher Grafikschicht
		// schlaeft der Bildtakt. Ohne diese Leine bliebe die Ansicht stehen.
		setTimeout(los, 120);
	}

	/** Blickpunkt: Mitte des Rahmens auf Höhe null, um den Versatz verschoben. */
	function ziel(r: Rahmen, vx: number, vz: number) {
		return new THREE.Vector3(r.breiteM / 2 + vx, 0, -r.hoeheM / 2 + vz);
	}

	/**
	 * Blickpunkt und Abstand, bei denen der ganze Rahmen mittig ins Bild passt.
	 *
	 * Perspektivisch gerechnet, nicht orthogonal. Frühere Anläufe maßen die
	 * Ausdehnung nur quer zur Blickrichtung; nahe Ecken stehen aber dichter an
	 * der Kamera und bilden größer ab, also schnitt das Modell unten ab. Und
	 * wer den Blickpunkt einfach in die Mitte des umschließenden Quaders legt,
	 * mittelt über dessen obere Hälfte, die fast nur Luft ist — dann hängt das
	 * Modell schief im Bild.
	 *
	 * Deshalb hier die Bedingung direkt: für jede Ecke muss ihr seitlicher
	 * Versatz in den Öffnungswinkel passen, gemessen an ihrer eigenen Tiefe.
	 * Zu gegebenem Abstand ist das ein Intervall zulässiger Blickpunkte. Der
	 * kleinste Abstand, bei dem beide Intervalle noch nicht leer sind, wird
	 * eingeschachtelt; die Intervallmitte ist der Blickpunkt. Das Modell steht
	 * damit so groß im Bild, wie es ohne Anschneiden geht, und mittig dazu.
	 *
	 * Gerechnet wird immer für den Ausgangsblick, nie für den gerade
	 * eingestellten. Sonst ändert sich die Einrahmung mit jedem Grad, den man
	 * dreht, und das Modell rückte beim Ziehen von selbst nach.
	 */
	function einpassen(r: Rahmen, aspekt: number) {
		const hMax = modellHoehe();
		const richtung = new THREE.Vector3(
			Math.cos(ANSICHT_N) * Math.sin(ANSICHT_W),
			Math.sin(ANSICHT_N),
			Math.cos(ANSICHT_N) * Math.cos(ANSICHT_W)
		).normalize();
		const rechts = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), richtung).normalize();
		const oben = new THREE.Vector3().crossVectors(richtung, rechts).normalize();
		const boden = ziel(r, 0, 0);

		const halb = Math.tan((kamera!.fov * Math.PI) / 360);
		const quer = halb * aspekt;

		const ecken: { u: number; v: number; t: number }[] = [];
		for (const x of [0, r.breiteM])
			for (const y of [0, hMax])
				for (const zz of [0, -r.hoeheM]) {
					const q = new THREE.Vector3(x, y, zz).sub(boden);
					ecken.push({ u: q.dot(rechts), v: q.dot(oben), t: q.dot(richtung) });
				}

		/** Zulässiges Intervall für den Blickpunkt auf einer Bildachse. */
		const spielraum = (d: number, wert: (e: (typeof ecken)[0]) => number, kegel: number) => {
			let lo = -Infinity, hi = Infinity;
			for (const e of ecken) {
				const rand = (d - e.t) * kegel;
				lo = Math.max(lo, wert(e) - rand);
				hi = Math.min(hi, wert(e) + rand);
			}
			return { lo, hi, mitte: (lo + hi) / 2, passt: lo <= hi };
		};
		const passt = (d: number) =>
			spielraum(d, (e) => e.u, quer).passt && spielraum(d, (e) => e.v, halb).passt;

		let eng = Math.max(...ecken.map((e) => e.t)) + 1;
		let weit = eng + 1e5;
		for (let i = 0; i < 60; i++) {
			const m = (eng + weit) / 2;
			if (passt(m)) weit = m;
			else eng = m;
		}
		const d = weit * 1.1;
		const blick = boden
			.addScaledVector(rechts, spielraum(d, (e) => e.u, quer).mitte)
			.addScaledVector(oben, spielraum(d, (e) => e.v, halb).mitte);
		return { blick, d };
	}

	/**
	 * Die einmal berechnete Einrahmung.
	 *
	 * Sie hängt nur an Rahmen, Bauhöhe und Seitenverhältnis, nicht am
	 * Blickwinkel. Dadurch ist Drehen reines Drehen, Zoomen reines Zoomen und
	 * Schieben reines Schieben.
	 */
	let grund: { schluessel: string; blick: THREE.Vector3; d: number } | null = null;
	function grundstellung(r: Rahmen, aspekt: number) {
		const hMax = modellHoehe();
		const schluessel = `${r.breiteM}|${r.hoeheM}|${hMax}|${aspekt.toFixed(4)}`;
		if (!grund || grund.schluessel !== schluessel) {
			grund = { schluessel, ...einpassen(r, aspekt) };
		}
		return grund;
	}

	/**
	 * Was Massstab und Nordpfeil anzeigen. Wird mit der Kamera gesetzt, nicht
	 * daneben gerechnet — so kann es nicht auseinanderlaufen.
	 */
	let sicht = $state({ mpp: 0, nordGrad: 0 });

	/** Kamera aus einem Stand setzen, ohne zu zeichnen. */
	function kameraStellen(s: Stand) {
		const r = z.rahmen;
		if (!kamera || !r) return;
		const aspekt = s.b / s.h;
		kamera.aspect = aspekt;
		const g = grundstellung(r, aspekt);
		/**
		 * Der Blickpunkt der Grundstellung liegt neben der Bodenmitte, damit das
		 * ganze Modell mittig im Bild steht — auch unter null. Beim Heranzoomen
		 * wandert er deshalb im Verhältnis auf den Boden. Sonst sank die Kamera
		 * mit kleinem Abstand unter die Bodenplatte, und die Ansicht war leer
		 * (gefunden am 04.11.2026, in der Live-Fassung schon ab 20 m Maßstab).
		 */
		const boden = ziel(r, 0, 0);
		const blick = g.blick.clone().sub(boden).multiplyScalar(Math.min(1, s.a))
			.add(boden).add(new THREE.Vector3(s.vx, 0, s.vz));
		const d = g.d * s.a;
		kamera.position.set(
			blick.x + d * Math.cos(s.n) * Math.sin(s.w),
			blick.y + d * Math.sin(s.n),
			blick.z + d * Math.cos(s.n) * Math.cos(s.w)
		);
		kamera.lookAt(blick);
		// Enger Tiefenbereich, sonst verliert die Verdeckungsberechnung Auflösung
		// Nah dran darf die Ferne nicht abgeschnitten werden: Der Rahmen muss
		// ganz in den Tiefenbereich passen, auch wenn die Kamera im Modell steht.
		kamera.near = Math.max(0.5, d / 400);
		kamera.far = Math.max(d * 6, Math.hypot(r.breiteM, r.hoeheM) * 2 + modellHoehe());
		kamera.updateProjectionMatrix();
		kamera.updateMatrixWorld();

		/**
		 * Meter je Bildpunkt auf Hoehe des Blickpunkts.
		 *
		 * In einer Perspektive gibt es keinen einen Massstab: Was vorn liegt,
		 * ist groesser abgebildet als was hinten liegt. Waagerecht auf dem
		 * Schirm stimmt die Rechnung aber genau, denn die Kamera kreist um die
		 * senkrechte Achse — die Schirmwaagerechte liegt deshalb immer
		 * waagerecht in der Welt und in der Bodenebene. Der Balken gilt also
		 * fuer waagerechte Strecken in der Tiefe des Blickpunkts, und genau
		 * das steht auch daneben.
		 */
		sicht = {
			mpp: (2 * d * Math.tan((kamera.fov * Math.PI) / 360)) / s.h,
			/**
			 * Richtung nach Norden auf dem Schirm.
			 *
			 * Norden ist im Gitter −Z. Projiziert auf den Schirm hat die
			 * Richtung die Anteile (sin w) nach rechts und (cos w · sin n)
			 * nach oben; daraus der Winkel im Uhrzeigersinn gegen „oben".
			 * Bei flachem Blick geht der Anteil nach oben gegen null und der
			 * Pfeil legt sich zur Seite — das ist richtig so, dann liegt
			 * Norden fast in der Schirmebene.
			 *
			 * Gezeigt wird Gitternord. Der Rest zu geographisch Nord steht als
			 * Nordabweichung in der Fusszeile; in der Rahmenmitte ist er null,
			 * weil das Gitter dort aufgespannt wird.
			 */
			nordGrad: (Math.atan2(Math.sin(s.w), Math.cos(s.w) * Math.sin(s.n)) * 180) / Math.PI
		};
	}

	/**
	 * Ein runder Balken zwischen 60 und 150 Bildpunkten.
	 *
	 * Die Leiter ist die uebliche 1–2–5: Andere Zahlen laesst man im Kopf nicht
	 * so leicht auf eine Strecke im Bild uebertragen.
	 */
	const LEITER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
	const massstab = $derived.by(() => {
		if (!sicht.mpp || !Number.isFinite(sicht.mpp)) return null;
		const m = LEITER.find((x) => x / sicht.mpp >= 60) ?? LEITER[LEITER.length - 1];
		return {
			meter: m,
			px: Math.round(m / sicht.mpp),
			text: m >= 1000 ? `${m / 1000} km` : `${m} m`
		};
	});

	/** Wo trifft der Blick durch einen Bildpunkt den Boden? */
	function bodenpunkt(px: number, py: number, b: number, h: number) {
		if (!kamera) return null;
		const strahl = new THREE.Raycaster();
		strahl.setFromCamera(new THREE.Vector2((px / b) * 2 - 1, -(py / h) * 2 + 1), kamera);
		const treffer = new THREE.Vector3();
		return strahl.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), treffer)
			? treffer : null;
	}

	/**
	 * Der Ausschnitt des 3D-Bilds in der Ansicht, in Bildschirmpunkten: das
	 * größte Rechteck im gewählten Format, mittig, mit etwas Rand. Im Format
	 * `ansicht` die ganze Ansicht.
	 */
	function ausschnitt(b: number, h: number) {
		const f = BILDFORMATE.find((x) => x.name === z.bild3d.format)?.wert ?? null;
		if (!f) return { x: 0, y: 0, w: b, h };
		const rand = 24;
		let w = b - 2 * rand, hh = w / f;
		if (hh > h - 2 * rand) { hh = h - 2 * rand; w = hh * f; }
		return { x: (b - w) / 2, y: (h - hh) / 2, w, h: hh };
	}
	const zeigeRahmen = $derived(z.bild3d.rahmen && z.bild3d.format !== 'ansicht' ? ausschnitt(breite, hoehe) : null);

	/**
	 * Zeichnen. Ohne `ausgabe` in die Ansicht. Mit `ausgabe` genau den
	 * Ausschnitt in der verlangten Größe: Die Kamera bleibt die der Ansicht,
	 * `setViewOffset` schneidet aus ihr den Ausschnitt heraus. So zeigt das Bild
	 * dasselbe wie der Bildrahmen, nur schärfer.
	 */
	function zeichne(ausgabe?: { b: number; h: number; aus: { x: number; y: number; w: number; h: number } }) {
		const r = z.rahmen;
		if (!renderer || !szene || !kamera || !composer || !r) return;
		const b = ausgabe?.b ?? stand.b, h = ausgabe?.h ?? stand.h;
		if (zuletzt.b !== b || zuletzt.h !== h) {
			// Mit Stil, nicht ohne. Der Zeichner rechnet mit der Geraetedichte
			// und legt bei einem feinen Bildschirm doppelt so viele Bildpunkte
			// an. Ohne die zugehoerige Stilangabe misst die Leinwand dann auch
			// doppelt so gross, haengt aus der Buehne heraus und zeigt nur ihr
			// linkes oberes Viertel. Auf einem groben Bildschirm faellt das nie
			// auf, auf einem feinen sofort.
			renderer.setSize(b, h);
			composer.setSize(b, h);
			gtao?.setSize(b, h);
			zuletzt = { b, h };
		}
		kameraStellen(stand);
		if (ausgabe) {
			kamera.setViewOffset(stand.b, stand.h, ausgabe.aus.x, ausgabe.aus.y, ausgabe.aus.w, ausgabe.aus.h);
		} else kamera.clearViewOffset();
		// Die Stärke gilt für die Ansicht. Ein Bild in voller Ausgabegröße
		// bekommt sie im Verhältnis mit, sonst würden die Kanten im 8K-Bild
		// zu Haaren.
		kantenStoff.resolution.set(b, h);
		kantenStoff.linewidth = z.kanten.dicke * Math.max(1, b / Math.max(1, ausgabe ? ausgabe.aus.w : b));
		const deck = z.kanten.deckkraft ?? 1;
		if (kantenStoff.transparent !== deck < 1) { kantenStoff.transparent = deck < 1; kantenStoff.needsUpdate = true; }
		kantenStoff.opacity = deck;
		composer.render();
	}

	/** Für die Ausgabe: dieselbe Ansicht in voller Größe. */
	/**
	 * Für die Ausgabe: genau die Ansicht, die man sieht, in der gewählten Breite.
	 *
	 * Die Höhe folgt dem Seitenverhältnis der Ansicht. Bis 04.11.2026 bekam das
	 * Bild das des Rahmens; die Einrahmung rechnet aber mit dem Seitenverhältnis,
	 * und so zeigte das Bild einen anderen Ausschnitt. Gerechnet wird mit einem
	 * Bildpunkt je Punkt: Auf einem feinen Bildschirm wäre das Bild sonst um
	 * die Gerätedichte größer als bestellt.
	 */
	export async function alsBild(b = z.bild3d.breite, typ = 'image/png'): Promise<Blob> {
		if (!renderer) throw new Error(t().raum.nichtBereit);
		const aus = ausschnitt(stand.b, stand.h);
		const h = Math.round((b * aus.h) / aus.w);
		const dichte = renderer.getPixelRatio();
		renderer.setPixelRatio(1);
		zuletzt = { b: 0, h: 0 };
		zeichne({ b, h, aus });
		// Eine eigene Farbe unter das Render legen; durchsichtig bleibt durchsichtig.
		let quelle: HTMLCanvasElement = renderer.domElement;
		if (z.bild3d.hintergrund && !z.bild3d.transparent) {
			const c = document.createElement('canvas');
			c.width = quelle.width; c.height = quelle.height;
			const ctx = c.getContext('2d')!;
			ctx.fillStyle = z.bild3d.hintergrund; ctx.fillRect(0, 0, c.width, c.height);
			ctx.drawImage(quelle, 0, 0);
			quelle = c;
		}
		const blob = await new Promise<Blob>((gut, schlecht) =>
			quelle.toBlob((x) => (x ? gut(x) : schlecht(new Error('Kein Bild'))), typ, 1)
		);
		renderer.setPixelRatio(dichte);
		zuletzt = { b: 0, h: 0 };
		zeichne();
		return blob;
	}
	/** Höhe durch Breite des 3D-Bilds, für die Anzeige des Maßes. */
	export const bildSeite = () => { const a = ausschnitt(breite, hoehe); return a.h / a.w; };

	function messen() {
		if (!huelle) return;
		breite = Math.max(200, huelle.clientWidth);
		hoehe = Math.max(150, huelle.clientHeight);
		seite = hoehe / breite;
	}

	$effect(() => {
		const el = huelle;
		if (!el) return;
		messen();
		aufbauen(el, Math.max(200, el.clientWidth), Math.max(150, el.clientHeight));
		// Wird der Zeichner neu aufgebaut — beim Wechsel des Schemas etwa —,
		// ist die Szene danach leer. Der Aufbau muss sich selbst genuegen und
		// darf nicht darauf warten, dass sich zufaellig die Daten aendern.
		bauen();
		anfordern();
		const beob = new ResizeObserver(() => { messen(); anfordern(); });
		beob.observe(el);
		return () => {
			beob.disconnect();
			renderer?.domElement.remove();
			renderer?.dispose();
			renderer = null; composer = null; gtao = null; szene = null; kamera = null;
			// Die gemerkte Groesse gehoert zur alten Leinwand. Bleibt sie stehen,
			// haelt `zeichne` die neue fuer schon richtig eingestellt und laesst
			// sie bei den 300 auf 150 Punkten, mit denen ein Zeichner aufmacht.
			zuletzt = { b: 0, h: 0 };
		};
	});
	$effect(() => {
		z.objekte; z.sichtbar; z.bereinigt; z.plangebiet; z.kasten; z.baeume; z.baumpunkte; feld;
		z.kanten.an; z.ausgabeBreite; z.kanten.karteDicke; z.kanten.karteDeckkraft;
		if (!renderer) return;
		bauen(); anfordern();
	});
	// Die Kantenstärke: nur neu zeichnen.
	$effect(() => { z.kanten.dicke; z.kanten.deckkraft; anfordern(); });
	// Die Regler: drei Zahlen in den Shader, dann neu zeichnen. Sonst nichts.
	$effect(() => {
		karteWerte.uSaettigung.value = z.karte.saettigung;
		karteWerte.uKontrast.value = z.karte.kontrast;
		karteWerte.uHelligkeit.value = z.karte.helligkeit ?? 1;
		anfordern();
	});
	// Der Effekt liest den Zustand, gezeichnet wird erst im nächsten Takt.
	$effect(() => {
		stand = {
			w: winkel, n: neigung, a: abstand,
			vx: versatz.x, vz: versatz.z, b: breite, h: hoehe
		};
		anfordern();
	});

	// ---- Bedienung: links dreht, rechts oder Umschalt schiebt ----
	let zieht: null | {
		art: 'drehen' | 'schieben';
		x: number; y: number; w: number; n: number; vx: number; vz: number;
	} = null;

	function runter(e: PointerEvent) {
		if (![0, 1, 2].includes(e.button)) return;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		zieht = {
			art: e.button === 0 && !e.shiftKey ? 'drehen' : 'schieben',
			x: e.clientX, y: e.clientY, w: winkel, n: neigung, vx: versatz.x, vz: versatz.z
		};
	}
	function bewegen(e: PointerEvent) {
		if (!zieht) return;
		const dx = e.clientX - zieht.x, dy = e.clientY - zieht.y;
		if (zieht.art === 'drehen') {
			winkel = zieht.w - dx * 0.006;
			neigung = Math.max(0.12, Math.min(1.5, zieht.n + dy * 0.005));
			return;
		}
		// Im Boden messen, wie weit ein Bildpunkt trägt, statt es zu schätzen
		const el = huelle;
		if (!el) return;
		const k = el.getBoundingClientRect();
		const a = bodenpunkt(k.width / 2, k.height / 2, k.width, k.height);
		const bx = bodenpunkt(k.width / 2 + 100, k.height / 2, k.width, k.height);
		const bz = bodenpunkt(k.width / 2, k.height / 2 + 100, k.width, k.height);
		if (!a || !bx || !bz) return;
		versatz = {
			x: zieht.vx - ((dx * (bx.x - a.x)) / 100 + (dy * (bz.x - a.x)) / 100),
			z: zieht.vz - ((dx * (bx.z - a.z)) / 100 + (dy * (bz.z - a.z)) / 100)
		};
	}
	function hoch(e: PointerEvent) {
		zieht = null;
		try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
	}
	/**
	 * Zoomt auf den Punkt unter dem Zeiger, nicht auf die Rahmenmitte.
	 *
	 * Ohne das wandert beim Hineinzoomen genau die Stelle aus dem Bild, die
	 * man sich ansehen wollte.
	 */
	function rad(e: WheelEvent) {
		e.preventDefault();
		const el = huelle;
		if (!el || !kamera) return;
		const k = el.getBoundingClientRect();
		const px = e.clientX - k.left, py = e.clientY - k.top;

		const vorher = bodenpunkt(px, py, k.width, k.height);
		// Untergrenze in Metern statt als Anteil: Bei einem Rahmen von vier
		// Kilometern hörte das Heranzoomen sonst bei sechshundert Metern auf.
		// Rund 25 m vor dem Blickpunkt reichen für ein einzelnes Haus.
		const r = z.rahmen;
		const ganz = r ? grundstellung(r, k.width / k.height).d : 1;
		const neu = Math.max(Math.min(0.1, 25 / ganz), Math.min(3, abstand * (e.deltaY < 0 ? 1 / 1.15 : 1.15)));
		if (!vorher) { abstand = neu; return; }

		kameraStellen({ ...stand, a: neu, b: k.width, h: k.height });
		const nachher = bodenpunkt(px, py, k.width, k.height);
		abstand = neu;
		if (nachher) {
			versatz = {
				x: versatz.x + (vorher.x - nachher.x),
				z: versatz.z + (vorher.z - nachher.z)
			};
		}
	}
</script>

<div
	class="raum" bind:this={huelle}
	onpointerdown={runter} onpointermove={bewegen}
	onpointerup={hoch} onpointercancel={hoch} onwheel={rad}
	oncontextmenu={(e) => e.preventDefault()}
	role="presentation"
></div>

{#if massstab}
	<div class="massstab" title={t().raum.massstabTitel}>
		<div class="balken" style:width="{massstab.px}px"></div>
		<span class="mono">{massstab.text}</span>
	</div>
{/if}

<!--
	Das N wandert mit der Spitze und bleibt dabei aufrecht.

	Steht der Buchstabe fest unter dem Pfeil, ist die Anzeige mehrdeutig: Zeigt
	der Pfeil nach oben links und das N steht unten, weiss der Leser nicht, ob
	Norden dort ist, wo die Spitze hinzeigt, oder dort, wo der Buchstabe steht.
	Deshalb dreht die Gruppe, und der Text dreht in sich zurueck.
-->
{#if zeigeRahmen}
	<!-- Der Bildrahmen: was das 3D-Bild zeigen wird. Außen abgedunkelt; die
	     Hülle schneidet den Schatten an der Bühne ab. -->
	<div class="rahmenhuelle">
		<div class="bildrahmen" style:left="{zeigeRahmen.x}px" style:top="{zeigeRahmen.y}px"
			style:width="{zeigeRahmen.w}px" style:height="{zeigeRahmen.h}px"></div>
	</div>
{/if}

<div class="nord" title={t().raum.nordTitel}>
	<svg viewBox="0 0 40 40" aria-label={t().raum.norden} role="img">
		<g transform="rotate({sicht.nordGrad} 20 20)">
			<path d="M20 11 L25.5 30 L20 26 L14.5 30 Z" />
			<text x="20" y="7.5" transform="rotate({-sicht.nordGrad} 20 5)"
				text-anchor="middle" font-size="9">N</text>
		</g>
	</svg>
</div>

<p class="wink">{t().raum.wink}</p>

<style>
	.raum {
		position: absolute; inset: 0; z-index: 1;
		cursor: grab; touch-action: none; line-height: 0;
	}
	.raum:active { cursor: grabbing; }
	.wink {
		position: absolute; right: 18px; bottom: 18px; z-index: 2; margin: 0;
		font-size: 11px; color: var(--tinte-2); pointer-events: none;
		background: var(--blatt); border: 1px solid var(--linie);
		padding: 3px 8px; border-radius: 2px;
	}

	/*
	   Massstab links unten, Nordpfeil rechts oben — die Stellen, an denen ein
	   Planleser sie sucht. Beide ohne Kasten: Sie liegen ueber dem Modell und
	   sollen es nicht zerschneiden. Lesbar bleiben sie durch den Schatten,
	   der in beiden Schemata gegen den Grund arbeitet.
	*/
	.rahmenhuelle { position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
	.bildrahmen {
		position: absolute; pointer-events: none;
		border: 1px solid var(--akzent);
		box-shadow: 0 0 0 9999px rgba(17, 17, 17, 0.28);
	}
	.massstab {
		position: absolute; left: 18px; bottom: 18px; z-index: 2;
		display: flex; align-items: center; gap: 8px;
		font-size: 11px; color: var(--tinte-2); pointer-events: none;
		text-shadow: 0 0 3px var(--blatt), 0 0 6px var(--blatt);
	}
	.balken {
		height: 6px; border: 1px solid var(--tinte-2); border-top: 0;
		box-shadow: 0 0 3px var(--blatt);
	}
	.nord {
		position: absolute; right: 18px; top: 18px; z-index: 2;
		display: flex; flex-direction: column; align-items: center; gap: 2px;
		font-size: 11px; color: var(--tinte-2); pointer-events: none;
		text-shadow: 0 0 3px var(--blatt), 0 0 6px var(--blatt);
	}
	.nord svg {
		width: 40px; height: 40px; display: block; overflow: visible;
		filter: drop-shadow(0 0 3px var(--blatt)) drop-shadow(0 0 6px var(--blatt));
	}
	.nord path { fill: var(--tinte-2); }
	.nord text { fill: var(--tinte-2); font-family: var(--mono, monospace); }
</style>
