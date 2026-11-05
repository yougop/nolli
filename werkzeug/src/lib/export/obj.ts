import { objName } from '../vertrag';
import { type Gelaende, tiefsteUnter, feldImRahmen } from '../geo/gelaende';
import earcut from 'earcut';
import { kronenKoerper } from './baeume';
import { unterkante, umrisseMitTeilen, type Objekt } from '../osm';
import { hatDach, dachKoerper } from '../dach';
import type { Rahmen } from '../geo/rahmen';
import { drin, amRahmen, gegenUhr, mitUhr, verschoben } from '../schneiden';
import { MATERIALIEN, materialFuer, kd } from '../material';

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
 * Teile davor kommen als eigene Koerper mit `_ausserhalb` im Namen. Seit
 * dem 19.10.2026 stehen sie in einer eigenen Datei (`model_outside.obj`):
 * Das Modell selbst endet sauber an der Kante, wer Verschattung rechnet,
 * laedt beide. Die Zerlegung ist flaechentreu — an 2.611 Ringen beider
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
/**
 * `teil` wählt, was geschrieben wird. `innen` ist das Modell im Rahmen mit
 * Gelände, sauber an der Kante abgeschnitten; `aussen` sind nur die Teile
 * davor, als eigene Datei. Volker am 19.10.2026: Der ausgefranste Rand
 * gehört nicht ins Modell, das man in Rhino öffnet. Für die Verschattung
 * bleiben die Teile trotzdem greifbar.
 */
export function alsObj(objekte: Objekt[], r: Rahmen, gelaende: Gelaende | null = null,
	material: string | null = null, teil: 'innen' | 'aussen' = 'innen',
	baeume: { x: number; y: number; krone: number; gemessen: boolean }[] = []): string {
	const zeilen: string[] = [
		'# Nolli — context model from OpenStreetMap',
		'# ODbL, © OpenStreetMap contributors',
		...(objekte.some((o) => o.herkunft === 'overture')
			? ['# Some buildings added from Overture Maps (ODbL; footprints largely Microsoft ML Building Footprints)'] : []),
		`# Local grid: +proj=tmerc +lon_0=${r.gitter.lon0.toFixed(7)} +k=1 +ellps=WGS84`,
		`# Origin in grid: ${r.x0.toFixed(1)} ${r.y0.toFixed(1)}`,
		`# Units metres, Z up, Y north`,
		...(gelaende
			? [`# Z: metres above sea level. Terrain from ${gelaende.quellen.join(', ') || 'AWS Terrain Tiles'}, zoom ${gelaende.zoom}`]
			: ['# Z: 0 is the ground, terrain not modelled']),
		...(material ? [`mtllib ${material}`] : []),
		'',
		// Normale 1 zeigt nach oben, für alle Dächer.
		'vn 0 0 1',
		''
	];
	let normalen = 1;
	let texturpunkte = 0;
	let basis = 0;
	// Umrisse, die ihre Teile ersetzen, kommen nicht ins Modell: Sonst stünde
	// der Umriss als Klotz um seine Teile, und Umbra rechnete beide als Werfer.
	// In `data/bodies.json` stehen sie mit `replaced_by_parts`.
	const ersetzt = umrisseMitTeilen(objekte);

	for (const o of objekte) {
		if (o.ebene !== 'gebaeude' && o.ebene !== 'erhalt') continue;
		if (o.zustand === 'gestrichen') continue;
		if (ersetzt.has(o.id)) continue;
		if (!o.ringe.length) continue;

		const zerlegt = o.ringe.map((a) => amRahmen(a, r.x0, r.y0, r.x1, r.y1));
		const loecherZerlegt = (o.loecher ?? []).map((l) => amRahmen(l, r.x0, r.y0, r.x1, r.y1));
		const nachAussen = zerlegt.some((t) => t.aussen.length);

		/**
		 * Mit Dach (`dach.ts`): Dreiecke statt Wand und Dachplatte, jedes mit
		 * eigener Normale, damit Rhino die Dachflächen nicht verschmiert.
		 * Innen und vor der Kante wie bei den flachen Körpern getrennt.
		 */
		if (hatDach(o)) {
			const boden = gelaende ? tiefsteUnter(gelaende, o.ringe) : 0;
			const ganz = o.ringe.length === 1 && !nachAussen;
			const marke = o.hoeheGeschaetzt ? '_hoehe_geschaetzt' : '';
			const stuecke = teil === 'innen'
				? zerlegt.filter((t) => t.innen.length >= 3).map((t) => t.innen)
				: zerlegt.flatMap((t) => t.aussen).filter((a) => a.length >= 3);
			if (!stuecke.length) continue;
			const { dreiecke } = dachKoerper(o, stuecke, boden, unterkante(o), ganz);
			zeilen.push(`o ${objName(`${o.ebene}_${o.id}${marke}${teil === 'aussen' ? '_ausserhalb' : ''}`)}`);
			if (material) zeilen.push(`usemtl ${materialFuer(o)}`);
			for (let k = 0; k < dreiecke.length; k += 9) {
				const p = [0, 3, 6].map((j) => [dreiecke[k + j] - r.x0, dreiecke[k + j + 1] - r.y0, dreiecke[k + j + 2]]);
				for (const [x, y, zz] of p) zeilen.push(`v ${x.toFixed(3)} ${y.toFixed(3)} ${zz.toFixed(3)}`);
				const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
				const wx = p[2][0] - p[0][0], wy = p[2][1] - p[0][1], wz = p[2][2] - p[0][2];
				const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
				zeilen.push(`vn ${(nx / l).toFixed(5)} ${(ny / l).toFixed(5)} ${(nz / l).toFixed(5)}`);
				const nn = ++normalen;
				zeilen.push(`f ${basis + 1}//${nn} ${basis + 2}//${nn} ${basis + 3}//${nn}`);
				basis += 3;
			}
			zeilen.push('');
			continue;
		}

		const holen = (
			was: (t: Zerlegung) => [number, number][][],
			teile: Zerlegung[]
		) => teile.flatMap(was).filter((a) => a.length >= 3).map((a) => verschoben(a, r.x0, r.y0));

		const aussenteile = holen((t) => (t.innen.length ? [t.innen] : []), zerlegt)
			.filter((a) => a.length >= 3)
			.map(gegenUhr);
		if (!aussenteile.length && !nachAussen) continue;
		const offeneLoecher = holen((t) => (t.innen.length ? [t.innen] : []), loecherZerlegt)
			.filter((l) => l.length >= 3)
			.map(mitUhr);

		// Ein schwebender Teil beginnt an seiner Unterkante; `h` ist dann nur
		// noch seine eigene Höhe, und er bekommt einen Boden.
		const u = unterkante(o);
		const h = (o.hoeheM ?? 8) - u;
		const fuss = (gelaende ? tiefsteUnter(gelaende, o.ringe) : 0) + u;

		/** Einen Satz Aussenringe mit ihren Loechern als ein Objekt schreiben. */
		const schreiben = (name: string, teile: [number, number][][], loch: [number, number][][]) => {
			if (!teile.length) return;
			zeilen.push(`o ${objName(name)}`);
			// Das Material nach dem Schema (`material.ts`), innen wie außen dasselbe:
			// Es gehört dem Gebäude, nicht dem Stück. Ein `o` je Körper bleibt.
			if (material) zeilen.push(`usemtl ${materialFuer(o)}`);
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
				//
				// Jede Wand bekommt ihre eigene Normale. Ohne sie mittelt Rhino
				// an jeder Ecke über Wand und Dach, und die Häuser sehen aus
				// wie aus Seife. Außenringe laufen gegen, Höfe mit dem
				// Uhrzeigersinn: (dy, −dx) zeigt deshalb bei beiden nach außen.
				let ab = 0;
				for (const kette of [aussen, ...loecher]) {
					for (let i = 0; i < kette.length; i++) {
						const a = ab + i, b = ab + ((i + 1) % kette.length);
						const [x1, y1] = kette[i], [x2, y2] = kette[(i + 1) % kette.length];
						const l = Math.hypot(x2 - x1, y2 - y1) || 1;
						zeilen.push(`vn ${((y2 - y1) / l).toFixed(5)} ${(-(x2 - x1) / l).toFixed(5)} 0`);
						const nn = ++normalen;
						zeilen.push(`f ${unten(a)}//${nn} ${unten(b)}//${nn} ${oben(b)}//${nn} ${oben(a)}//${nn}`);
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
					zeilen.push(`f ${oben(idx[k])}//1 ${oben(idx[k + 1])}//1 ${oben(idx[k + 2])}//1`);
				if (u > 0) {
					zeilen.push('vn 0 0 -1');
					const nb = ++normalen;
					for (let k = 0; k < idx.length; k += 3)
						zeilen.push(`f ${unten(idx[k])}//${nb} ${unten(idx[k + 2])}//${nb} ${unten(idx[k + 1])}//${nb}`);
				}

				basis += n * 2;
			}
			zeilen.push('');
		};

		const marke = o.hoeheGeschaetzt ? '_hoehe_geschaetzt' : '';
		if (teil === 'innen') schreiben(`${o.ebene}_${o.id}${marke}`, aussenteile, offeneLoecher);

		/**
		 * Was vor der Rahmenkante liegt, als eigener Koerper.
		 *
		 * Gleicher Name mit `_ausserhalb` dahinter, damit die Zusammengehoerig-
		 * keit lesbar bleibt. Ausblenden ergibt den sauberen Ausschnitt,
		 * Stehenlassen den vollstaendigen Schattenwerfer.
		 */
		if (nachAussen && teil === 'aussen') {
			const draussen = holen((t) => t.aussen, zerlegt)
				.filter((a) => a.length >= 3)
				.map(gegenUhr);
			const draussenLoecher = holen((t) => t.aussen, loecherZerlegt)
				.filter((l) => l.length >= 3)
				.map(mitUhr);
			schreiben(`${o.ebene}_${o.id}${marke}_ausserhalb`, draussen, draussenLoecher);
		}
		}

		if ((gelaende || material) && teil === 'innen') {
			// Das Gelände als ein Körper, genau auf dem Rahmen, zwei Dreiecke je Masche.
			// Ohne Gelände, aber mit Material eine ebene Platte auf null: Die
			// Textur braucht etwas, worauf sie liegt.
			const f = gelaende
				? feldImRahmen(gelaende, r)
				: { nx: 2, ny: 2, dx: r.x1 - r.x0, dy: r.y1 - r.y0, z: new Float32Array(4) };
			zeilen.push(`o ${objName('gelaende')}`);
			for (let j = 0; j < f.ny; j++)
				for (let i = 0; i < f.nx; i++)
					zeilen.push(`v ${(i * f.dx).toFixed(3)} ${(j * f.dy).toFixed(3)} ${f.z[j * f.nx + i].toFixed(3)}`);
			const ecke = (i: number, j: number) => basis + j * f.nx + i + 1;
			// Eine Normale je Punkt, aus dem Gefälle der Nachbarn: Das Gelände
			// soll weich schattiert sein, anders als die Häuser.
			//
			// Und sie ist nötig, damit Rhino die Texturkoordinaten annimmt. Am
			// 19.10.2026 kam das Material an, die Textur aber erst nach neuem
			// Mapping. Rhinos eigener Export desselben Netzes hatte dieselben vt,
			// Wert für Wert — aber jede Fläche als v/vt/vn. Ohne vn verwarf der
			// Import die vt.
			const zi = (i: number, j: number) =>
				f.z[Math.min(f.ny - 1, Math.max(0, j)) * f.nx + Math.min(f.nx - 1, Math.max(0, i))];
			for (let j = 0; j < f.ny; j++)
				for (let i = 0; i < f.nx; i++) {
					const gx = (zi(i + 1, j) - zi(i - 1, j)) / ((Math.min(i + 1, f.nx - 1) - Math.max(i - 1, 0)) * f.dx);
					const gy = (zi(i, j + 1) - zi(i, j - 1)) / ((Math.min(j + 1, f.ny - 1) - Math.max(j - 1, 0)) * f.dy);
					const l = Math.hypot(gx, gy, 1);
					zeilen.push(`vn ${(-gx / l).toFixed(5)} ${(-gy / l).toFixed(5)} ${(1 / l).toFixed(5)}`);
				}
			const nBasis = normalen;
			normalen += f.nx * f.ny;
			const vn = (v: number) => v - basis + nBasis;
			let flaeche3 = (a: number, b: number, c: number) => `f ${a}//${vn(a)} ${b}//${vn(b)} ${c}//${vn(c)}`;
			if (material) {
				// Texturkoordinaten: Das Bild deckt genau den Rahmen ab, das Netz
				// auch, also u = x / Breite, v = y / Höhe. Die Bildzeile oben ist
				// Norden, und v zählt in OBJ von unten.
				for (let j = 0; j < f.ny; j++)
					for (let i = 0; i < f.nx; i++)
						zeilen.push(`vt ${(i / (f.nx - 1)).toFixed(6)} ${(j / (f.ny - 1)).toFixed(6)}`);
				zeilen.push('usemtl terrain');
				const vt = (v: number) => v - basis + texturpunkte;
				flaeche3 = (a, b, c) => `f ${a}/${vt(a)}/${vn(a)} ${b}/${vt(b)}/${vn(b)} ${c}/${vt(c)}/${vn(c)}`;
			}
			for (let j = 0; j < f.ny - 1; j++)
				for (let i = 0; i < f.nx - 1; i++) {
					zeilen.push(flaeche3(ecke(i, j), ecke(i + 1, j), ecke(i + 1, j + 1)));
					zeilen.push(flaeche3(ecke(i, j), ecke(i + 1, j + 1), ecke(i, j + 1)));
				}
			if (material) texturpunkte += f.nx * f.ny;
			basis += f.nx * f.ny;
			zeilen.push('');
		}

		if (teil === 'innen' && baeume.length) {
			const k = kronenKoerper(baeume, r, gelaende, !!material, basis, normalen);
			zeilen.push(...k.zeilen);
			basis += k.punkte;
			normalen += k.normalen;
		}
		return zeilen.join('\n');
	}

type Zerlegung = { innen: [number, number][]; aussen: [number, number][][] };

/**
 * Die Materialdatei zum Modell.
 *
 * Der Katalog aus `material.ts`, ein Material je Eintrag, dazu das Gelände
 * mit der Aufsicht ohne Bauten als Bild. Seit 03.11.2026 (Volker): Graustufen
 * nach Nutzungsklasse statt Weiß; vorher hieß es `building` und, vor der
 * Rahmenkante, `building_outside`. Die Textur ist PNG, nicht WebP wie die
 * übrigen Bilder des Pakets: Nicht jedes CAD-Programm liest WebP als Textur.
 */
export function alsMtl(textur: string | null): string {
	return [
		'# Nolli — materials for model.obj, model_outside.obj and model_design.obj',
		'# One material per entry of data/materials.json (schema 1): greys by use class, design warm.',
		'',
		...MATERIALIEN.flatMap((m) => [`newmtl ${m.id}`, `Kd ${kd(m.color)}`, 'Ka 0 0 0', '']),
		'newmtl terrain',
		'Kd 1 1 1',
		'Ka 0 0 0',
		...(textur ? [`map_Kd ${textur}`] : []),
		''
	].join('\n');
}
