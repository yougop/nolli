import earcut from 'earcut';
import { drin, amRahmen } from './schneiden';
import type { Objekt } from './osm';
import type { Rahmen } from './geo/rahmen';

/**
 * Baukoerper aus Footprint und Hoehe.
 *
 * Dieselbe Zerlegung wie beim OBJ-Ausgang: Waende als Vierecke, Dach ueber
 * earcut trianguliert. Hier laeuft sie in einen Puffer fuer die Anzeige,
 * dort in eine Datei.
 *
 * Achsen: X nach Osten, Y nach oben, Z nach Sueden. Der Ursprung liegt auf
 * der linken unteren Rahmenecke.
 *
 * Zwei Dinge entscheiden, ob ein Koerper geschlossen aussieht:
 *
 * **Umlaufrichtung.** OSM-Ringe laufen mal links-, mal rechtsherum. Wird das
 * nicht vereinheitlicht, zeigen die Normalen der Waende bei der Haelfte der
 * Haeuser nach innen, die Flaechen werden weggeschnitten, und man sieht in
 * ein offenes Gehaeuse. Aussenringe laufen hier gegen den Uhrzeigersinn,
 * Loecher mit dem Uhrzeigersinn.
 *
 * **Innenhoefe.** Ein Perimeterblock hat ein Loch. Ohne dieses Loch waere
 * der Hof zugedeckt und die GFA spaeter zu hoch. Das Dach bekommt die
 * Loecher an earcut gereicht, die Hofwaende werden mitgebaut.
 */
export type Punkt = [number, number];

const flaeche = (r: Punkt[]) => {
	let s = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
	return s / 2;
};

/** Ring in lokale Koordinaten bringen, schliessenden Punkt entfernen. */
function ring(roh: [number, number][], r: Rahmen): Punkt[] {
	const p = roh.map(([x, y]) => [x - r.x0, -(y - r.y0)] as Punkt);
	if (p.length > 1) {
		const a = p[0], b = p[p.length - 1];
		if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.pop();
	}
	return p;
}

/**
 * `fuss` hebt einen Körper an, wenn das Gelände an ist: auf die tiefste
 * Geländehöhe unter seinem Grundriss, gemessen vom tiefsten Punkt im Rahmen.
 */
export function baukoerper(objekte: Objekt[], r: Rahmen, fuss: (o: Objekt) => number = () => 0): Float32Array {
	const punkte: number[] = [];
	let f = 0;

	/**
	 * Eine Wand als zwei Dreiecke.
	 *
	 * Die Reihenfolge der Ecken bestimmt, wohin die Normale zeigt, und damit,
	 * ob die Flaeche von aussen sichtbar ist oder weggeschnitten wird. Bei
	 * gegen den Uhrzeigersinn laufendem Aussenring zeigt diese Reihenfolge
	 * nach aussen. An einem Quadrat nachgerechnet, nicht geraten.
	 */
	const wand = (a: Punkt, b: Punkt, h: number) => {
		punkte.push(a[0], f, a[1], b[0], h, b[1], b[0], f, b[1]);
		punkte.push(a[0], f, a[1], a[0], h, a[1], b[0], h, b[1]);
	};

	for (const o of objekte) {
		if (!o.ringe.length) continue;
		f = fuss(o);
		const h = f + (o.hoeheM ?? 8);

		/**
		 * Jeder Aussenteil wird ein eigener Koerper, die Loecher werden dem
		 * Teil zugeschlagen, in dem sie liegen.
		 *
		 * Bis zum 14.09.2026 galt hier jeder Ring nach dem ersten als Loch.
		 * Weil die Einleseregel Innenringe aber wegwarf, waren das in Wahrheit
		 * zweite Aussenteile — ein Gebaeude aus zwei Fluegeln bekam Waende um
		 * den zweiten Fluegel, aber kein Dach darauf.
		 */
		/**
		 * Am Rahmen beschnitten, bevor extrudiert wird.
		 *
		 * Ohne den Schnitt steht ein Haus, das die Kante kreuzt, ueber die
		 * Bodenplatte hinaus — die Platte ist genau der Rahmen. Im
		 * HafenCity-Ausschnitt betrifft das 62 von 624 Gebaeuden, der groesste
		 * Ueberstand sind 197 Meter.
		 *
		 * Fuer die Anzeige faellt weg, was draussen liegt. Der Ausgang wirft es
		 * nicht weg, sondern fuehrt es getrennt: Wer Verschattung rechnet,
		 * braucht den Schattenwerfer vor der Kante. Siehe `alsObj`.
		 */
		const innen = (roh: [number, number][]) => {
			const t = amRahmen(roh, r.x0, r.y0, r.x1, r.y1);
			return t.innen.length >= 3 ? [t.innen] : [];
		};
		const aussenteile = o.ringe
			.flatMap(innen)
			.map((a) => ring(a, r))
			.filter((a) => a.length >= 3)
			.map((a) => (flaeche(a) < 0 ? a.slice().reverse() : a));   // gegen den Uhrzeigersinn
		const offeneLoecher = (o.loecher ?? [])
			.flatMap(innen)
			.map((l) => ring(l, r))
			.filter((l) => l.length >= 3)
			.map((l) => (flaeche(l) > 0 ? l.slice().reverse() : l));   // mit dem Uhrzeigersinn

		for (const aussen of aussenteile) {
			const loecher = offeneLoecher.filter((l) => drin(l[0], aussen));

			for (let i = 0; i < aussen.length; i++) wand(aussen[i], aussen[(i + 1) % aussen.length], h);
			for (const l of loecher)
				for (let i = 0; i < l.length; i++) wand(l[i], l[(i + 1) % l.length], h);

			// Dach mit ausgeschnittenen Hoefen
			const flach: number[] = [];
			const grenzen: number[] = [];
			for (const [x, zz] of aussen) flach.push(x, zz);
			for (const l of loecher) {
				grenzen.push(flach.length / 2);
				for (const [x, zz] of l) flach.push(x, zz);
			}
			const alle = [aussen, ...loecher].flat();
			const idx = earcut(flach, grenzen);
			for (let k = 0; k < idx.length; k += 3) {
				const a = alle[idx[k]], b = alle[idx[k + 1]], c = alle[idx[k + 2]];
				if (!a || !b || !c) continue;
				punkte.push(a[0], h, a[1], c[0], h, c[1], b[0], h, b[1]);
			}
		}
	}
	return new Float32Array(punkte);
}

/** Wie hoch steht das hoechste Haus? Bestimmt Kamera und Schattenraum. */
export const hoechstes = (objekte: Objekt[]) =>
	objekte.reduce((m, o) => Math.max(m, o.hoeheM ?? 0), 0);
