/**
 * Sättigung und Kontrast eines Bodenbilds, Bildpunkt für Bildpunkt.
 *
 * Anlass (Volker, 03.11.2026): Jonathan wollte die Farben aus der Textur
 * haben und musste sie in Rhino entsättigen. Hier geschieht das, bevor die
 * Textur geschrieben wird, und dieselbe Rechnung zeigt das 3D-Modell.
 *
 * Bewusst von Hand statt mit `ctx.filter`: Das Ergebnis soll in jedem Browser
 * dasselbe sein, auf dem Bildschirm wie in der Datei. Sättigung mischt mit dem
 * Grauwert (Rec. 709), Kontrast spreizt um die Mitte.
 */
export type Anpassung = { saettigung: number; kontrast: number };
export const NEUTRAL: Anpassung = { saettigung: 1, kontrast: 1 };
export const istNeutral = (a: Anpassung) => a.saettigung === 1 && a.kontrast === 1;

export function anpassen(quelle: HTMLCanvasElement, ziel: HTMLCanvasElement, a: Anpassung) {
	ziel.width = quelle.width; ziel.height = quelle.height;
	const zc = ziel.getContext('2d')!;
	zc.drawImage(quelle, 0, 0);
	if (istNeutral(a)) return;
	const bild = zc.getImageData(0, 0, ziel.width, ziel.height);
	const d = bild.data, s = a.saettigung, k = a.kontrast;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i], g = d[i + 1], b = d[i + 2];
		const grau = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		d[i] = (grau + (r - grau) * s - 127.5) * k + 127.5;
		d[i + 1] = (grau + (g - grau) * s - 127.5) * k + 127.5;
		d[i + 2] = (grau + (b - grau) * s - 127.5) * k + 127.5;
	}
	zc.putImageData(bild, 0, 0);
}
