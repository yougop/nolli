/**
 * Fingerabdruck des gebauten Standes.
 *
 * Anlass: Ich hatte der Website-Sitzung einmal gemeldet, die Beispieldateien
 * seien unveraendert — sie waren um 30 KB gewachsen, und aufgefallen ist es
 * nur, weil dort ein Pruefsummenvergleich laeuft. Was ich selbst behaupte,
 * stand bis jetzt in Prosa: „sechster Stand", „acht Aenderungen seither".
 *
 * Das hier ersetzt die Prosa nicht durch eine zweite Wahrheit ueber das, was
 * online liegt — das weiss nur die Website-Sitzung. Es haelt fest, was hier
 * gebaut ist, damit die Frage „ist der ausgelieferte Stand noch der aktuelle?"
 * eine Zahl hat statt einer Erinnerung.
 *
 *     node pruefung/stand.mjs           Fingerabdruck ausgeben
 *     node pruefung/stand.mjs merken    zusaetzlich als ausgeliefert vermerken
 *     node pruefung/stand.mjs seither   gegen den Vermerk vergleichen
 *     node pruefung/stand.mjs live      gegen das vergleichen, was ausgeliefert ist
 *
 * `live` ist die ehrlichere der beiden Auskuenfte und stammt aus der
 * Umbra-Sitzung: Ein Vermerk sagt, was jemand zu liefern meinte, ein Abruf
 * sagt, was ankommt. Dazwischen liegen genau die Faelle, an denen wir beide
 * haengengeblieben sind — der Bildoptimierer eines Hosters, der eine 200 mit
 * einer heruntergerechneten Textur beantwortete, und der `vite preview`, der
 * die Dateiliste von vor dem Build auslieferte.
 *
 * `live` schreibt nichts auf. Nolli wird von hier aus nicht ausgeliefert;
 * `merken` haelt nur fest, was hier gebaut war, als die Website-Sitzung
 * lieferte — mit Commit und ob der Arbeitsbaum sauber war, damit sich der
 * Quellstand hinter einem Vermerk spaeter nachpruefen laesst.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const hier = new URL('.', import.meta.url).pathname;
const bau = join(hier, '..', 'build');
const merkzettel = join(hier, 'ausgeliefert.json');

if (!existsSync(bau)) {
	console.error('Kein build/ da. Erst `npm run build`.');
	process.exit(1);
}

function sammeln(ordner, unter = '') {
	const aus = {};
	for (const e of readdirSync(ordner, { withFileTypes: true })) {
		const p = join(ordner, e.name);
		const name = unter ? `${unter}/${e.name}` : e.name;
		if (e.isDirectory()) Object.assign(aus, sammeln(p, name));
		else {
			const inhalt = readFileSync(p);
			aus[name] = { bytes: inhalt.length, hash: createHash('sha256').update(inhalt).digest('hex').slice(0, 12) };
		}
	}
	return aus;
}

const befehl = process.argv[2];

/** Erst hashen, wenn es gebraucht wird: `live` liest nur die Einstiegsseiten, nicht 14 MB Build. */
function fingerabdruck() {
	const jetzt = sammeln(bau);
	const namen = Object.keys(jetzt).sort();
	const gesamt = createHash('sha256')
		.update(namen.map((n) => `${n} ${jetzt[n].hash}`).join('\n'))
		.digest('hex').slice(0, 12);
	const bytes = namen.reduce((s, n) => s + jetzt[n].bytes, 0);
	return { jetzt, namen, gesamt, bytes };
}
/** Lokale Zeit mit Zone, damit sich der Vermerk mit dem Git-Log vergleichen laesst. */
function jetztLokal() {
	const d = new Date(), v = -d.getTimezoneOffset(), z = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())} ${v >= 0 ? '+' : '-'}${z(Math.floor(Math.abs(v) / 60))}:${z(Math.abs(v) % 60)}`;
}
const git = (arg) => { try { return execSync(`git ${arg}`, { encoding: 'utf8', cwd: hier }).trim(); } catch { return null; } };

/** Wohin `live` sieht. Ein zweites Argument ueberschreibt es — damit sich die
 *  Fehlerausgaenge an einer echten fremden Seite pruefen lassen und nicht nur
 *  an einer nachgestellten. */
const LIVE = process.argv[3] || 'https://zinssmeister.info/app/nolli/';

if (befehl === 'live') {
	// Skripte und Stile aus dem HTML; die Rhino-Bibliothek (.wasm) nennt das
	// HTML nicht, sie wird unten eigens abgefragt.
	const buendel = (text) =>
		[...new Set(text.match(/_app\/immutable\/[a-z]+\/[A-Za-z0-9._-]+\.(?:js|css)/g) ?? [])].sort();
	let antwort;
	try {
		// Am Zwischenspeicher vorbei. Die Seite trägt `max-age=600`, und der
		// Speicher des Hosters lieferte am 14.10.2026 nach einer Auslieferung
		// noch zehn Minuten die alte index.html — `live` meldete daraufhin
		// einen alten Stand, der längst ersetzt war. Ein Zusatz in der Adresse
		// erzwingt eine frische Antwort; die Seite selbst ignoriert ihn.
		const frisch = new URL(LIVE);
		frisch.searchParams.set('stand', String(Date.now()));
		antwort = await fetch(frisch, { signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
	} catch (e) {
		console.error(`${LIVE} nicht erreichbar: ${e.message}`);
		process.exit(2);
	}
	if (!antwort.ok) {
		console.error(`${LIVE} antwortete mit ${antwort.status}.`);
		process.exit(3);
	}
	const text = await antwort.text();

	/**
	 * Ist das ueberhaupt Nolli?
	 *
	 * Eine Fehlerseite antwortet mit 200 und laesst sich vergleichen wie jede
	 * andere. Das Merkmal muss dabei eines sein, das die Fassung ueberdauert —
	 * aus der Umbra-Sitzung: Ein Merkmal, das mit der Fassung wechselt, taugt
	 * nicht, um Fassungen zu unterscheiden. Ein `<title>` hat diese Seite
	 * nicht; die Meta-Beschreibung ist Text und darf sich aendern. Der
	 * Speicherschluessel `nolli.schema` dagegen liegt fest, solange niemand
	 * bereit ist, allen Nutzern ihre Schema-Wahl wegzunehmen.
	 */
	if (!text.includes('nolli.schema')) {
		const titel = text.match(/<title>([^<]*)<\/title>/)?.[1];
		console.error(`Status ${antwort.status}, aber die Antwort ist nicht Nolli.`);
		console.error(titel ? `  Titel: ${titel}` : `  Anfang: ${text.trim().slice(0, 80)}`);
		process.exit(4);
	}

	const draussen = buendel(text);
	if (!draussen.length) {
		console.error('Die Seite ist Nolli, nennt aber kein einziges Buendel — Antwort unerwartet.');
		process.exit(2);
	}

	/**
	 * Verglichen wird gegen beide Einstiegsseiten, nicht nur gegen `index.html`.
	 *
	 * Die Auslieferung ist eine Einzelseiten-App mit `200.html` als Rueckfall.
	 * Die beiden Seiten nennen verschieden viele Buendel — sieben gegen sechs —,
	 * und welche der Server schickt, haengt am angefragten Pfad. Wer nur gegen
	 * `index.html` prueft, bekommt einen Unterschied gemeldet, der keiner ist,
	 * sobald der Rueckfall antwortet.
	 */
	const seiten = ['index.html', '200.html']
		.filter((n) => existsSync(join(bau, n)))
		.map((n) => ({ name: n, b: buendel(readFileSync(join(bau, n), 'utf8')) }));
	const treffer = seiten.find(
		(s2) => s2.b.length === draussen.length && draussen.every((n) => s2.b.includes(n))
	);

	console.log(`${LIVE}`);
	if (treffer) {
		console.log(`  ${draussen.length} Buendel, alle gleich — der ausgelieferte Stand ist dieser Stand.`);
		console.log(`  (verglichen gegen ${treffer.name})`);
		/**
		 * Die grossen Beilagen eigens: die Rhino-Bibliothek (2,7 MB .wasm) steht
		 * in keinem HTML, nur ein Chunk laedt sie nach. Fehlt sie oder liefert
		 * der Hoster sie als text/html, schlug bisher erst der erste Klick auf
		 * den 3DM-Export fehl (Fund der Fehlersuche, 05.11.2026).
		 */
		const beilagen = readdirSync(join(bau, '_app/immutable/assets')).filter((n) => n.endsWith('.wasm'));
		let schlecht = 0;
		for (const n of beilagen) {
			const pfad = `_app/immutable/assets/${n}`;
			const hier2 = readFileSync(join(bau, pfad)).length;
			try {
				const kopf = await fetch(new URL(pfad, LIVE), { method: 'HEAD', signal: AbortSignal.timeout(20000) });
				const laenge = Number(kopf.headers.get('content-length'));
				const typ = kopf.headers.get('content-type') ?? '';
				if (!kopf.ok || typ.includes('text/html') || (laenge && laenge !== hier2)) {
					schlecht++;
					console.log(`  Beilage ${n}: Status ${kopf.status}, ${typ || 'ohne Typ'}, ${laenge || '?'} B (hier ${hier2} B)`);
				} else console.log(`  Beilage ${n}: da, ${hier2} B`);
			} catch (e) {
				schlecht++;
				console.log(`  Beilage ${n}: nicht abrufbar (${e.message})`);
			}
		}
		process.exit(schlecht ? 5 : 0);
	}
	const naechste = seiten.reduce((a, b2) =>
		draussen.filter((n) => b2.b.includes(n)).length > draussen.filter((n) => a.b.includes(n)).length ? b2 : a
	);
	const gleich = draussen.filter((n) => naechste.b.includes(n));
	console.log(`  ausgeliefert ${draussen.length} Buendel · hier ${naechste.b.length} · gleich ${gleich.length}`);
	console.log(`  Der ausgelieferte Stand ist ein anderer. (naechste hiesige Seite: ${naechste.name})`);
	for (const n of draussen.filter((x) => !naechste.b.includes(x))) console.log(`    nur draussen  ${n}`);
	for (const n of naechste.b.filter((x) => !draussen.includes(x))) console.log(`    nur hier      ${n}`);
	process.exit(0);
}

if (befehl === 'seither') {
	if (!existsSync(merkzettel)) {
		console.error('Kein Vermerk da. Einmal `node pruefung/stand.mjs merken` nach einer Auslieferung.');
		process.exit(1);
	}
	const alt = JSON.parse(readFileSync(merkzettel, 'utf8'));
	const { jetzt, namen, gesamt } = fingerabdruck();
	if (alt.gesamt === gesamt) {
		console.log(`Unveraendert seit ${alt.wann} · ${gesamt}`);
		process.exit(0);
	}
	const altN = new Set(Object.keys(alt.dateien));
	const neuN = new Set(namen);
	const dazu = namen.filter((n) => !altN.has(n));
	const weg = [...altN].filter((n) => !neuN.has(n));
	const anders = namen.filter((n) => altN.has(n) && alt.dateien[n].hash !== jetzt[n].hash);
	console.log(`Ausgeliefert ${alt.wann} · ${alt.gesamt}`);
	console.log(`Jetzt                    · ${gesamt}`);
	for (const n of anders) {
		const d = jetzt[n].bytes - alt.dateien[n].bytes;
		console.log(`  geaendert  ${n}${d ? ` (${d > 0 ? '+' : ''}${d} B)` : ''}`);
	}
	for (const n of dazu) console.log(`  neu        ${n} (${jetzt[n].bytes} B)`);
	for (const n of weg) console.log(`  weg        ${n}`);
	process.exit(0);
}

const { jetzt, namen, gesamt, bytes } = fingerabdruck();
console.log(`${namen.length} Dateien · ${(bytes / 1024 / 1024).toFixed(2)} MB · ${gesamt}`);

if (befehl === 'merken') {
	const wann = jetztLokal();
	const commit = git('rev-parse --short HEAD');
	const sauber = git('status --porcelain') === '';
	writeFileSync(merkzettel, JSON.stringify({ wann, commit, sauber, gesamt, dateien: jetzt }, null, 1));
	console.log(`Als ausgeliefert vermerkt: ${wann} · ${commit}${sauber ? '' : ' (Arbeitsbaum nicht sauber)'}`);
}
