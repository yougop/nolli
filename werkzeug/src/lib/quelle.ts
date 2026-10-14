/**
 * Die beiden fremden Auskuenfte, direkt aus dem Browser.
 *
 * Frueher lief beides ueber eine eigene Serverroute. Das hatte zwei Nachteile,
 * sobald die App oeffentlich steht: Alle Anfragen kaemen von einer einzigen
 * Adresse, und Overpass ist eine Spende der Gemeinschaft, die auf
 * Gelegenheitsnutzung je Person ausgelegt ist. Ausserdem waere die Route ein
 * offener Weiterleiter, den jeder anzapfen kann.
 *
 * Beide Dienste erlauben Anfragen aus dem Browser
 * (`Access-Control-Allow-Origin: *`, am 14.09.2026 geprueft). Damit redet
 * jeder Besucher mit seiner eigenen Adresse, die App braucht keinen Server
 * mehr, und sie laesst sich als blosser Dateiordner ausliefern.
 */

import { t, sprache } from './sprache.svelte';

const SPIEGEL = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass.private.coffee/api/interpreter'
];

/**
 * Wie lange auf einen einzelnen Versuch gewartet wird und wie lange insgesamt.
 *
 * Ohne diese beiden Zahlen haengt der Knopf. Ein ueberlasteter Spiegel nimmt
 * die Verbindung an und antwortet dann minutenlang nicht; am 13.09.2026 lief
 * einer neunzig Sekunden ohne ein einziges Byte.
 */
const GEDULD_MS = 30000;
const FRIST_MS = 150000;

/**
 * Abgebrochen wird bei Stille, nicht bei Dauer.
 *
 * Seit die Abfrage alles holt, sind Antworten von fuenfzehn Megabyte normal.
 * Am 15.09.2026 beobachtet: overpass-api.de lieferte bereits 14,7 MB, als die
 * Frist von dreissig Sekunden zuschlug und den laufenden Abruf abwuergte —
 * danach wurden zwei tote Spiegel gefragt, und der Abruf schlug fehl, obwohl
 * er fast durch war.
 *
 * Die Frist gilt deshalb nur, bis der erste Ton kommt. Danach zaehlt, ob noch
 * etwas fliesst: Zwanzig Sekunden ohne ein Byte heisst abgestuerzt, eine
 * Minute stetiger Strom heisst eine grosse Antwort.
 */
const STILLE_MS = 20000;

/**
 * Wiederholen, wenn ein Spiegel schnell absagt.
 *
 * Am 14.09.2026 gemessen: overpass-api.de wies acht Anfragen hintereinander
 * ab, sieben mit einem Fehler nach rund fuenf Sekunden, die achte lief durch
 * und lieferte 4,5 Megabyte in dreieinhalb Sekunden. Der Dienst war also nicht
 * weg, sondern flatterte; ein einziger Versuch traf ihn in dieser Stunde in
 * etwa jedem achten Fall.
 *
 * Eine schnelle Absage kostet fast nichts und ist es wert, gleich noch einmal
 * versucht zu werden. Ein echtes Schweigen dagegen frisst die ganze Frist,
 * also wird ein Spiegel, der gar nicht antwortet, fuer diesen Aufruf fallen
 * gelassen.
 */
const VERSUCHE_JE_SPIEGEL = 3;
const SCHNELL_MS = 12000;
const PAUSE_MS = 1500;
/**
 * Obergrenze fuer den ganzen Aufruf.
 *
 * Eine schnelle Absage kostet den Spiegel wenig, aber nichts ist es nicht.
 * Ohne diese Grenze passten in die Frist ueber achtzig Anfragen; bei einer
 * Quelle, die von Spenden lebt, ist das kein Benehmen. Zwoelf reichen: Bei der
 * heute gemessenen Trefferquote von einem Achtel kommt man damit auf rund vier
 * von fuenf Faellen durch.
 */
const VERSUCHE_GESAMT = 12;

/**
 * Erstkontakt kurz halten, Geduld erst nach einem Lebenszeichen.
 *
 * Am 14.09.2026 gemessen: overpass.kumi.systems nahm die Verbindung an und
 * schickte danach kein einziges Byte, gleich wie lange man wartete. Zwei solche
 * Spiegel fressen sechzig der fuenfundneunzig Sekunden und nehmen dem einen
 * Spiegel, der ueberhaupt antwortet, die Wiederholungen weg. Genau daran ist
 * ein Aufruf gescheitert, der es nur auf sieben statt zwoelf Versuche brachte.
 *
 * Wer noch nie geantwortet hat, bekommt deshalb achtzehn Sekunden. Wer schon
 * einmal geantwortet hat, und sei es mit einer Absage, bekommt die volle
 * Geduld: Der ist erreichbar und darf fuer eine grosse Abfrage lange rechnen.
 */
const ERSTKONTAKT_MS = 18000;

/**
 * Welcher Spiegel zuletzt Daten geliefert hat.
 *
 * Ueber einen Besuch hinweg gemerkt und beim naechsten Mal zuerst gefragt.
 * Kostet nichts und spart im Stoerfall die Runde durch die stummen.
 */
let bewaehrt: string | null = null;

/**
 * Spiegel, die eben gar nicht geantwortet haben.
 *
 * Ein stummer Spiegel ist selten nur eine Sekunde stumm. Ihn bei jedem Aufruf
 * neu anzufragen kostet achtzehn Sekunden der Frist, und die fehlen dann dem
 * Spiegel, der ueberhaupt antwortet. Fuenf Minuten Schonfrist sind kurz genug,
 * dass eine Erholung nicht uebersehen wird.
 */
const stumm = new Map<string, number>();
const STUMM_MS = 300000;

/** Mindestabstand zwischen zwei Abfragen, aus Anstand gegenueber der Quelle. */
const TAKT_MS = 6000;
let zuletzt = 0;

const MAX_KM2 = 40;

/**
 * Rand um die Abfrage. Overpass liefert einen Weg nur, wenn mindestens ein
 * Knoten im Ausschnitt liegt. Ein Gebaeude, das die Rahmenkante quert, dessen
 * Ecken aber alle draussen sitzen, fehlt sonst ganz. Der Zeichner beschneidet
 * am Blattrand ohnehin, also kostet der Rand nichts als ein paar Kilobyte.
 */
const RAND_M = 150;

/**
 * Alles holen, was OpenStreetMap im Rahmen kennt.
 *
 * Bis zum 15.09.2026 fragte Nolli eine kuratierte Liste ab — Gebaeude,
 * Strassen, Wasser, Gruen. Das war richtig, solange das Paket nur den
 * Zeichner bedienen musste. Sobald nachgelagerte Werkzeuge daraus rechnen,
 * ist jede Kuratierung eine Entscheidung, die an der falschen Stelle faellt:
 * Nolli kann nicht wissen, ob eine spaetere Analyse Parkflaechen, Barrieren
 * oder Baeume braucht.
 *
 * Also alles, was ein Merkmal traegt. `nwr[~"."~"."]` heisst: Knoten, Wege und
 * Relationen mit mindestens einem Merkmal — die unbeschrifteten Stuetzpunkte
 * der Wege bleiben draussen, sie kommen ohnehin in der Geometrie mit.
 *
 * Ausgenommen sind allein die Routen-Relationen. Gemessen an Altona-Nord:
 * Der volle Auszug kostet 38,5 MB, davon 21,1 die 134 Routen, weil jede ihren
 * ganzen Linienweg als Mitglieder fuehrt. Ohne sie sind es 8,5 MB fuer alles
 * andere. Die Linien kommen weiter unten ueber `foreach`, wo sie 297 Kilobyte
 * kosten statt 21 Megabyte.
 *
 * Zum Vergleich: Die kuratierte Abfrage kostete 5,4 MB. Alles zu nehmen ist
 * also nicht das Doppelte, sondern gut die Haelfte mehr.
 */

/**
 * Linien zu den Haltestellen, ohne die Linien selbst zu holen.
 *
 * Eine Haltestelle ohne Linienbezug ist nur ein Punkt; mit ihm wird sie zur
 * Erreichbarkeitsaussage. `foreach` gibt je Haltestelle erst den Knoten aus
 * und dann die Merkmale ihrer Routen, ohne deren Mitglieder. Die Zuordnung
 * steckt in der Reihenfolge.
 */
const ABFRAGE = (s: number, w: number, n: number, o: number) => `[out:json][timeout:180];
(
  nwr[~"."~"."](${s},${w},${n},${o});
  - relation["route"](${s},${w},${n},${o});
);
out geom;

(
  node["public_transport"](${s},${w},${n},${o});
  node["highway"="bus_stop"](${s},${w},${n},${o});
  node["railway"~"^(station|halt|tram_stop)$"](${s},${w},${n},${o});
)->.halte;
foreach .halte -> .h (
  .h out geom;
  rel(bn.h)["route"];
  out tags;
);`;

export type Ecken = { sued: number; west: number; nord: number; ost: number };

/** Fehler mit einem Satz, der im Werkzeug stehen kann. */
export class QuellFehler extends Error {}

/**
 * Was gerade passiert, waehrend es passiert.
 *
 * Der Abruf dauert je nach Ausschnitt und Tagesform der Auskunft zwischen
 * fuenf Sekunden und anderthalb Minuten und laedt dabei mehrere Megabyte. Ein
 * Knopf, der nur „laedt" sagt, laesst offen, ob noch etwas geschieht. Also
 * wird gemeldet, welcher Spiegel gefragt wird, wie viel schon da ist und der
 * wievielte Versuch laeuft.
 */
export type Melder = (was: string) => void;

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Den Rumpf lesen, dabei melden, und die Stilleuhr bei jedem Stueck stellen. */
async function lies(a: Response, melde: (bytes: number) => void,
	stelleUhr: () => void): Promise<string> {
	if (!a.body) return a.text();
	const leser = a.body.getReader();
	const stuecke: Uint8Array[] = [];
	let bisher = 0, zuletztGemeldet = 0;
	for (;;) {
		const { done, value } = await leser.read();
		if (done) break;
		stelleUhr();
		stuecke.push(value);
		bisher += value.length;
		// Nicht bei jedem Stueck melden, das waere hundertmal je Sekunde.
		if (bisher - zuletztGemeldet > 262144) { zuletztGemeldet = bisher; melde(bisher); }
	}
	const alles = new Uint8Array(bisher);
	let i = 0;
	for (const st of stuecke) { alles.set(st, i); i += st.length; }
	return new TextDecoder().decode(alles);
}

export async function holeBestand(roh: Ecken, melde: Melder = () => {}): Promise<any> {
	const dLat = RAND_M / 111320;
	const dLon = RAND_M / (111320 * Math.cos(((roh.nord + roh.sued) / 2) * Math.PI / 180));
	const sued = roh.sued - dLat, nord = roh.nord + dLat;
	const west = roh.west - dLon, ost = roh.ost + dLon;

	const hoeheKm = (nord - sued) * 111.32;
	const breiteKm = (ost - west) * 111.32 * Math.cos(((nord + sued) / 2) * Math.PI / 180);
	const flaeche = hoeheKm * breiteKm;
	if (flaeche > MAX_KM2)
		throw new QuellFehler(t().quelle.zuGross(flaeche.toFixed(0), MAX_KM2));

	const wartet = TAKT_MS - (Date.now() - zuletzt);
	if (wartet > 0)
		throw new QuellFehler(t().quelle.warten(Math.ceil(wartet / 1000)));
	zuletzt = Date.now();

	const koerper = new URLSearchParams({ data: ABFRAGE(sued, west, nord, ost) });
	const start = Date.now();
	const rest = () => FRIST_MS - (Date.now() - start);
	const aufgegeben = new Set<string>();
	let ueberlastet = false;
	let letzterFehler = '';
	let versuche = 0;

	const hatGeantwortet = new Set<string>();

	/** Ein einzelner Anlauf. Sagt, ob es weitergehen soll. */
	async function anlauf(spiegel: string): Promise<{ daten?: any; nochmal: boolean }> {
		const name = new URL(spiegel).hostname;
		const begonnen = Date.now();
		const frist = hatGeantwortet.has(spiegel) ? GEDULD_MS : ERSTKONTAKT_MS;
		versuche++;
		melde(versuche === 1 ? `Frage ${name}` : `Versuch ${versuche} · ${name}`);
		const ab = new AbortController();
		let uhr = setTimeout(() => ab.abort(), Math.min(frist, Math.max(1000, rest())));
		const stelleUhr = () => {
			clearTimeout(uhr);
			uhr = setTimeout(() => ab.abort(), Math.min(STILLE_MS, Math.max(1000, rest())));
		};
		try {
			const a = await fetch(spiegel, { method: 'POST', body: koerper, signal: ab.signal });
			hatGeantwortet.add(spiegel);
			stelleUhr();
			const text = await lies(a, (n) => melde(`${name} · ${t().quelle.geladenKurz(mb(n))}`), stelleUhr);
			clearTimeout(uhr);
			// Overpass meldet Ueberlastung sowohl mit 504 als auch mit 200 und
			// einer HTML-Seite im Rumpf. Beides ist derselbe Befund.
			if (a.ok && text.startsWith('{')) {
				melde(t().quelle.geladen(mb(text.length)));
				const daten = JSON.parse(text);
				if (Array.isArray(daten.elements)) { bewaehrt = spiegel; return { daten, nochmal: false }; }
				letzterFehler = t().quelle.ohneDaten(name);
				return { nochmal: false };
			}
			if (a.status === 504 || a.status === 429 || /too busy|timeout/i.test(text)) {
				ueberlastet = true;
				letzterFehler = t().quelle.ausgelastet(name);
				melde(t().quelle.ausgelastetWeiter(name));
				// Schnelle Absage: gleich noch einmal. Langsame: nicht.
				return { nochmal: Date.now() - begonnen < SCHNELL_MS };
			}
			letzterFehler = t().quelle.status(name, a.status);
			return { nochmal: false };
		} catch (e) {
			clearTimeout(uhr);
			const abbruch = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
			if (abbruch) ueberlastet = true;
			letzterFehler = abbruch
				? t().quelle.verstummt(name)
				: t().quelle.unerreichbar(name);
			aufgegeben.add(spiegel);   // Schweigen frisst die Frist
			stumm.set(spiegel, Date.now());
			return { nochmal: false };
		}
	}

	// Der zuletzt erfolgreiche Spiegel zuerst, kuerzlich stumme ans Ende
	const jetzt = Date.now();
	const schweigt = (x: string) => jetzt - (stumm.get(x) ?? 0) < STUMM_MS;
	const reihe = [...SPIEGEL]
		.sort((x, y) => Number(schweigt(x)) - Number(schweigt(y)))
		.sort((x, y) => Number(y === bewaehrt) - Number(x === bewaehrt));
	// Solange ein Spiegel antwortet, die stummen gar nicht erst fragen
	const wach = reihe.filter((x) => !schweigt(x));
	if (wach.length) for (const x of reihe) if (schweigt(x)) aufgegeben.add(x);
	const weiter = () => rest() > 4000 && versuche < VERSUCHE_GESAMT;
	while (weiter() && aufgegeben.size < SPIEGEL.length) {
		for (const spiegel of reihe) {
			if (aufgegeben.has(spiegel) || !weiter()) continue;
			for (let i = 0; i < VERSUCHE_JE_SPIEGEL; i++) {
				const { daten, nochmal } = await anlauf(spiegel);
				if (daten) return daten;
				if (!nochmal || !weiter()) break;
				await new Promise((f) => setTimeout(f, PAUSE_MS));
			}
		}
		if (weiter()) await new Promise((f) => setTimeout(f, PAUSE_MS));
	}

	const wie = t().quelle.versuche(versuche, SPIEGEL.length);
	throw new QuellFehler(ueberlastet
		? t().quelle.gestoert(wie, letzterFehler)
		: t().quelle.keine(wie, letzterFehler));
}

export type Treffer = { name: string; wo: string; lon: number; lat: number; bbox: number[] | null };

/** Ortssuche über Photon. */
export async function sucheOrt(q: string): Promise<Treffer[]> {
	if (q.trim().length < 2) return [];
	const ziel = new URL('https://photon.komoot.io/api/');
	ziel.searchParams.set('q', q.trim());
	ziel.searchParams.set('limit', '6');
	ziel.searchParams.set('lang', sprache.jetzt);
	const a = await fetch(ziel, { signal: AbortSignal.timeout(12000) });
	if (!a.ok) throw new QuellFehler(t().quelle.ortssuche);
	const d = await a.json();
	return (d.features ?? []).map((f: any) => {
		const p = f.properties ?? {};
		const teile = [p.city, p.county, p.state, p.country].filter(Boolean);
		return {
			name: p.name ?? p.street ?? q,
			wo: [...new Set(teile)].join(' · '),
			lon: f.geometry?.coordinates?.[0],
			lat: f.geometry?.coordinates?.[1],
			bbox: p.extent ?? null   // [west, nord, ost, sued]
		};
	}).filter((t: Treffer) => Number.isFinite(t.lon) && Number.isFinite(t.lat));
}
