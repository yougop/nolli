<script lang="ts">
	import Karte from '$lib/ui/Karte.svelte';
	import Blatt from '$lib/ui/Blatt.svelte';
	import Raum from '$lib/ui/Raum.svelte';
	import { z, VERHAELTNISSE, AUSGABEBREITEN } from '$lib/zustand.svelte';
	import { STIFTE, FAHRBAHN } from '$lib/stifte';
	import { ebenenZaehlen } from '$lib/zeichnen';
	import { hoehenDeckung, ringflaeche, istTeil } from '$lib/osm';
	import { amRahmen } from '$lib/schneiden';
	import { BAUM } from '$lib/analysedaten';
	import { baeumeAlsObj } from '$lib/export/baeume';
	import { feldImRahmen, aequidistanz, tiefsteUnter } from '$lib/geo/gelaende';
	import { DARSTELLUNGEN, darstellung as darstellungVon } from '$lib/darstellung';
	import { laden, stempel, bild, dxf, obj, alsMtl, paket, WEBP } from '$lib/ui/ausgeben';
	import { sucheOrt } from '$lib/quelle';
	import { t, sprache, spracheSetzen, spracheAnfangen, gebiet, zahl, englisch } from '$lib/sprache.svelte';
	import { aufV2, vertragV2, pfadV2, darstellungV2 } from '$lib/vertrag';
	import { paketLiesmich } from '$lib/liesmich';

	const SCHRITTE = [1, 2, 3] as const;

	$effect(() => { spracheAnfangen(); });

	/**
	 * Gelände nachholen, wenn der Schalter an ist, das Raster aber zu einem
	 * anderen Rahmen gehört.
	 *
	 * Ohne das blieb der Knopf nach einem neuen Ort hervorgehoben, die Ansicht
	 * aber flach — erst Aus und wieder An holte das Raster. Gewartet wird, bis
	 * der Bestand da ist: Während jemand in Schritt 1 den Rahmen zieht, soll
	 * nicht bei jeder Bewegung ein Höhenmodell geladen werden.
	 */
	$effect(() => {
		if (z.gelaende && z.datenAktuell && !z.gelaendeJetzt && !z.gelaendeLaedt) z.gelaendeHolen();
	});

	let suche = $state('HafenCity, Hamburg');
	let treffer = $state<any[]>([]);
	let suchtGerade = $state(false);
	let karte = $state<Karte | null>(null);
	let arbeitet = $state<string | null>(null);
	let schema = $state<'hell' | 'dunkel'>('hell');

	$effect(() => { schema = (document.documentElement.dataset.schema as any) ?? 'hell'; });

	/**
	 * Sitzung behalten.
	 *
	 * Gelesen wird hier alles, was den Stand der Arbeit ausmacht; dadurch
	 * meldet sich der Effekt bei jeder Aenderung daran. Das Ablegen selbst
	 * wartet einen halben Takt, sonst schriebe ein Zug mit der Maus dutzendfach
	 * je Sekunde in die Ablage.
	 */
	$effect(() => {
		z.schritt; z.ort; z.kasten; z.verhaeltnis; z.ausgabeBreite;
		z.objekte; z.sichtbar; z.plangebiet; z.darstellung;
		z.beschriftung; z.bereinigt; z.geladenFuer; z.gelaende; z.gelaendeFuer;
		z.sichern();
	});

	/**
	 * Beim Weggehen sofort ablegen.
	 *
	 * Der Wartetakt von einem halben Takt ist gut gegen dauerndes Schreiben,
	 * aber schlecht, wenn jemand eine Sekunde nach dem letzten Klick den
	 * Reiter schliesst. `visibilitychange` ist der Griff, der auch auf dem
	 * Telefon und beim harten Schliessen noch kommt.
	 */
	$effect(() => {
		const weg = () => { if (document.visibilityState === 'hidden') z.sofortSichern(); };
		document.addEventListener('visibilitychange', weg);
		window.addEventListener('pagehide', weg);
		return () => {
			document.removeEventListener('visibilitychange', weg);
			window.removeEventListener('pagehide', weg);
		};
	});

	const uhrzeit = (t: number) =>
		new Date(t).toLocaleTimeString(gebiet(), { hour: '2-digit', minute: '2-digit' });

	function schemaWechseln() {
		schema = schema === 'hell' ? 'dunkel' : 'hell';
		document.documentElement.dataset.schema = schema;
		try { localStorage.setItem('nolli.schema', schema); } catch {}
	}

	let suchTakt: ReturnType<typeof setTimeout>;
	function suchen() {
		clearTimeout(suchTakt);
		if (suche.trim().length < 2) { treffer = []; return; }
		suchTakt = setTimeout(async () => {
			suchtGerade = true;
			try { treffer = await sucheOrt(suche); }
			catch { treffer = []; } finally { suchtGerade = false; }
		}, 260);
	}

	function ortNehmen(t: any) {
		z.ort = t; treffer = []; suche = t.name;
		z.rahmenUmOrt(t);
		karte?.fliegeZu(t.lon, t.lat, t.bbox);
	}

	const r = $derived(z.rahmen);
	const zaehler = $derived(ebenenZaehlen(z.objekte));
	const deckung = $derived(hoehenDeckung(z.objekte));
	/** Dieselbe Auskunft ohne die `building:part`. Siehe `hoehenDeckung`. */
	const deckungHaeuser = $derived(hoehenDeckung(z.objekte, true));
	/** Nur die Kronen im Rahmen — `rest.json` reicht darüber hinaus. */
	const imRahmenBaeume = $derived(
		r ? z.baumpunkte.filter((b) => b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1).length : 0
	);
	const mitAdresse = $derived(z.objekte.filter((o) => o.adresse).length);
	const denkmale = $derived(z.objekte.filter((o) => o.denkmal).length);
	const darstellungJetzt = $derived(darstellungVon(z.darstellung));
	const raeumlich = $derived(darstellungJetzt.bauweise === 'raum');
	/** Eine Aufsicht, die als Untergrund für ein 3D-Werkzeug taugt? */
	const schattenwurf = $derived(darstellungJetzt.bauweise === 'weissmodell');
	/**
	 * Die Datendateien des Pakets, an einer Stelle.
	 *
	 * Sie stehen hier und nicht nur in `paketSchnueren`, weil der Knopf ihre
	 * Zahl nennt, bevor gepackt wird. Zwei Stellen, die dieselbe Liste führen,
	 * laufen auseinander — genau das war am 16.09.2026 beim Dateizähler
	 * passiert: Er zählte sieben Datendateien, während acht geschrieben wurden,
	 * und die Paarung der Bilder war auch noch die alte.
	 */
	const DATENDATEIEN = $derived([
		'koerper.json', 'netz.json', 'punkte.json', 'haltestellen.json',
		'linien.json', 'flaechen.json', 'rest.json', 'baeume.json',
		...(z.gelaende ? ['gelaende.json'] : [])
	]);
	/** Das Gelände im Rahmen, für Anzeige und Vertrag: Spanne und Äquidistanz. */
	const gelaendeFeld = $derived(z.gelaendeJetzt && r ? feldImRahmen(z.gelaendeJetzt, r) : null);
	const hoehenAbstand = $derived(gelaendeFeld ? aequidistanz(gelaendeFeld.max - gelaendeFeld.min) : null);

	/** Wie viele Dateien das Paket enthält, damit der Knopf nicht lügt. */
	const paketdateien = $derived(
		// Jede flache Darstellung zweimal: mit allem und als Grund.
		2 * DARSTELLUNGEN.filter((d) => d.bauweise !== 'raum').length
		+ (raeumlich ? 1 : 0)
		+ DATENDATEIEN.length
		+ 5    // Modell, Materialien, Zeichnung, Vertrag, Liesmich
		+ (z.gelaende ? 1 : 0)    // Geländetextur
	);
	let raum = $state<Raum | null>(null);
	const f0 = (n: number) => zahl(Math.round(n));
	const f1 = (n: number) => zahl(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

	/** Dem Browser einen Anstrich lassen, bevor der Hauptfaden blockiert. */
	const anstrich = () =>
		new Promise<void>((fertig) => requestAnimationFrame(() => setTimeout(fertig, 0)));

	let geraeumt = $state<{ flaechen: number; linien: number } | null>(null);
	function raeumen() {
		geraeumt = z.freiraeumen();
		setTimeout(() => (geraeumt = null), 6000);
	}

	/**
	 * Grundfläche je Ebene, in Quadratmetern.
	 *
	 * Summe der Footprints, keine Aufteilung der Rahmenfläche. Gestrichenes
	 * zählt nicht mit, Erhalt zählt zu den Gebäuden.
	 */
	function flaechenbilanz() {
		const aus: Record<string, number> = {};
		for (const o of z.objekte) {
			if (o.art !== 'flaeche' || o.zustand === 'gestrichen') continue;
			const schluessel = o.ebene === 'erhalt' ? 'gebaeude' : o.ebene;
			let a = 0;
			for (const ring of o.ringe) a += Math.abs(ringflaeche(ring));
			for (const loch of o.loecher ?? []) a -= Math.abs(ringflaeche(loch));
			aus[schluessel] = (aus[schluessel] ?? 0) + Math.max(0, a);
		}
		for (const k of Object.keys(aus)) aus[k] = Math.round(aus[k]);
		return aus;
	}

	const NURWEG = new Set(['footway', 'path', 'steps', 'cycleway', 'track', 'bridleway']);

	function verkehrsflaeche() {
		if (!z.netz) return null;
		let fahrbahn = 0, wege = 0;
		for (const k of z.netz.kanten) {
			const art = String(k.highway ?? '');
			const gemessen = parseFloat(String(k.width ?? ''));
			const breite = Number.isFinite(gemessen) && gemessen > 0
				? gemessen
				: FAHRBAHN[art] ?? 4;
			const a = (k.laenge_m as number) * breite;
			if (NURWEG.has(art)) wege += a; else fahrbahn += a;
		}
		return { fahrbahn: Math.round(fahrbahn), wege: Math.round(wege) };
	}

	/**
	 * Das ganze Paket: Daten, Bilder, Modelle, Vertrag.
	 *
	 * Nolli entscheidet nicht, was ein nachgelagertes Werkzeug braucht. Es legt
	 * alles hinein, was es erzeugen kann, und der Vertrag sagt, was drin ist.
	 * Wer nur die Bodentextur will, nimmt die Bodentextur.
	 *
	 * Die Namen im Archiv sind kurz und ohne Vorsatz — die Kennung trägt das
	 * Archiv selbst. Die Einzeldownloads behalten ihren langen Namen, weil sie
	 * im Ordner „Downloads" landen und dort eine Kennung brauchen.
	 */
	async function paketSchnueren(basis: string) {
		const rr = r!;
		const teile: { name: string; inhalt: Blob | string }[] = [];
		const bilder: { datei: string; darstellung: string; was: string; baeume: boolean }[] = [];

		// Bilder: jede flache Darstellung, dazu wo vorhanden die Fassung ohne
		// Baukörper. Das ist der Teil, der dauert.
		const flach = DARSTELLUNGEN.filter((d) => d.bauweise !== 'raum');
		let n = 0;
		for (const d of flach) {
			arbeitet = `paket:${t().ausgeben.paketBild(++n, flach.length)}`;
			await anstrich();
			const b = await bild(z.objekte, rr, d.id, z.bereinigt, z.beschriftung, z.plangebiet, z.sichtbar,
				false, WEBP, z.baeume ? z.baumpunkte : undefined);
			teile.push({ name: pfadV2(`bilder/${d.id}.webp`), inhalt: b });
			bilder.push({ datei: `bilder/${d.id}.webp`, darstellung: d.id, was: englisch.darstellungen[d.id].zweck,
				baeume: !!z.baeume && !!z.baumpunkte.length });
			{
				/**
				 * Zu jeder Darstellung die Fassung ohne Baukörper und ohne Bäume.
				 *
				 * Sie ist der Grund, auf den ein anderes Werkzeug seine eigenen
				 * Körper stellt. Was eine Höhe hat, gehört nicht hinein — Häuser
				 * nicht und Bäume nicht; beides steht mit Ort und Maß in den
				 * Daten, wer es will, setzt es selbst.
				 *
				 * Dazu ein handfester Grund. Eine Krone verdeckt den Boden. Ein
				 * gerechneter Schatten, der auf einer gemalten grünen Krone
				 * landet, ist schlechter zu lesen als einer auf grauem Pflaster.
				 *
				 * Bis zum 16.09.2026 gab es sie nur zu den beiden
				 * Weißmodell-Darstellungen. Volker hat den Widerspruch gefunden,
				 * der daraus folgte: Wer in einem nachgelagerten Werkzeug die
				 * Bäume ausschaltet und einen Schwarzplan als Boden liegen hat,
				 * sieht weiter Bäume — die sind ins Bild gemalt. Ein Schalter,
				 * der dann nichts tut, ist schlimmer als keiner.
				 *
				 * Die Paarung gilt deshalb für jede flache Darstellung. Sie
				 * kostet sieben statt zwei zusätzliche Bilder; das ist der
				 * Preis dafür, dass zu jeder Darstellung eine Fassung gehört,
				 * die als Grund taugt.
				 */
				const g = await bild(z.objekte, rr, d.id, z.bereinigt, z.beschriftung, z.plangebiet, z.sichtbar,
					true, WEBP, undefined);
				teile.push({ name: pfadV2(`bilder/${d.id}_grund.webp`), inhalt: g });
				bilder.push({ datei: `bilder/${d.id}_grund.webp`, darstellung: d.id,
					was: 'The same extent without buildings and without trees, as a ground texture under a model of your own',
					baeume: false });
			}
		}
		// Die Raumansicht nur, wenn sie gerade steht — sie braucht ihre Leinwand.
		if (raeumlich && raum) {
			arbeitet = `paket:${t().ausgeben.paket3d}`;
			await anstrich();
			teile.push({ name: pfadV2('bilder/3d-modell.webp'), inhalt: await raum.alsBild(rr.pixelBreite, rr.pixelHoehe, WEBP) });
			bilder.push({ datei: 'bilder/3d-modell.webp', darstellung: 'modell3d',
				was: 'The 3D view as it currently stands',
				baeume: !!z.baeume && !!z.baumpunkte.length });
		}

		arbeitet = `paket:${t().ausgeben.paketDaten}`;
		await anstrich();
		const daten: { datei: string; was: string; eintraege: number; felder: string[] }[] = [];
		/**
		 * Eine Datendatei ins Paket, mit ihren Feldnamen im Inhaltsverzeichnis.
		 *
		 * Die Namen werden aus den Daten gelesen, nicht danebengeschrieben —
		 * eine getippte Liste wäre eine zweite Wahrheit, die veraltet, sobald
		 * jemand ein Feld umbenennt. Gelesen kann sie das nicht.
		 *
		 * Der Anlass: Ein Abnehmer suchte in `baeume.json` nach
		 * `diameter_crown`, weil das in OpenStreetMap so heißt. Die Datei
		 * trägt `krone_m` und `gemessen`, die Vorgabe ist schon eingesetzt.
		 * Er zählte still null gemessene Kronen und hätte beinahe einen
		 * Datenverlust gemeldet. Dass er stattdessen nachsah, war Glück.
		 * Der nächste meldet die Null seinem Nutzer.
		 */
		const legen = (datei: string, was: string, inhalt: unknown[]) => {
			// Die Feldnamen aus dem, was tatsächlich geschrieben wird: v2.
			const v2 = aufV2(inhalt) as unknown[];
			const felder = new Set<string>();
			for (const e of v2)
				if (e && typeof e === 'object' && !Array.isArray(e))
					for (const k of Object.keys(e)) felder.add(k);
			teile.push({ name: pfadV2(`daten/${datei}`), inhalt: JSON.stringify(v2) });
			daten.push({ datei: `daten/${datei}`, was, eintraege: inhalt.length, felder: [...felder] });
		};
		legen('koerper.json', 'Building bodies with height, origin of the height, heritage status and address', koerperliste());
		legen('netz.json', 'Street network as a graph. First the nodes, then the edges.',
			[{ knoten: z.netz?.knoten ?? [] }, ...(z.netz?.kanten ?? [])]);
		legen('punkte.json', 'Shops, food and drink, practices, offices, leisure, street furniture — with group', z.pois);
		legen('haltestellen.json', 'Public transport stops with the lines that serve them', z.haltestellen);
		legen('linien.json', 'The lines themselves, with kind and direction', z.linien);
		legen('flaechen.json', 'Land-use areas', z.nutzflaechen);
		legen('rest.json', 'Everything else from OpenStreetMap, with its tags', z.rest);
		/**
		 * Bäume als eigene Datei, nicht aus `rest.json` gefischt.
		 *
		 * Der Grund ist nicht die Größe — gepackt sind es zwanzig Kilobyte,
		 * das entscheidet nichts. Der Grund ist, dass ein Baum damit ein
		 * Gegenstand des Pakets ist und kein Rest.
		 *
		 * Beschnitten auf den Rahmen, anders als `rest.json`. Dort ist der
		 * Überstand richtig, weil ein Nachbarobjekt Zusammenhang sein kann;
		 * hier ist er falsch, weil ein Baum fünfzig Meter vor der Kante nicht
		 * verschatten darf, wo ein Haus an derselben Stelle es nicht tut.
		 */
		legen('baeume.json',
			`Individual trees with position and crown diameter. \`measured\` says whether the diameter comes from OpenStreetMap or is the default of ${BAUM.vorgabeKroneM} m.`,
				baumliste());
			const g = z.gelaendeJetzt;
			if (g)
				legen('gelaende.json',
					'Terrain raster in the local grid, metres above sea level. Row by row from south to north, each row from west to east; x0/y0 is the south-west corner, 150 m outside the frame.',
					[{ x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy, nx: g.nx, ny: g.ny,
						hoehen: Array.from(g.z, (v) => Math.round(v * 100) / 100) }]);

		/**
		 * Die geschriebene Liste gegen die angekündigte halten.
		 *
		 * Der Knopf nennt die Dateizahl, bevor gepackt wird, und muss sie
		 * deshalb aus einer eigenen Liste nehmen. Zwei Listen laufen
		 * auseinander — also fällt es hier laut auf statt still: lieber eine
		 * Ausgabe, die abbricht, als ein Knopf, der eine falsche Zahl nennt.
		 */
		const geschrieben = daten.map((d) => d.datei.replace('daten/', '')).sort().join(' ');
		const angekuendigt = [...DATENDATEIEN].sort().join(' ');
		if (geschrieben !== angekuendigt)
			throw new Error(`Das Paket schreibt andere Datendateien, als der Knopf ankündigt.\n`
				+ `geschrieben:   ${geschrieben}\nangekündigt: ${angekuendigt}`);

		/**
		 * Das Modell mit Materialdatei, und mit Gelände dazu dessen Textur.
		 *
		 * Wer das OBJ in Rhino öffnet, bekommt das Gelände gleich mit der
		 * Aufsicht ohne Bauten belegt, Straßen und Flächen liegen sichtbar
		 * auf dem Hang. Die DXF bleibt dafür eben: Ebene Kurven lassen sich
		 * schraffieren und extrudieren, aufs Gelände gelegte nicht mehr.
		 */
		const textur = z.gelaendeJetzt ? 'model_texture.png' : null;
		teile.push({ name: pfadV2('modell.obj'), inhalt: obj(z.objekte, rr, z.gelaendeJetzt, 'model.mtl') });
		teile.push({ name: 'model.mtl', inhalt: alsMtl(textur) });
		if (textur)
			teile.push({ name: textur, inhalt: await bild(z.objekte, rr, 'modellaufsicht', z.bereinigt, z.beschriftung,
				z.plangebiet, z.sichtbar, true, 'image/png', undefined) });
		teile.push({ name: pfadV2('zeichnung.dxf'), inhalt: dxf(z.objekte, rr, z.gelaendeJetzt) });
		const vertrag = vertragJetzt(basis, { bilder, daten });
		teile.push({ name: 'frame.json', inhalt: JSON.stringify(vertrag, null, 2) });
		teile.push({ name: 'README.md', inhalt: paketLiesmich(vertrag, sprache.jetzt) });

		arbeitet = `paket:${t().ausgeben.paketPackt}`;
		await anstrich();
		return paket(teile);
	}

	/** Der Datenvertrag zum aktuellen Stand, samt Halteliste und Geschwistern. */
	/** Die Bäume im Rahmen, in Gittermetern wie alles andere. */
	function baumliste() {
		const rr = r!;
		return z.baumpunkte
			.filter((b) => b.x >= rr.x0 && b.x <= rr.x1 && b.y >= rr.y0 && b.y <= rr.y1)
			.map((b) => ({
				x: b.x, y: b.y,
				krone_m: Math.round(b.krone * 10) / 10,
				gemessen: b.gemessen
			}));
	}

	/** Die Baukörper mit allem, was an ihnen hängt. */
	function koerperliste() {
		const rr = r!;
		return z.objekte
			.filter((o) => (o.ebene === 'gebaeude' || o.ebene === 'erhalt') && o.zustand !== 'gestrichen')
			.map((o) => ({
				osm_id: o.id,
				/**
				 * Gebäude oder Gebäudeteil. Ein Teil liegt in seinem Gebäude —
				 * wer Körper stellt, braucht beide; wer Häuser zählt, nur die
				 * Gebäude.
				 */
				art: istTeil(o) ? 'teil' : 'gebaeude',
				/**
				 * Kreuzt dieser Körper die Rahmenkante?
				 *
				 * Dann steht er im Modell zweimal: als Teil im Rahmen und als
				 * `…_ausserhalb` davor. Die Angabe steht hier am Objekt, damit
				 * ein Abnehmer nicht aus dem Namen schließen muss — ein
				 * Namensfilter ist dieselbe ungeschriebene Vereinbarung wie eine
				 * geratene Feldbedeutung. Gewünscht von der Umbra-Sitzung.
				 */
				kreuzt_rahmen: o.ringe.some(
					(ring) => amRahmen(ring, rr.x0, rr.y0, rr.x1, rr.y1).aussen.length > 0
				),
				hoehe_m: Math.round((o.hoeheM ?? 8) * 10) / 10,
				/**
				 * Mit Gelände: die Höhe über dem Meer, auf der der Körper steht — die
				 * tiefste Geländehöhe unter seinem Grundriss. Ohne Gelände fehlt das Feld,
				 * und null ist der Boden.
				 */
				...(z.gelaendeJetzt ? { fuss_m: Math.round(tiefsteUnter(z.gelaendeJetzt, o.ringe) * 100) / 100 } : {}),
				quelle: !o.hoeheGeschaetzt ? 'gemessen' : o.geschosse ? 'geschosse' : 'annahme',
				geschosse: o.geschosse ?? null,
				denkmal: o.denkmal ?? null,
				adresse: o.adresse ?? null,
				nutzung: o.nutzung ?? null,
				klasse: o.klasse ?? null,
				zustand: o.zustand
			}));
	}

	/**
	 * Der Datenvertrag.
	 *
	 * Ohne `struktur` ist er die Beschreibung des Rahmens und trägt die Daten
	 * selbst mit sich — so wird er einzeln ausgegeben. Mit `struktur` ist er
	 * das Inhaltsverzeichnis eines Pakets und nennt stattdessen die Dateien,
	 * in denen dieselben Daten liegen.
	 */
	function vertragJetzt(basis: string, struktur?: {
		bilder: { datei: string; darstellung: string; was: string; baeume: boolean }[];
		daten: { datei: string; was: string; eintraege: number; felder: string[] }[];
	}) {
		const rr = r!;
		return vertragV2(rr.vertrag({
			ort: z.ort ? { name: z.ort.name, wo: z.ort.wo } : null,
			objekte: z.objekte.length,
			gestrichen: z.objekte.filter((o) => o.zustand === 'gestrichen').map((o) => o.id),
			erhalt: z.objekte.filter((o) => o.zustand === 'erhalt').map((o) => o.id),
			/**
			 * Die beiden angenommenen Zahlen am Baum.
			 *
			 * Sie stehen hier, weil sie vorher an zwei Stellen standen — in
			 * Nolli und in Umbra — und nur eine geändert wurde. Dasselbe Paket
			 * zeigte daraufhin einen Kreis von sechs Metern und eine Kugel von
			 * drei. Der Fehler war nicht die Rechnung, sondern die zweite
			 * Stelle. Im Vertrag steht die Annahme einmal; wer sie ändert,
			 * ändert sie für alle.
			 *
			 * Beide sind Annahmen, keine Messungen, und beide haben denselben
			 * bekannten Mangel: Sie sind am Straßenbaumkataster begründet und
			 * greifen fast nur bei handkartierten Bäumen.
			 */
			baeume: {
				vorgabe_krone_m: BAUM.vorgabeKroneM,
				stammhoehe_m: BAUM.stammhoeheM,
				/**
				 * 1 heißt aus. Die Krone ist im Modell ein Ikosaeder und damit
				 * schmaler als der Kreis, den die Aufsicht zeichnet — im Mittel
				 * über alle Richtungen 0,762 der Scheibe, senkrecht von oben
				 * 0,745. Ein Wert über 1 zieht den Körper auf das Maß des
				 * Kreises: 1,1456 für die mittlere Silhouette, 1,1583 für die
				 * Aufsicht. Wer ihn hier ändert, ändert beide Werkzeuge.
				 */
				silhouette_faktor: BAUM.silhouetteFaktor
			},
			/**
			 * Wie viele der Körper Gebäude sind und wie viele Gebäudeteile.
			 *
			 * `building:part` führt die Teile eines Hauses mit eigener Höhe.
			 * Sie müssen ins Modell, sonst ist ein gestaffeltes Haus ein
			 * Quader — aber sie sind keine zusätzlichen Häuser. In der
			 * HafenCity liegt bei 275 von 286 Teilen der Mittelpunkt in einem
			 * Gebäudegrundriss. Wer Körper zählt, zählt sie mit; wer Häuser
			 * zählt, zählt sie doppelt.
			 */
			baukoerper: { gebaeude: deckungHaeuser.gesamt, teile: deckung.gesamt - deckungHaeuser.gesamt },
			hoehen_echt_anteil: Math.round(deckung.anteil * 100) / 100,
			/**
			 * Dieselbe Auskunft, aber aufgeteilt.
			 *
			 * Der Anteil oben sagt, wie viele Höhen gemessen sind. Er sagt
			 * nicht, was die übrigen sind, und dort liegt der Unterschied:
			 * eine aus der Geschosszahl gerechnete Höhe ist eine Näherung mit
			 * Grundlage, der Notwert von acht Metern ist ein Platzhalter.
			 * Ein Werkzeug, das Verschattung nachweist, sollte wissen, auf
			 * wie vielen Platzhaltern sein Nachweis steht.
			 */
			hoehen_herkunft: {
				gemessen: deckung.echt,
				aus_geschossen: deckung.geschosse,
				annahme_8m: deckung.annahme,
				/**
				 * Dieselben drei Gruppen nach Grundfläche.
				 *
				 * Der Körperanteil sagt nicht, wie viel Schatten an ihm hängt.
				 * In der HafenCity stehen 17 % der Körper auf dem Notwert, aber
				 * 29 % der Grundfläche — die Hallen ohne Merkmale sind im
				 * Mittel doppelt so groß wie die vermessenen Häuser. Im
				 * Holstenareal fallen beide Anteile zusammen. Welcher der
				 * beiden Fälle vorliegt, sieht man nur an beiden Zahlen.
				 */
				grundflaeche_m2: {
					gemessen: deckung.flaeche.echt,
					aus_geschossen: deckung.flaeche.geschosse,
					annahme_8m: deckung.flaeche.annahme
				}
			},
			/**
			 * Dieselbe Auskunft ohne die Gebäudeteile.
			 *
			 * Der Unterschied ist groß, weil ein Teil fast immer eine gemessene
			 * Höhe trägt — dafür gibt es ihn. In der HafenCity stehen über alle
			 * Körper 28,6 % der Grundfläche auf dem Notwert, über die Gebäude
			 * allein 44,2 %. Beide Zahlen sind richtig und beantworten zwei
			 * Fragen: was extrudiert wird, und was an Häusern bekannt ist. Nur
			 * dürfen sie nicht für dieselbe gehalten werden — und die Fläche
			 * oben zählt die Überdeckung von Teil und Gebäude doppelt.
			 */
			hoehen_herkunft_gebaeude: {
				gemessen: deckungHaeuser.echt,
				aus_geschossen: deckungHaeuser.geschosse,
				annahme_8m: deckungHaeuser.annahme,
				grundflaeche_m2: {
					gemessen: deckungHaeuser.flaeche.echt,
					aus_geschossen: deckungHaeuser.flaeche.geschosse,
					annahme_8m: deckungHaeuser.flaeche.annahme
				}
			},
			// Die Geschwister mit Namen, damit ein nachgelagertes Werkzeug
			// aus einer geladenen Datei die anderen findet, statt aus dem
			// Namensmuster zu raten.
			dateien: {
				paket: `${basis}.zip`,
				modell: `${basis}.obj`,
				zeichnung: `${basis}.dxf`,
				// Der Bild-Ausgang schreibt genau das Bild, das auf dem Blatt
				// steht. Alle Darstellungen und die Fassungen ohne Baukörper
				// liegen im Paket; sie einzeln mit auszuwerfen hieße, zwei
				// Dateien zu bekommen, wo man eine angeklickt hat.
				aufsicht: `${basis}_${darstellungV2(z.darstellung)}_${rr.pixelBreite}px.png`,
				aufsicht_grund_im_paket: 'bilder/modellaufsicht_grund.webp'
			},
			/**
			 * Je Baukörper die Höhe und woher sie kommt.
			 *
			 * `hoehen_echt_anteil` nennt nur die Quote. Für ein Werkzeug,
			 * das Besonnung rechnet, ist der Unterschied zwischen einer
			 * gemessenen Höhe, einer aus der Geschosszahl gerechneten und
			 * der pauschalen Annahme von acht Metern aber der Unterschied
			 * zwischen einem Wert und einer Vermutung. Mit dieser Liste
			 * kann ein einzelner Schatten das Etikett tragen.
			 */
			/**
			 * Was das Modell vereinfacht, als Liste statt als Fußnote.
			 *
			 * Eine leere Liste ist eine Aussage: hier ist nichts bekannt. Fehlt
			 * das Feld ganz, stammt der Vertrag aus der Zeit vor der Angabe und
			 * ein nachgelagertes Werkzeug muss vom Schlimmsten ausgehen. Deshalb
			 * steht es auch dann da, wenn nichts drinsteht.
			 *
			 * `daecher_flach`: Jeder Baukörper bekommt eine Höhe und ein
			 * waagerechtes Dach. Neigung, First und gestaffelte Traufhöhen kennt
			 * das Modell nicht, weil OpenStreetMap den Umriss als eine Fläche
			 * führt. Für eine Ertragsrechnung auf geneigten Dächern ist das die
			 * Grenze dieses Modells.
			 */
			vorbehalte: ['daecher_flach', z.gelaendeJetzt ? 'gelaende_grob' : 'gelaende_eben'],
			/**
			 * Woher das Gelände kommt und was es kann.
			 *
			 * Es ist die erste Quelle neben OpenStreetMap, mit eigener Lizenz, eigenem
			 * Stand und eigener Genauigkeit. Deshalb steht hier, aus welchen
			 * Höhenmodellen die Kacheln stammen — die Kacheln sagen es selbst —, und in
			 * welcher Auflösung sie gelesen wurden. Ohne Gelände steht `null` da: Das
			 * Paket rechnet dann auf ebener Platte, und `gelaende_eben` sagt es.
			 */
			gelaende: z.gelaendeJetzt && gelaendeFeld
				? {
					quelle: 'AWS Terrain Tiles (Tilezen, Terrarium format)',
					modelle: z.gelaendeJetzt.quellen,
					lizenz: 'Tilezen terrain tiles on AWS Open Data. Attribution per source model: https://github.com/tilezen/joerd/blob/master/docs/attribution.md — EU-DEM: produced using Copernicus data and information funded by the European Union. SRTM: NASA.',
					zoom: z.gelaendeJetzt.zoom,
					kachel_m_pro_px: Math.round(z.gelaendeJetzt.kachelMProPx * 10) / 10,
					raster_m: z.gelaendeJetzt.dx,
					hoehenbezug: 'metres above sea level',
					z_min: Math.round(gelaendeFeld.min * 10) / 10,
					z_max: Math.round(gelaendeFeld.max * 10) / 10,
					aequidistanz_m: hoehenAbstand,
					geholt: z.gelaendeJetzt.geholt
				}
				: null,
			/**
			 * Flaechenbilanz, ausdruecklich als Summe von Grundflaechen.
			 *
			 * Keine Aufteilung der Rahmenflaeche: Ebenen ueberlappen sich, ein
			 * Gruenstreifen kann unter einer Bruecke liegen. Die Summen taugen
			 * fuer Vergleiche und fuer die Grundflaechenzahl, nicht fuer eine
			 * Bilanz, die sich zu hundert Prozent addiert.
			 */
			flaechen_m2: flaechenbilanz(),
			/**
			 * Verkehrsfläche, geschätzt, getrennt nach Fahrbahn und Weg.
			 *
			 * Straßen sind Linien, keine Flächen. Die Fläche folgt aus Länge mal
			 * Breite, und die Breite kommt aus dem Merkmal `width`, wo es steht,
			 * sonst aus der Regelbreite der Klasse.
			 *
			 * Zwei Vorbehalte, beide unvermeidlich: Ein Gehweg ist oft doppelt
			 * erfasst, als Merkmal `sidewalk` an der Fahrbahn und als eigener
			 * Weg daneben — wer beide Zahlen addiert, zählt ihn zweimal. Und
			 * Fahrbahn und Weg sind hier nach Klasse getrennt, nicht nach
			 * Benutzung: Eine Fußgängerzone zählt als Fahrbahn.
			 */
			verkehrsflaeche_m2_geschaetzt: verkehrsflaeche(),
			...(struktur
				? {
					/**
					 * Der Aufbau des Pakets. Jede Datei mit dem, was drin ist.
					 *
					 * Ein nachgelagertes Werkzeug soll nicht raten müssen,
					 * welche Datei es braucht, und es soll nichts laden, was
					 * es nicht braucht.
					 */
					paket: {
						modell: 'modell.obj',
						/**
						 * Was der Name eines Körpers im Modell sagt.
						 *
						 * Damit die Regel im Vertrag steht statt in einer
						 * Absprache: `_hoehe_geschaetzt` heißt, die Höhe ist
						 * nicht gemessen; `_ausserhalb` heißt, dieser Körper
						 * liegt vor der Rahmenkante und gehört zu dem
						 * gleichnamigen Körper ohne diesen Zusatz. Welche
						 * Körper betroffen sind, steht auch als
						 * `kreuzt_rahmen` in `daten/koerper.json`.
						 */
						modell_namenszusaetze: {
							_hoehe_geschaetzt: 'Height from the number of storeys or assumed, not measured',
							_ausserhalb: 'Part outside the frame edge, belongs to the body of the same name without this suffix'
						},
						/**
						 * Materialien zum Modell, neu seit Oktober 2026 und
						 * deshalb gleich mit englischen Namen. `building_outside`
						 * trägt jeder Körper mit `_ausserhalb`; das Gelände ist
						 * mit der Aufsicht ohne Bauten belegt.
						 */
						material: {
							file: 'model.mtl',
							names: {
								building: 'Buildings inside the frame',
								building_outside: 'Parts outside the frame edge',
								terrain: 'Terrain mesh'
							},
							...(z.gelaendeJetzt
								? { terrain_texture: 'model_texture.png',
									terrain_texture_style: 'top_view_bare, PNG, covers exactly the frame' }
								: {})
						},
						zeichnung: 'zeichnung.dxf',
						// Verlustfreies WebP, an allen Darstellungen gegen PNG
						// geprüft: null abweichende Farbkanäle, 56 Prozent
						// kleiner. Ein Plan ist große einfarbige Flächen mit
						// harten Kanten, und darin ist WebP stark.
						bildformat: 'image/webp, lossless',
						bilder: struktur.bilder,
						daten: struktur.daten
					}
				}
				: {
					koerper: koerperliste(),
					netz: z.netz,
					nutzflaechen: z.nutzflaechen,
					pois: z.pois,
					haltestellen: z.haltestellen,
					linien: z.linien,
					rest: z.rest
				})
		}));
	}

	async function ausgeben(art: 'bild' | 'dxf' | 'obj' | 'baeume' | 'vertrag' | 'paket') {
		if (!r) return;
		arbeitet = art;
		// Ohne diese Zeile bliebe die Beschriftung stehen: das Zeichnen von
		// 4096 auf 3072 Pixel laeuft synchron und kaeme der Anzeige zuvor.
		await anstrich();
		try {
			// Ein Rahmen, der sich seit dem Einschalten geändert hat, braucht ein neues Raster.
			if (z.gelaende && !z.gelaendeJetzt) await z.gelaendeHolen();
			const basis = `nolli_${(z.ort?.name ?? 'rahmen').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}_${stempel()}`;
			if (art === 'bild') {
				const b = raeumlich && raum
					? await raum.alsBild(r.pixelBreite, r.pixelHoehe)
					: await bild(z.objekte, r, z.darstellung, z.bereinigt, z.beschriftung, z.plangebiet, z.sichtbar,
						false, 'image/png', z.baeume ? z.baumpunkte : undefined);
				laden(b, `${basis}_${darstellungV2(z.darstellung)}_${r.pixelBreite}px.png`, 'image/png');
			} else if (art === 'dxf') {
				laden(dxf(z.objekte, r, z.gelaendeJetzt), `${basis}.dxf`, 'application/dxf');
			} else if (art === 'obj') {
				laden(obj(z.objekte, r, z.gelaendeJetzt), `${basis}.obj`, 'model/obj');
			} else if (art === 'baeume') {
				laden(baeumeAlsObj(z.baumpunkte, r, z.gelaendeJetzt), `${basis}_trees.obj`, 'model/obj');
			} else if (art === 'paket') {
				laden(await paketSchnueren(basis), `${basis}.zip`, 'application/zip');
			} else {
				const v = vertragJetzt(basis);
				laden(JSON.stringify(v, null, 2), `${basis}_frame.json`, 'application/json');
			}
		} catch (e) {
			z.fehler = e instanceof Error ? e.message : t().ausgeben.fehlgeschlagen;
		} finally { arbeitet = null; }
	}
</script>

{#snippet meldung()}
	{#if z.fehler}
		<p class="fehler" role="alert">
			<span>{z.fehler}</span>
			<button type="button" onclick={() => (z.fehler = null)} aria-label={t().meldungSchliessen}>×</button>
		</p>
	{/if}
{/snippet}

<svelte:head><title>Nolli</title></svelte:head>

<div class="werk">
	<header class="kopf">
		<h1>nolli</h1>

		<nav class="schritte" aria-label={t().kopf.schritteLabel}>
			{#each SCHRITTE as n}
				<button
					type="button"
					class="schritt"
					class:jetzt={z.schritt === n}
					disabled={n > 1 && !z.datenAktuell}
					onclick={() => (z.schritt = n)}
					title={n > 1 && !z.datenAktuell ? t().kopf.erstRahmen : t().schritte[n].was}
				>
					<span class="ziffer mono">{n}</span>{t().schritte[n].name}
				</button>
			{/each}
		</nav>

		<a class="anleitung" href="https://github.com/yougop/nolli#readme" target="_blank" rel="noopener"
			title={t().kopf.anleitungTitel}>{t().kopf.anleitung}</a>

		<div class="sprachen" role="group" aria-label={t().kopf.sprache}>
			<button type="button" class:an={sprache.jetzt === 'de'} lang="de" onclick={() => spracheSetzen('de')}>DE</button>
			<button type="button" class:an={sprache.jetzt === 'en'} lang="en" onclick={() => spracheSetzen('en')}>EN</button>
		</div>

		<button class="schema" type="button" onclick={schemaWechseln} aria-label={t().kopf.schema}>
			{#if schema === 'hell'}
				<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z" stroke-linejoin="round" />
				</svg>
			{:else}
				<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="10" cy="10" r="3.6" />
					<path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4" stroke-linecap="round" />
				</svg>
			{/if}
		</button>
	</header>

	<main class="flaeche">
		<section class="werkflaeche">
			{#if z.schritt > 1}
				<div class="sichtleiste">
					<div class="gruppe" role="group" aria-label={t().sicht.darstellung}>
						{#each DARSTELLUNGEN as d}
							<!-- Datentiefe und 3D-Modell stehen abgesetzt: Das eine ist eine
							     Auskunft über die Daten statt ein Plan, im anderen kann man
							     nicht auswählen. -->
							<button type="button" class:an={z.darstellung === d.id}
								class:abgesetzt={d.id === 'datentiefe'}
								onclick={() => (z.darstellung = d.id)} title={t().darstellungen[d.id].zweck}>{t().darstellungen[d.id].name}</button>
						{/each}
					</div>
					<button type="button" class="einzeln" class:an={z.beschriftung} disabled={raeumlich}
						onclick={() => (z.beschriftung = !z.beschriftung)}
						title={t().sicht.beschriftungTitel}
					>{t().sicht.beschriftung}</button>
					<!--
						Anders als die Beschriftung gilt dieser Schalter auch im Modell: Dort
						stehen die Kronen als Körper. Ein Schalter, der beim Wechsel der
						Darstellung stumm wird, lässt den Zustand stehen, den er zuletzt
						hatte, und man kann ihn genau dort nicht mehr ändern, wo man ihn
						sieht. Schrift dagegen gibt es im Modell nicht, deshalb bleibt
						„Beschriftung" dort aus.
					-->
					<button type="button" class="einzeln" class:an={z.baeume}
						disabled={!z.baumpunkte.length}
						onclick={() => (z.baeume = !z.baeume)}
						title={z.baumpunkte.length
							? (raeumlich
								? t().sicht.baeumeRaum(z.baumpunkte.length)
								: t().sicht.baeumeFlach(z.baumpunkte.length))
							: t().sicht.keineBaeume}
					>{t().sicht.baeume}</button>
					<!--
						Das Gelände ist nur im 3D-Modell zu sehen; die flachen Darstellungen
						sind Aufsichten und kennen keine Höhe. Dort ist der Schalter aus und
						gesperrt, wie die Beschriftung im 3D-Modell. Der gewählte Zustand
						bleibt dabei stehen, denn er gilt auch für das Paket — Höhenlinien
						und Geländenetz kommen mit, gleich in welcher Ansicht man ausgibt.
					-->
					<button type="button" class="einzeln" class:an={z.gelaende && raeumlich}
						disabled={!raeumlich || !!z.gelaendeLaedt}
						onclick={() => z.gelaendeUmschalten()}
						title={!raeumlich
							? t().gelaende.titelFlach(z.gelaende)
							: z.gelaendeJetzt && gelaendeFeld
							? t().gelaende.titelAn(f0(gelaendeFeld.min), f0(gelaendeFeld.max), z.gelaendeJetzt.quellen.join(', ') || 'AWS Terrain Tiles')
							: t().gelaende.titelAus}
					>{z.gelaendeLaedt ? t().gelaende.laedt(z.gelaendeLaedt) : t().gelaende.schalter}</button>
					{#if raeumlich}
						<div class="gruppe rechts" role="group" aria-label={t().sicht.ansicht}>
							<button type="button" onclick={() => raum?.zuruecksetzen()}>{t().sicht.zuruecksetzen}</button>
						</div>
					{:else}
						<div class="gruppe rechts" role="group" aria-label={t().sicht.ansicht}>
							<button type="button" onclick={() => z.zoomStufe(1 / 1.5)} disabled={z.zoom <= 1} aria-label={t().sicht.heraus}>−</button>
							<button type="button" onclick={() => z.einpassen()} disabled={z.zoom === 1}>
								{z.zoom === 1 ? t().sicht.ganz : z.zoom.toFixed(1) + '×'}
							</button>
							<button type="button" onclick={() => z.zoomStufe(1.5)} disabled={z.zoom >= z.MAXZOOM} aria-label={t().sicht.hinein}>+</button>
						</div>
					{/if}
				</div>
			{/if}
			<div class="buehne" class:karte={z.schritt === 1}>
				{#if z.schritt === 1}
					<Karte bind:this={karte} {schema} />
				{:else if raeumlich}
					<Raum bind:this={raum} {schema} />
				{:else}
					<Blatt waehlbar={z.schritt === 2} />
				{/if}
			</div>
		</section>

		<aside class="schiene">
			{#if z.schritt === 1}
				<div class="teil">
					<label class="feld" for="suchfeld">{t().rahmen.ort}</label>
					<div class="suchzeile">
						<input
							id="suchfeld" type="search" bind:value={suche} oninput={suchen}
							placeholder={t().rahmen.suche} autocomplete="off"
						/>
						{#if suchtGerade}<span class="puls" aria-hidden="true"></span>{/if}
					</div>
					{#if treffer.length}
						<ul class="treffer">
							{#each treffer as t}
								<li><button type="button" onclick={() => ortNehmen(t)}>
									<strong>{t.name}</strong><span>{t.wo}</span>
								</button></li>
							{/each}
						</ul>
					{/if}
					<!-- Zum Ausprobieren, ohne die gespendete Auskunft zu bemühen. -->
					<p class="beispiele">
						{t().rahmen.losLegen}
						<button type="button" disabled={z.laden}
							onclick={() => z.beispielLaden('hafencity')}>HafenCity</button>
						<button type="button" disabled={z.laden}
							onclick={() => z.beispielLaden('holstenareal')}>Holstenareal</button>
					</p>
				</div>

				<div class="teil">
					<span class="feld">{t().rahmen.verhaeltnis}</span>
					<div class="wahl">
						{#each VERHAELTNISSE as v}
							<button type="button" class:an={z.verhaeltnis.name === v.name}
								onclick={() => z.setzeVerhaeltnis(v)}>{v.name === 'frei' ? t().rahmen.frei : v.name}</button>
						{/each}
					</div>
					<span class="feld">{t().rahmen.ausgabebreite}</span>
					<div class="wahl">
						{#each AUSGABEBREITEN as b}
							<button type="button" class:an={z.ausgabeBreite === b}
								onclick={() => (z.ausgabeBreite = b)}>{b === 4096 ? '4K' : b === 3840 ? 'UHD' : '2K'}<em class="mono">{b}</em></button>
						{/each}
					</div>
				</div>

				<div class="teil messung">
					{#if r}
						<dl>
							<div class="gross"><dt>{t().rahmen.breite}</dt><dd class="mono">{f0(r.breiteM)} m</dd></div>
							<div class="gross"><dt>{t().rahmen.hoehe}</dt><dd class="mono">{f0(r.hoeheM)} m</dd></div>
							<div><dt>{t().rahmen.flaeche}</dt><dd class="mono">{f1(r.flaecheHa)} ha</dd></div>
							<div><dt>{t().rahmen.ausgabe}</dt><dd class="mono">{r.pixelBreite} × {r.pixelHoehe}</dd></div>
							<div class:mahnt={!r.traegt}><dt>{t().rahmen.mpp}</dt><dd class="mono">{r.mpp.toFixed(3)}</dd></div>
							<div class:mahnt={!r.traegt}><dt>{t().rahmen.tiefe12}</dt><dd class="mono">{Math.round(r.pruefpixel)} px</dd></div>
						</dl>
						<p class="urteil" class:mahnt={!r.traegt}>
							{#if r.traegt}
								{t().rahmen.traegt(Math.round(r.pruefpixel))}
							{:else}
								{t().rahmen.zuGrob}
							{/if}
						</p>
					{:else}
						<p class="leer">{t().rahmen.leer}</p>
					{/if}
				</div>

				{#if r}
					{@const g = r.google()}
					<div class="teil">
						<span class="feld">{t().rahmen.ortAnsehen}</span>
						<ul class="verweise">
							<li><a href={g.luftbild} target="_blank" rel="noopener">{t().rahmen.luftbild}</a></li>
							<li><a href={g.strassenansicht} target="_blank" rel="noopener">{t().rahmen.strassenansicht}</a></li>
							<li><a href={g.gelaende} target="_blank" rel="noopener">{t().rahmen.gelaende}</a></li>
							<li><a href={g.erde} target="_blank" rel="noopener">Google Earth</a></li>
						</ul>
						<p class="koordinate mono">{g.mitte}</p>
						<p class="hinweis leise">
							{t().rahmen.googleHinweis(g.zoom)}
						</p>
					</div>
				{/if}

				<div class="fuss">
					{@render meldung()}
					<button class="haupt" class:arbeitet={z.laden} type="button" disabled={!r || z.laden} onclick={async () => { await z.holen(); if (z.datenAktuell) z.schritt = 2; }}>
						<span class="ring" aria-hidden="true"></span>
						{z.laden
							? (z.fortschritt || t().rahmen.holt) + ' …'
							: z.datenAktuell ? t().rahmen.erneut : t().rahmen.holen}
					</button>
				</div>

			{:else if z.schritt === 2}
				<div class="teil">
					<span class="feld">{t().bereinigen.ebenen}</span>
					<ul class="ebenen">
						{#each STIFTE.filter((s) => !['rahmen', 'gestrichen'].includes(s.id)) as s}
							{@const n = zaehler.get(s.id) ?? 0}
							<li>
								<button
									type="button" class:aus={!z.sichtbar.has(s.id)} disabled={!n && s.id !== 'plangebiet'}
									onclick={() => z.umschalten(s.id)}
									onpointerenter={() => (z.hervorgehoben = s.id)}
									onpointerleave={() => (z.hervorgehoben = null)}
								>
									<span class="probe" style:background={s.fuellung ? (schema === 'dunkel' ? s.dunkel : s.hell) : 'transparent'}
										style:border-color={schema === 'dunkel' ? s.dunkel : s.hell}></span>
									<span class="ebname">{t().stifte[s.id]}</span>
									<em class="mono">{s.mm.toFixed(2)}</em>
									<span class="anzahl mono">{n}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>

				{#if raeumlich}
					<div class="teil">
						<span class="feld">{t().bereinigen.auswahl3d}</span>
						<p class="hinweis">
							{t().bereinigen.auswahl3dText}
						</p>
						<p class="hinweis leise">
							{t().bereinigen.auswahl3dLeise}
						</p>
						<dl class="buch">
							<div><dt>{t().bereinigen.gestrichen}</dt><dd class="mono">{z.gestrichene}</dd></div>
							<div><dt>{t().bereinigen.erhalt}</dt><dd class="mono">{z.erhaltene}</dd></div>
						</dl>
					</div>
				{:else}

				<div class="teil">
					<span class="feld">{t().bereinigen.werkzeug}</span>
					<div class="wahl">
						<button type="button" class:an={z.werkzeug === 'zeigen'}
							onclick={() => z.polygonAbbrechen()}>{t().bereinigen.zeigen}</button>
						<button type="button" class:an={z.werkzeug === 'polygon'}
							onclick={() => (z.werkzeug = 'polygon')}>{t().bereinigen.polygon}</button>
					</div>
					{#if z.werkzeug === 'polygon'}
						<p class="hinweis">
							{t().bereinigen.polygonHinweis(z.fanglinie.length)}
						</p>
						<div class="tatzeile">
							<button type="button" disabled={z.fanglinie.length < 3}
								onclick={() => z.auswahlAusPolygon()}>{t().bereinigen.auswaehlen}</button>
							<button type="button" disabled={z.fanglinie.length < 3}
								onclick={() => z.alsPlangebiet()}>{t().bereinigen.alsPlangebiet}</button>
							<button type="button" disabled={!z.fanglinie.length}
								onclick={() => z.polygonAbbrechen()}>{t().bereinigen.abbrechen}</button>
						</div>
					{:else}
						<p class="hinweis leise">
							{t().bereinigen.einzelnHinweis}
						</p>
					{/if}
				</div>

				<div class="teil">
					<span class="feld">{t().bereinigen.auswahl}</span>
					<p class="hinweis">
						{#if z.ausgewaehlt.size}
							{t().bereinigen.gewaehlt(z.ausgewaehlt.size)}
						{:else}
							{t().bereinigen.nichts}
						{/if}
					</p>
					<div class="tatzeile">
						<button type="button" disabled={!z.ausgewaehlt.size} onclick={() => z.zustandSetzen('gestrichen')}>{t().bereinigen.streichen}</button>
						<button type="button" disabled={!z.ausgewaehlt.size} onclick={() => z.zustandSetzen('erhalt')}>{t().bereinigen.erhalten}</button>
						<button type="button" disabled={!z.ausgewaehlt.size} onclick={() => z.zustandSetzen('normal')}>{t().bereinigen.zurueck}</button>
					</div>
					<div class="tatzeile zweite">
						<button type="button" disabled={!z.objekte.length} onclick={() => z.auswahlUmkehren()}>{t().bereinigen.umkehren}</button>
						<button type="button" disabled={!z.ausgewaehlt.size} onclick={() => (z.ausgewaehlt = new Set())}>{t().bereinigen.aufheben}</button>
					</div>
					<dl class="buch">
						<div><dt>{t().bereinigen.gestrichen}</dt><dd class="mono">{z.gestrichene}</dd></div>
						<div><dt>{t().bereinigen.erhalt}</dt><dd class="mono">{z.erhaltene}</dd></div>
					</dl>
					{#if z.gestrichene || z.erhaltene}
						<div class="tatzeile zweite">
							<button type="button" onclick={() => z.alleZuruecksetzen()}>{t().bereinigen.allesZurueck}</button>
						</div>
					{/if}
				</div>

				<div class="teil">
					<span class="feld">{t().bereinigen.sichtbarkeit}</span>
					<div class="wahl">
						<button type="button" class:an={!z.bereinigt} onclick={() => (z.bereinigt = false)}>
							{t().bereinigen.zeigeGestrichen}
						</button>
						<button type="button" class:an={z.bereinigt} onclick={() => (z.bereinigt = true)}>
							{t().bereinigen.ausblenden}
						</button>
					</div>
					<p class="hinweis leise">
						{t().bereinigen.sichtbarkeitHinweis}
					</p>
				</div>

				{/if}

				{#if z.plangebiet}
					<div class="teil">
						<span class="feld">{t().bereinigen.plangebiet}</span>
						<dl class="buch">
							<div><dt>{t().bereinigen.umriss}</dt><dd class="mono">{t().bereinigen.punkte(z.plangebiet.length)}</dd></div>
							{#if z.beschnitten}
								<div><dt>{t().bereinigen.beschnitten}</dt><dd class="mono">{z.beschnitten}</dd></div>
							{/if}
						</dl>
						<div class="tatzeile zweite">
							<button type="button" onclick={raeumen}>{t().bereinigen.freiraeumen}</button>
							<button type="button" onclick={() => z.plangebietLoeschen()}>{t().bereinigen.loeschen}</button>
						</div>
						{#if geraeumt}
							<p class="hinweis">
								{t().bereinigen.geraeumt(geraeumt.flaechen, geraeumt.linien)}
							</p>
						{/if}
						<p class="hinweis leise">
							{t().bereinigen.freiraeumenHinweis}
						</p>
					</div>
				{/if}

				{#if deckung.gesamt}
					<div class="teil">
						<span class="feld">{t().bereinigen.daten}</span>
						<dl class="buch">
							<div><dt>{t().bereinigen.gebaeude}</dt><dd class="mono">{deckungHaeuser.gesamt}</dd></div>
							{#if deckung.gesamt > deckungHaeuser.gesamt}
								<!-- Getrennt, weil ein Gebäudeteil kein weiteres Haus ist: Er liegt
								     in seinem Gebäude. Zusammengezählt wären Häuser doppelt. -->
								<div><dt>{t().bereinigen.teile}</dt><dd class="mono">{deckung.gesamt - deckungHaeuser.gesamt}</dd></div>
							{/if}
							<!-- Als Zahl, nicht als Anteil. Bei 5 von 1.990 ist „fünf" die
							     Aussage und „0 %" die Nachkommastelle, hinter der sie verschwindet.
							     Ohne die Teile gezählt: Die tragen fast immer eine Höhe und
							     ließen die Erfassung besser aussehen, als sie ist. -->
							<div><dt>{t().bereinigen.mitHoehe}</dt><dd class="mono">{t().bereinigen.von(deckungHaeuser.echt, deckungHaeuser.gesamt)}</dd></div>
							<div><dt>{t().bereinigen.mitAdresse}</dt><dd class="mono">{mitAdresse}</dd></div>
							{#if denkmale}<div><dt>{t().bereinigen.denkmal}</dt><dd class="mono">{denkmale}</dd></div>{/if}
						</dl>
						<p class="hinweis leise">
							{t().bereinigen.hoehenHinweis}{#if deckung.gesamt > deckungHaeuser.gesamt}{' '}
								{t().bereinigen.teileHinweis}{/if}
						</p>
						<dl class="buch">
							<div><dt>{t().bereinigen.netz}</dt><dd class="mono">{t().bereinigen.kanten(z.netz?.kanten.length ?? 0)}</dd></div>
							<div><dt>{t().bereinigen.punkteZeile}</dt><dd class="mono">{z.pois.length}</dd></div>
							<div><dt>{t().bereinigen.haltestellen}</dt><dd class="mono">{z.haltestellen.length}</dd></div>
							<div><dt>{t().bereinigen.baeume}</dt><dd class="mono">{z.baumpunkte.length}</dd></div>
							<div><dt>{t().bereinigen.nutzflaechen}</dt><dd class="mono">{z.nutzflaechen.length}</dd></div>
							<div><dt>{t().bereinigen.uebriges}</dt><dd class="mono">{z.rest.length}</dd></div>
						</dl>
						<p class="hinweis leise">
							{t().bereinigen.allesHinweis}
						</p>
						{#if (zaehler.get('bau') ?? 0) > 0}
							<dl class="buch">
								<div><dt>{t().bereinigen.baustellen}</dt><dd class="mono">{zaehler.get('bau')}</dd></div>
							</dl>
							<p class="hinweis leise">
								{t().bereinigen.baustellenHinweis}
							</p>
						{/if}
					</div>
				{/if}

				<div class="fuss">
					{@render meldung()}
					<button class="haupt" type="button" onclick={() => (z.schritt = 3)}>
						<span class="ring" aria-hidden="true"></span>{t().bereinigen.weiter}
					</button>
				</div>

			{:else}
				<div class="teil">
					<span class="feld">{t().ausgeben.bild}</span>
					<dl class="buch">
						<div class="gross"><dt>{t().ausgeben.darstellung}</dt><dd>{t().darstellungen[darstellungJetzt.id].name}</dd></div>
						<div><dt>{t().ausgeben.beschriftung}</dt><dd class="mono">{z.beschriftung ? t().ausgeben.ja : t().ausgeben.nein}</dd></div>
						<div><dt>{t().ausgeben.baeume}</dt><dd class="mono">{z.baeume ? t().ausgeben.jaN(z.baumpunkte.length) : t().ausgeben.nein}</dd></div>
						<div><dt>{t().gelaende.zeile}</dt><dd class="mono">{gelaendeFeld ? t().gelaende.spanne(f0(gelaendeFeld.min), f0(gelaendeFeld.max)) : t().gelaende.eben}</dd></div>
						<div><dt>{t().ausgeben.groesse}</dt><dd class="mono">{r?.pixelBreite} × {r?.pixelHoehe}</dd></div>
					</dl>
					<p class="hinweis leise">
						{t().darstellungen[darstellungJetzt.id].zweck}
						{#if hoehenAbstand}
							<br />{t().gelaende.hinweis(hoehenAbstand)}
						{/if}
						{#if z.beschriftung}
							<br />{t().ausgeben.beschriftungHinweis}
						{/if}
					</p>
				</div>

				<div class="teil">
					<span class="feld">{t().ausgeben.weitere}</span>
					<ul class="ausgaben">
						<li><button type="button" disabled={!!arbeitet} onclick={() => ausgeben('paket')}>
							<strong>{t().ausgeben.paket}</strong><em class="mono">
								{arbeitet?.startsWith('paket') ? arbeitet.slice(6) + ' …' : t().ausgeben.paketZeile(paketdateien)}
							</em>
							<span>{t().ausgeben.paketWas}</span>
						</button></li>
						<li><button type="button" disabled={!!arbeitet} onclick={() => ausgeben('dxf')}>
							<strong>{t().ausgeben.zeichnung}</strong><em class="mono">{arbeitet === 'dxf' ? t().ausgeben.schreibt : t().ausgeben.zeichnungZeile(STIFTE.length + 1 + (z.gelaendeJetzt ? 2 : 0))}</em>
							<span>{t().ausgeben.zeichnungWas}</span>
						</button></li>
						<li><button type="button" disabled={!!arbeitet} onclick={() => ausgeben('obj')}>
							<strong>{t().ausgeben.modell}</strong><em class="mono">{arbeitet === 'obj' ? t().ausgeben.schreibt : t().ausgeben.modellZeile(deckung.gesamt)}</em>
							<span>{t().ausgeben.modellWas}</span>
						</button></li>
						<li><button type="button" disabled={!!arbeitet || !imRahmenBaeume}
							onclick={() => ausgeben('baeume')}>
							<strong>{t().ausgeben.kronen}</strong><em class="mono">{arbeitet === 'baeume' ? t().ausgeben.schreibt : t().ausgeben.kronenZeile(imRahmenBaeume)}</em>
							<span>{t().ausgeben.kronenWas(BAUM.stammhoeheM)}</span>
						</button></li>
						<li><button type="button" disabled={!!arbeitet} onclick={() => ausgeben('vertrag')}>
							<strong>{t().ausgeben.vertrag}</strong><em class="mono">{arbeitet === 'vertrag' ? t().ausgeben.schreibt : 'JSON'}</em>
							<span>{t().ausgeben.vertragWas}</span>
						</button></li>
					</ul>
				</div>

				{#if r}
					<div class="teil">
						<span class="feld">frame.json</span>
						<pre class="vertrag mono">{JSON.stringify(vertragV2(r.vertrag({ objekte: z.objekte.length, gestrichen: z.gestrichene, erhalt: z.erhaltene })), null, 1)}</pre>
					</div>
				{/if}

				<div class="fuss">
					{@render meldung()}
					<button
						class="haupt" class:arbeitet={!!arbeitet} type="button" disabled={!r || !!arbeitet}
						onclick={() => ausgeben('bild')}
					>
						<span class="ring" aria-hidden="true"></span>
						{arbeitet === 'bild'
							? t().ausgeben.zeichnet
							: t().ausgeben.bildAusgeben(r?.pixelBreite ?? 0, r?.pixelHoehe ?? 0)}
					</button>
				</div>
			{/if}
		</aside>
	</main>

	<footer class="zeile mono">
		{#if r}
			<span title={t().fuss.gitterTitel}>
				{t().fuss.gitter(r.gitter.lon0.toFixed(4))}
			</span>
			<span>{r.mpp.toFixed(3)} m/px</span>
			<span>{t().fuss.aufA1(f0(r.massstabA1))}</span>
			<span title={t().fuss.nordTitel}>
				{t().fuss.nord(Math.abs(r.konvergenz) < 0.005 ? '0' : Math.abs(r.konvergenz).toFixed(3))}
			</span>
			<span>{t().fuss.objekte(z.objekte.length)}</span>
			{#if z.gesichert}
				<span title={t().fuss.gesichertTitel}>
					{t().fuss.gesichert(uhrzeit(z.gesichert))}
				</span>
			{/if}
		{:else}
			<span>{t().fuss.keinRahmen}</span>
		{/if}
		<span class="recht">
			{t().fuss.osm}{#if z.schritt === 1}{' · '}{t().fuss.kacheln(z.kartenquelle === 'ohne' ? t().fuss.keine : 'OpenFreeMap')}{/if}
		</span>
	</footer>
</div>

<style>
	.werk {
		display: grid;
		grid-template-rows: var(--kopf) minmax(0, 1fr) var(--fuss);
		height: 100dvh;
	}

	/* ---------- Kopf ---------- */
	.kopf {
		display: flex; align-items: center; gap: 24px;
		padding: 0 18px;
		border-bottom: 1px solid var(--linie);
		background: var(--blatt);
	}
	h1 { font-size: 15px; letter-spacing: -0.03em; white-space: nowrap; }

	.schritte { display: flex; gap: 2px; margin-inline: auto; }
	.schritt {
		display: flex; align-items: center; gap: 8px;
		padding: 6px 13px 6px 9px; cursor: pointer;
		font-size: 13px; font-weight: 500;
		background: transparent; color: var(--tinte-2);
		border: 1px solid transparent; border-radius: var(--rund);
		transition: color 120ms, background 120ms;
	}
	.schritt:hover:not(:disabled) { color: var(--tinte); background: var(--senke); }
	.schritt.jetzt { color: var(--tinte); background: var(--senke); border-color: var(--linie); }
	.schritt:disabled { color: var(--tinte-3); cursor: not-allowed; }
	.ziffer {
		display: grid; place-items: center;
		width: 18px; height: 18px; font-size: 10px;
		border: 1px solid var(--linie-stark); border-radius: 50%;
		color: var(--tinte-2);
	}
	.schritt.jetzt .ziffer { background: var(--tinte); border-color: var(--tinte); color: var(--blatt); }

	.anleitung {
		font-size: 12px; color: var(--tinte-2); white-space: nowrap;
		text-decoration: none;
	}
	.anleitung:hover { color: var(--tinte); text-decoration: underline; text-underline-offset: 3px; }

	.sprachen { display: flex; }
	.sprachen button {
		padding: 5px 8px; cursor: pointer;
		font-size: 11px; font-weight: 500; letter-spacing: 0.04em;
		background: transparent; color: var(--tinte-3);
		border: 1px solid var(--linie);
	}
	.sprachen button:first-child { border-radius: var(--rund) 0 0 var(--rund); }
	.sprachen button:last-child { border-radius: 0 var(--rund) var(--rund) 0; border-left: 0; }
	.sprachen button:hover { color: var(--tinte); }
	.sprachen button.an { color: var(--tinte); background: var(--senke); }

	.schema {
		display: grid; place-items: center;
		width: 30px; height: 30px; cursor: pointer;
		background: transparent; color: var(--tinte-2);
		border: 1px solid var(--linie); border-radius: var(--rund);
	}
	.schema:hover { color: var(--tinte); border-color: var(--linie-stark); }

	/* ---------- Fläche ---------- */
	.flaeche { display: grid; grid-template-columns: minmax(0, 1fr) var(--schiene); min-height: 0; }
	/* Spalte statt Raster: In Schritt 1 fehlt die Sichtleiste, und ein Raster
	   mit zwei Zeilen haette die Buehne dann in die erste Zeile gesetzt, die
	   auf auto steht. Da die Buehne ihre Hoehe aus nichts bezieht, fiele sie
	   auf null zusammen und die Karte waere unsichtbar. */
	.werkflaeche { display: flex; flex-direction: column; min-height: 0; }
	.werkflaeche > .buehne { flex: 1; min-height: 0; }

	/* Sichtleiste: gehört zur Ansicht, liegt aber über ihr statt darauf,
	   damit sie das Blatt nicht verdeckt. */
	.sichtleiste {
		display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
		padding: 7px 14px;
		background: var(--blatt); border-bottom: 1px solid var(--linie);
	}
	.sichtleiste .gruppe { display: flex; }
	.sichtleiste .gruppe.rechts { margin-left: auto; }
	.sichtleiste button {
		padding: 5px 10px; cursor: pointer;
		font-size: 12px; font-weight: 500;
		background: var(--grund); color: var(--tinte-2);
		border: 1px solid var(--linie);
		transition: color 120ms, background 120ms;
	}
	.sichtleiste .gruppe button:first-child { border-radius: var(--rund) 0 0 var(--rund); }
	.sichtleiste .gruppe button:last-child { border-radius: 0 var(--rund) var(--rund) 0; }
	.sichtleiste .gruppe button + button { border-left: 0; }
	.beispiele {
		display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px;
		margin: 10px 0 0; font-size: 12px; color: var(--tinte-3);
	}
	.beispiele button {
		padding: 3px 8px; cursor: pointer; font-size: 12px;
		background: var(--grund); color: var(--tinte-2);
		border: 1px solid var(--linie); border-radius: var(--rund);
	}
	.beispiele button:hover:not(:disabled) { color: var(--tinte); }
	.beispiele button:disabled { opacity: 0.42; cursor: default; }

	.sichtleiste .einzeln { border-radius: var(--rund); }
	/* Das 3D-Modell steht für sich, mit einer Lücke vor sich und eigenen Ecken. */
	.sichtleiste .gruppe button.abgesetzt {
		margin-left: 6px; border-left: 1px solid var(--linie); border-radius: var(--rund);
	}
	.sichtleiste .gruppe button.abgesetzt.an { border-left-color: var(--tinte); }
	.sichtleiste .gruppe button:has(+ .abgesetzt) { border-radius: 0 var(--rund) var(--rund) 0; }
	.sichtleiste button:hover:not(:disabled) { color: var(--tinte); }
	.sichtleiste button:disabled { opacity: 0.42; cursor: default; }
	.sichtleiste button.an { background: var(--tinte); border-color: var(--tinte); color: var(--blatt); }
	.sichtleiste .gruppe.rechts button { min-width: 44px; font-family: var(--mono); }

	.buehne { position: relative; background: var(--radial); overflow: hidden; }
	.buehne.karte { background: var(--senke); }
	/* Mikrostruktur: das Feld um das Blatt soll eine Oberflaeche sein, keine leere Flaeche */
	.buehne:not(.karte)::before {
		content: '';
		position: absolute; inset: 0; z-index: 0;
		background-image: var(--korn);
		opacity: var(--korn-deckung);
		pointer-events: none;
	}

	.schiene {
		display: flex; flex-direction: column;
		border-left: 1px solid var(--linie);
		background: var(--blatt);
		overflow-y: auto;
		/* Schattenkante oben, sobald weggescrollt wurde. Ohne sie sieht der
		   Nutzer auf flachen Schirmen nicht, dass oben etwas fehlt. */
		background-image:
			linear-gradient(var(--blatt) 30%, transparent),
			linear-gradient(180deg, rgba(17, 17, 17, 0.13), transparent);
		background-repeat: no-repeat;
		background-position: top, top;
		background-size: 100% 22px, 100% 9px;
		background-attachment: local, scroll;
	}
	.teil { padding: 16px 18px; border-bottom: 1px solid var(--linie); }
	.fuss { margin-top: auto; padding: 16px 18px; position: sticky; bottom: 0; background: var(--blatt); border-top: 1px solid var(--linie); }

	.feld {
		display: block; margin-bottom: 9px;
		font-size: 10.5px; font-weight: 500; letter-spacing: 0.11em;
		text-transform: uppercase; color: var(--tinte-2);
	}

	/* ---------- Suche ---------- */
	.suchzeile { position: relative; }
	input[type='search'] {
		width: 100%; padding: 9px 11px;
		background: var(--grund); color: var(--tinte);
		border: 1px solid var(--linie); border-radius: var(--rund);
	}
	input[type='search']:focus { border-color: var(--linie-stark); outline-offset: 1px; }
	input[type='search']::placeholder { color: var(--tinte-3); }
	.puls {
		position: absolute; right: 11px; top: 50%; width: 6px; height: 6px; margin-top: -3px;
		border-radius: 50%; background: var(--akzent); animation: puls 900ms ease-in-out infinite;
	}
	@keyframes puls { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

	.treffer { list-style: none; margin: 7px 0 0; padding: 0; border: 1px solid var(--linie); border-radius: var(--rund); overflow: hidden; }
	.treffer li + li { border-top: 1px solid var(--linie); }
	.treffer button {
		display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left;
		padding: 8px 11px; cursor: pointer; background: transparent; border: 0;
	}
	.treffer button:hover { background: var(--senke); }
	.treffer strong { font-size: 13px; font-weight: 500; }
	.treffer span { font-size: 11.5px; color: var(--tinte-2); }

	/* ---------- Wahlreihen ---------- */
	.wahl { display: flex; gap: 4px; margin-bottom: 14px; }
	.wahl:last-child { margin-bottom: 0; }
	.wahl button {
		flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px;
		padding: 7px 4px; cursor: pointer; font-size: 12.5px; font-weight: 500;
		background: var(--grund); color: var(--tinte-2);
		border: 1px solid var(--linie); border-radius: var(--rund);
		transition: color 120ms, border-color 120ms;
	}
	.wahl button em { font-size: 9.5px; font-style: normal; color: var(--tinte-3); }
	.wahl button:hover { color: var(--tinte); border-color: var(--linie-stark); }
	.wahl button.an { background: var(--tinte); border-color: var(--tinte); color: var(--blatt); }
	.wahl button.an em { color: var(--linie-stark); }

	/* ---------- Messung ---------- */
	dl { margin: 0; }
	dl div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 6px 0; }
	dl div + div { border-top: 1px solid var(--linie); }
	dt { font-size: 12px; color: var(--tinte-2); }
	dd { margin: 0; font-size: 13px; font-weight: 500; }
	.gross dd { font-size: 19px; letter-spacing: -0.02em; }
	.mahnt dd, .mahnt dt { color: var(--warn); }

	.urteil {
		margin: 12px 0 0; padding: 9px 11px;
		font-size: 12px; line-height: 1.45; color: var(--tinte-2);
		background: var(--grund); border: 1px solid var(--linie); border-radius: var(--rund);
	}
	.urteil.mahnt { color: var(--warn); background: var(--warn-flor); border-color: transparent; }
	.leer { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--tinte-2); }

	.verweise { list-style: none; display: flex; flex-wrap: wrap; gap: 5px; margin: 0; padding: 0; }
	.verweise a {
		display: block; padding: 6px 10px;
		font-size: 12.5px; font-weight: 500; text-decoration: none;
		color: var(--tinte); background: var(--grund);
		border: 1px solid var(--linie); border-radius: var(--rund);
		transition: border-color 120ms;
	}
	.verweise a:hover { border-color: var(--linie-stark); }
	.koordinate {
		margin: 9px 0 0; font-size: 12px; color: var(--tinte-2);
		-webkit-user-select: all; user-select: all;
	}

	/* ---------- Ebenen ---------- */
	.ebenen { list-style: none; margin: 0; padding: 0; }
	.ebenen li + li { border-top: 1px solid var(--linie); }
	.ebenen button {
		display: grid; grid-template-columns: 14px 1fr auto auto; align-items: center; gap: 10px;
		width: 100%; padding: 7px 2px; cursor: pointer; text-align: left;
		background: transparent; border: 0; color: var(--tinte);
	}
	.ebenen button:hover:not(:disabled) { color: var(--tinte); }
	.ebenen button.aus { opacity: 0.38; }
	.ebenen button:disabled { opacity: 0.3; cursor: default; }
	.probe { width: 14px; height: 14px; border: 1.5px solid; border-radius: 2px; }
	.ebname { font-size: 12.5px; }
	.ebenen em { font-size: 10.5px; font-style: normal; color: var(--tinte-3); }
	.anzahl { font-size: 11.5px; color: var(--tinte-2); min-width: 34px; text-align: right; }

	/* ---------- Auswahl ---------- */
	.hinweis { margin: 0 0 10px; font-size: 12px; line-height: 1.45; color: var(--tinte-2); }
	.hinweis.leise { margin: 10px 0 0; color: var(--tinte-3); }
	.tatzeile { display: flex; gap: 4px; }
	.tatzeile.zweite { margin-top: 5px; }
	.tatzeile button {
		flex: 1; padding: 7px 4px; cursor: pointer; font-size: 12.5px; font-weight: 500;
		background: var(--grund); color: var(--tinte);
		border: 1px solid var(--linie); border-radius: var(--rund);
	}
	.tatzeile button:hover:not(:disabled) { border-color: var(--linie-stark); }
	.tatzeile button:disabled { color: var(--tinte-3); cursor: not-allowed; }
	.buch { margin-top: 12px; }
	.schalter { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 12.5px; cursor: pointer; }
	.schalter input { accent-color: var(--akzent-tief); }

	/* ---------- Ausgaben ---------- */
	.ausgaben { list-style: none; margin: 0; padding: 0; }
	.ausgaben li + li { margin-top: 6px; }
	.ausgaben button {
		display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; width: 100%; text-align: left;
		padding: 10px 12px; cursor: pointer;
		background: var(--grund); border: 1px solid var(--linie); border-radius: var(--rund);
		transition: border-color 120ms;
	}
	.ausgaben button:hover:not(:disabled) { border-color: var(--linie-stark); }
	.ausgaben button:disabled { opacity: 0.5; cursor: wait; }
	.ausgaben strong { font-size: 13px; font-weight: 500; }
	.ausgaben em { font-size: 10.5px; font-style: normal; color: var(--tinte-2); align-self: center; }
	.ausgaben span { grid-column: 1 / -1; font-size: 11.5px; color: var(--tinte-3); }

	.vertrag {
		margin: 0; padding: 10px 11px; max-height: 260px; overflow: auto;
		font-size: 10.5px; line-height: 1.5;
		background: var(--grund); border: 1px solid var(--linie); border-radius: var(--rund);
	}

	/* ---------- Hauptaktion ---------- */
	.haupt {
		display: flex; align-items: center; justify-content: center; gap: 9px;
		width: 100%; padding: 11px 14px; cursor: pointer;
		font-size: 13.5px; font-weight: 500;
		background: var(--tinte); color: var(--blatt);
		border: 1px solid var(--tinte); border-radius: var(--rund);
		transition: opacity 120ms;
	}
	.haupt:hover:not(:disabled) { opacity: 0.88; }
	/* Gesperrt heißt ausgegraut. Arbeitend heißt lesbar: die Beschriftung ist
	   das Einzige, was der Nutzer während des Wartens liest. */
	.haupt:disabled { opacity: 0.4; cursor: not-allowed; }
	.haupt.arbeitet:disabled { opacity: 1; cursor: progress; }
	.ring { width: 11px; height: 11px; border: 2px solid var(--akzent); border-radius: 50%; }
	.haupt.arbeitet .ring {
		border-top-color: transparent;
		animation: dreht 900ms linear infinite;
	}
	@keyframes dreht { to { transform: rotate(360deg); } }
	.fehler {
		display: flex; align-items: flex-start; gap: 10px;
		margin: 0 0 10px; padding: 10px 12px;
		font-size: 12.5px; line-height: 1.45; color: var(--warn);
		background: var(--warn-flor); border-radius: var(--rund);
	}
	.fehler span { flex: 1; }
	.fehler button {
		margin-left: auto; padding: 0 4px; cursor: pointer; line-height: 1;
		font-size: 17px; color: var(--warn);
		background: transparent; border: 0;
	}

	/* ---------- Statuszeile ---------- */
	.zeile {
		display: flex; align-items: center; gap: 20px;
		padding: 0 18px; font-size: 11px; color: var(--tinte-2);
		border-top: 1px solid var(--linie); background: var(--blatt);
	}
	.zeile .recht { margin-left: auto; color: var(--tinte-3); }

	/* Notebook-Schirme: dichter setzen. Es geht nichts verloren, die Zeilen
	   ruecken nur zusammen. */
	@media (max-height: 900px) {
		:root { --kopf: 50px; --fuss: 34px; }
		.sichtleiste { padding: 5px 12px; }
		.sichtleiste button { padding: 4px 9px; }
		.teil { padding: 11px 16px; }
		.fuss { padding: 12px 16px; }
		.feld { margin-bottom: 7px; }
		.ebenen button { padding: 5px 2px; }
		dl div { padding: 4px 0; }
		.gross dd { font-size: 17px; }
		.hinweis { margin-bottom: 8px; }
		.hinweis.leise { margin-top: 8px; }
		.urteil { margin-top: 9px; padding: 8px 10px; }
		.ausgaben button { padding: 8px 11px; }
		.vertrag { max-height: 190px; }
	}

	@media (max-width: 940px) {
		.werk { height: auto; min-height: 100dvh; }
		.flaeche { grid-template-columns: minmax(0, 1fr); }
		/* Die Buehne folgt dem Seitenverhaeltnis des Blattes, sonst steht oben
		   und unten totes Feld. Die Karte behaelt eine feste Hoehe. */
		.buehne { height: 56vh; }
		.schiene { border-left: 0; border-top: 1px solid var(--linie); }
		.kopf { flex-wrap: wrap; height: auto; padding-block: 10px; gap: 12px; }
		.werk { grid-template-rows: auto minmax(0, 1fr) var(--fuss); }
		.schritte { order: 3; width: 100%; margin-inline: 0; }
		.schritt { flex: 1; justify-content: center; }
		.anleitung { margin-left: auto; }
		.zeile { flex-wrap: wrap; gap: 8px 16px; padding-block: 9px; height: auto; }
		.zeile .recht { margin-left: 0; width: 100%; }
	}
</style>
