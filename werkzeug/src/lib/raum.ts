import earcut from 'earcut';
import { drin, amRahmen, gegenUhr, mitUhr, verschoben } from './schneiden';
import { unterkante, type Objekt } from './osm';
import { hatDach, dachKoerper } from './dach';
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

/**
 * `fuss` hebt einen Körper an, wenn das Gelände an ist: auf die tiefste
 * Geländehöhe unter seinem Grundriss, gemessen vom tiefsten Punkt im Rahmen.
 */
/**
 * Ein Körper mit Dach (`dach.ts`), am Rahmen geschnitten. Das Modul rechnet
 * im Ortsgitter; hier kommt es in die Achsen der Ansicht: x Ost, y oben,
 * z Süd. Die Abbildung ist eine Drehung, die Umlaufrichtung bleibt.
 */
function mitDach(o: Objekt, r: Rahmen, boden: number) {
	const zer = o.ringe.map((roh) => amRahmen(roh, r.x0, r.y0, r.x1, r.y1));
	const teile = zer.filter((t) => t.innen.length >= 3).map((t) => t.innen);
	const ganz = o.ringe.length === 1 && zer.every((t) => !t.aussen.length);
	return dachKoerper(o, teile, boden, unterkante(o), ganz);
}
const inAnsicht = (q: number[], r: Rahmen, aus: number[]) => {
	for (let i = 0; i < q.length; i += 3) aus.push(q[i] - r.x0, q[i + 2], -(q[i + 1] - r.y0));
};

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
		if (hatDach(o)) { inAnsicht(mitDach(o, r, fuss(o)).dreiecke, r, punkte); continue; }
		const u = unterkante(o);
		const h = fuss(o) + (o.hoeheM ?? 8);
		// Ein schwebender Teil beginnt an seiner Unterkante und bekommt einen Boden.
		f = fuss(o) + u;

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
			.map((a) => verschoben(a, r.x0, r.y0, true))
			.filter((a) => a.length >= 3)
			.map(gegenUhr);
		const offeneLoecher = (o.loecher ?? [])
			.flatMap(innen)
			.map((l) => verschoben(l, r.x0, r.y0, true))
			.filter((l) => l.length >= 3)
			.map(mitUhr);

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
				// Der Boden, nach unten gewendet.
				if (u > 0) punkte.push(a[0], f, a[1], b[0], f, b[1], c[0], f, c[1]);
			}
		}
	}
	return new Float32Array(punkte);
}

/** Wie hoch steht das hoechste Haus? Bestimmt Kamera und Schattenraum. */
export const hoechstes = (objekte: Objekt[]) =>
	objekte.reduce((m, o) => Math.max(m, o.hoeheM ?? 0), 0);

/** Ab diesem Knick zwischen zwei Wandstücken steht an der Ecke eine senkrechte Kante. */
export const KANTE_KNICK_GRAD = 20;

/**
 * Die Kanten der Baukörper, aus dem Grundriss statt aus den Dreiecken.
 *
 * Bis 04.11.2026 zog die Ansicht die Kanten aus dem Netz (`EdgesGeometry`).
 * Wo Dreiecke nicht exakt in einer Ebene lagen, erschien dann die Zerlegung
 * als Linie: Fächer auf dem Dach, Senkrechte an jeder Stützstelle einer
 * runden Fassade (Volker, Lower Manhattan). Hier entstehen nur die Kanten,
 * die ein Zeichner zöge: der Dachumriss oben, die Fußlinie unten und eine
 * Senkrechte an jeder Ecke, an der die Wand um mehr als `KANTE_KNICK_GRAD`
 * abknickt. Hofränder gehören dazu.
 *
 * Dieselbe Vorbereitung der Ringe wie `baukoerper`: am Rahmen geschnitten,
 * dieselben Achsen. Ausgabe: Strecken als Paare von Punkten, x y z x y z.
 */
export function baukanten(objekte: Objekt[], r: Rahmen, fuss: (o: Objekt) => number = () => 0,
	knickGrad = KANTE_KNICK_GRAD): Float32Array {
	const aus: number[] = [];
	const grenze = Math.cos((knickGrad * Math.PI) / 180);
	const innen = (roh: [number, number][]) => {
		const t = amRahmen(roh, r.x0, r.y0, r.x1, r.y1);
		return t.innen.length >= 3 ? [t.innen] : [];
	};
	for (const o of objekte) {
		if (!o.ringe.length) continue;
		if (hatDach(o)) { inAnsicht(mitDach(o, r, fuss(o)).kanten, r, aus); continue; }
		const h = fuss(o) + (o.hoeheM ?? 8);
		const f = fuss(o) + unterkante(o);
		const ringe = [...o.ringe, ...(o.loecher ?? [])]
			.flatMap(innen)
			.map((a) => verschoben(a, r.x0, r.y0, true))
			.filter((a) => a.length >= 3);
		for (const k of ringe) {
			const n = k.length;
			for (let i = 0; i < n; i++) {
				const a = k[i], b = k[(i + 1) % n], v = k[(i + n - 1) % n];
				aus.push(a[0], h, a[1], b[0], h, b[1]);   // Dachumriss
				aus.push(a[0], f, a[1], b[0], f, b[1]);   // Fußlinie
				// Senkrechte nur an einer echten Ecke
				const ux = a[0] - v[0], uz = a[1] - v[1], wx = b[0] - a[0], wz = b[1] - a[1];
				const lu = Math.hypot(ux, uz), lw = Math.hypot(wx, wz);
				if (lu < 1e-6 || lw < 1e-6) continue;
				if ((ux * wx + uz * wz) / (lu * lw) < grenze) aus.push(a[0], f, a[1], a[0], h, a[1]);
			}
		}
	}
	return new Float32Array(aus);
}
