import { objName } from '../vertrag';
import { type Gelaende, tiefsteUnter, feldImRahmen } from '../geo/gelaende';
import earcut from 'earcut';
import type { Objekt } from '../osm';
import type { Rahmen } from '../geo/rahmen';
import { drin, amRahmen } from '../schneiden';

/**
 * Wavefront OBJ, extrudierte Gebaeude. Ursprung auf der linken unteren
 * Rahmenecke, Einheit Meter, Z nach oben, Y nach Norden.
 *
 * Das ist das georeferenzierte Kontextmodell. Wer es in einem CAD-Programm
 * auf den Ursprung setzt, hat die Verortung ohne einen einzigen Klick, und
 * weil das Gitter am Ort aufgespannt ist, zeigt die Y-Achse tatsaechlich nach
 * Norden und nicht nur nach Gitternord einer weit entfernten Zone.
 *
 * **Am Rahmen getrennt, nicht abgeschnitten.** Ein Haus, das die Kante kreuzt,
 * ragte bisher ueber die Bodentextur hinaus — die deckt genau den Rahmen ab.
 * Es einfach zu kappen waere aber falsch: Im HafenCity-Ausschnitt kreuzen 62
 * von 624 Gebaeuden die Kante und halten 29 Prozent der Grundflaeche; was
 * draussen liegt, wirft Schatten herein, und genau dafuer holt die Abfrage
 * 150 Meter Rand.
 *
 * Deshalb wird zerlegt: Der Teil im Rahmen steht als gewohnter Koerper, die
 * Teile davor kommen als eigene Koerper mit `_ausserhalb` im Namen. Wer nur
 * den Ausschnitt zeigen will, blendet sie aus; wer Verschattung rechnet, laesst
 * sie stehen. Die Zerlegung ist flaechentreu — an 2.611 Ringen beider
 * Beispielgebiete geprueft, Abweichung null.
 *
 * **Mehrere Aussenteile, Hoefe ausgeschnitten.** Bis zum 14.09.2026 zog dieser
 * Ausgang nur den ersten Ring hoch; ein Gebaeude aus zwei Fluegeln verlor den
 * zweiten. Jeder Aussenteil wird jetzt ein eigener Koerper, und die Loecher
 * werden dem Teil zugeschlagen, in dem sie liegen. Gefunden beim Abgleich mit
 * Umbra, das auf diesem Modell die Besonnung rechnet.
 */
/**
 * Mit Gelände steht jeder Körper auf der tiefsten Geländehöhe unter seinem
 * Grundriss, und das Gelände selbst kommt als eigener Körper dazu. Die Höhen
 * sind dann absolut, Meter über dem Meer. Ohne Gelände bleibt alles auf null.
 */
export function alsObj(objekte: Objekt[], r: Rahmen, gelaende: Gelaende | null = null): string {
	const zeilen: string[] = [
		'# Nolli — context model from OpenStreetMap',
		'# ODbL, © OpenStreetMap contributors',
		`# Local grid: +proj=tmerc +lon_0=${r.gitter.lon0.toFixed(7)} +k=1 +ellps=WGS84`,
		`# Origin in grid: ${r.x0.toFixed(1)} ${r.y0.toFixed(1)}`,
		`# Units metres, Z up, Y north`,
		...(gelaende
			? [`# Z: metres above sea level. Terrain from ${gelaende.quellen.join(', ') || 'AWS Terrain Tiles'}, zoom ${gelaende.zoom}`]
			: ['# Z: 0 is the ground, terrain not modelled']),
		''
	];
	let basis = 0;

	for (const o of objekte) {
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') continue;
		if (o.zustand === 'gestrichen') continue;
		if (!o.ringe.length) continue;

		const zerlegt = o.ringe.map((a) => amRahmen(a, r.x0, r.y0, r.x1, r.y1));
		const loecherZerlegt = (o.loecher ?? []).map((l) => amRahmen(l, r.x0, r.y0, r.x1, r.y1));
		const nachAussen = zerlegt.some((t) => t.aussen.length);

		const holen = (
			was: (t: Zerlegung) => [number, number][][],
			teile: Zerlegung[]
		) => teile.flatMap(was).filter((a) => a.length >= 3).map((a) => ring(a, r));

		const aussenteile = holen((t) => (t.innen.length ? [t.innen] : []), zerlegt)
			.filter((a) => a.length >= 3)
			.map((a) => (flaeche(a) < 0 ? a.slice().reverse() : a));   // gegen den Uhrzeigersinn
		if (!aussenteile.length && !nachAussen) continue;
		const offeneLoecher = holen((t) => (t.innen.length ? [t.innen] : []), loecherZerlegt)
			.filter((l) => l.length >= 3)
			.map((l) => (flaeche(l) > 0 ? l.slice().reverse() : l));   // mit dem Uhrzeigersinn

		const h = o.hoeheM ?? 8;
		const fuss = gelaende ? tiefsteUnter(gelaende, o.ringe) : 0;

		/** Einen Satz Aussenringe mit ihren Loechern als ein Objekt schreiben. */
		const schreiben = (name: string, teile: [number, number][][], loch: [number, number][][]) => {
			if (!teile.length) return;
			zeilen.push(`o ${objName(name)}`);
			for (const aussen of teile) {
				const loecher = loch.filter((l) => drin(l[0], aussen));

				// Alle Punkte, erst unten, dann oben. Die Reihenfolge ist die von
				// `alle`, damit die Dachindizes von earcut passen.
				const alle = [aussen, ...loecher].flat();
				for (const [x, y] of alle) zeilen.push(`v ${x.toFixed(3)} ${y.toFixed(3)} ${fuss.toFixed(3)}`);
				for (const [x, y] of alle) zeilen.push(`v ${x.toFixed(3)} ${y.toFixed(3)} ${(fuss + h).toFixed(3)}`);
				const n = alle.length;
				const unten = (i: number) => basis + i + 1;
				const oben = (i: number) => basis + n + i + 1;

				// Waende, aussen wie innen. Der Hof bekommt seine Fassaden.
				let ab = 0;
				for (const kette of [aussen, ...loecher]) {
					for (let i = 0; i < kette.length; i++) {
						const a = ab + i, b = ab + ((i + 1) % kette.length);
						zeilen.push(`f ${unten(a)} ${unten(b)} ${oben(b)} ${oben(a)}`);
					}
					ab += kette.length;
				}

				// Dach mit ausgeschnittenen Hoefen
				const flach: number[] = [];
				const grenzen: number[] = [];
				for (const [x, y] of aussen) flach.push(x, y);
				for (const l of loecher) {
					grenzen.push(flach.length / 2);
					for (const [x, y] of l) flach.push(x, y);
				}
				const idx = earcut(flach, grenzen);
				for (let k = 0; k < idx.length; k += 3)
					zeilen.push(`f ${oben(idx[k])} ${oben(idx[k + 1])} ${oben(idx[k + 2])}`);

				basis += n * 2;
			}
			zeilen.push('');
		};

		const marke = o.hoeheGeschaetzt ? '_hoehe_geschaetzt' : '';
		schreiben(`${o.ebene}_${o.id}${marke}`, aussenteile, offeneLoecher);

		/**
		 * Was vor der Rahmenkante liegt, als eigener Koerper.
		 *
		 * Gleicher Name mit `_ausserhalb` dahinter, damit die Zusammengehoerig-
		 * keit lesbar bleibt. Ausblenden ergibt den sauberen Ausschnitt,
		 * Stehenlassen den vollstaendigen Schattenwerfer.
		 */
		if (nachAussen) {
			const draussen = holen((t) => t.aussen, zerlegt)
				.filter((a) => a.length >= 3)
				.map((a) => (flaeche(a) < 0 ? a.slice().reverse() : a));
			const draussenLoecher = holen((t) => t.aussen, loecherZerlegt)
				.filter((l) => l.length >= 3)
				.map((l) => (flaeche(l) > 0 ? l.slice().reverse() : l));
			schreiben(`${o.ebene}_${o.id}${marke}_ausserhalb`, draussen, draussenLoecher);
		}
		}

		if (gelaende) {
			// Das Gelände als ein Körper, genau auf dem Rahmen, zwei Dreiecke je Masche.
			const f = feldImRahmen(gelaende, r);
			zeilen.push(`o ${objName('gelaende')}`);
			for (let j = 0; j < f.ny; j++)
				for (let i = 0; i < f.nx; i++)
					zeilen.push(`v ${(i * f.dx).toFixed(3)} ${(j * f.dy).toFixed(3)} ${f.z[j * f.nx + i].toFixed(3)}`);
			const ecke = (i: number, j: number) => basis + j * f.nx + i + 1;
			for (let j = 0; j < f.ny - 1; j++)
				for (let i = 0; i < f.nx - 1; i++) {
					zeilen.push(`f ${ecke(i, j)} ${ecke(i + 1, j)} ${ecke(i + 1, j + 1)}`);
					zeilen.push(`f ${ecke(i, j)} ${ecke(i + 1, j + 1)} ${ecke(i, j + 1)}`);
				}
			basis += f.nx * f.ny;
			zeilen.push('');
		}
		return zeilen.join('\n');
	}

type Zerlegung = { innen: [number, number][]; aussen: [number, number][][] };

/** Ring in Rahmenkoordinaten, schliessenden Punkt entfernen. */
function ring(roh: [number, number][], r: Rahmen): [number, number][] {
	const p = roh.map(([x, y]) => [x - r.x0, y - r.y0] as [number, number]);
	if (p.length > 1) {
		const a = p[0], b = p[p.length - 1];
		if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.pop();
	}
	return p;
}

/** Vorzeichenbehaftete Flaeche. Positiv heisst gegen den Uhrzeigersinn. */
function flaeche(r: [number, number][]): number {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
	return s / 2;
}
