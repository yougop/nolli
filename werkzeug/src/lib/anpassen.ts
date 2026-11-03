/**
 * Sättigung und Kontrast eines Bodenbilds, Bildpunkt für Bildpunkt.
 *
 * Anlass (Volker, 03.11.2026): Jonathan wollte die Farben aus der Textur
 * haben und musste sie in Rhino entsättigen. Hier geschieht das, bevor die
 * Textur geschrieben wird, und dieselbe Rechnung zeigt das 3D-Modell.
 *
 * Bewusst von Hand statt mit `ctx.filter`: Das Ergebnis soll in jedem Browser
 * dasselbe sein. Sättigung mischt mit dem Grauwert (Rec. 709), Kontrast
 * spreizt um die Mitte, Helligkeit multipliziert; gerechnet in sRGB.
 *
 * Das 3D-Modell rechnet dieselbe Formel im Shader (`KARTE_GLSL`), damit ein
 * Zug am Regler nur einen Wert ändert und kein Bild neu entsteht. Ändert sich
 * hier etwas, dann dort genauso — sonst zeigt die Ansicht etwas anderes, als
 * die Datei enthält.
 */
export type Anpassung = { saettigung: number; kontrast: number; helligkeit: number };
export const NEUTRAL: Anpassung = { saettigung: 1, kontrast: 1, helligkeit: 1 };
export const istNeutral = (a: Anpassung) =>
	a.saettigung === 1 && a.kontrast === 1 && (a.helligkeit ?? 1) === 1;

/** Dieselbe Rechnung für den Fragment-Shader, auf `diffuseColor` nach dem Texturzugriff. */
export const KARTE_GLSL = `
	vec3 kc = sRGBTransferOETF(vec4(diffuseColor.rgb, 1.0)).rgb;
	float kg = dot(kc, vec3(0.2126, 0.7152, 0.0722));
	kc = ((kg + (kc - kg) * uSaettigung) - 0.5) * uKontrast + 0.5;
	kc = clamp(kc * uHelligkeit, 0.0, 1.0);
	diffuseColor.rgb = sRGBTransferEOTF(vec4(kc, 1.0)).rgb;
`;

export function anpassen(quelle: HTMLCanvasElement, ziel: HTMLCanvasElement, a: Anpassung) {
	ziel.width = quelle.width; ziel.height = quelle.height;
	const zc = ziel.getContext('2d')!;
	zc.drawImage(quelle, 0, 0);
	if (istNeutral(a)) return;
	const bild = zc.getImageData(0, 0, ziel.width, ziel.height);
	const d = bild.data, s = a.saettigung, k = a.kontrast, h = a.helligkeit ?? 1;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i], g = d[i + 1], b = d[i + 2];
		const grau = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		d[i] = ((grau + (r - grau) * s - 127.5) * k + 127.5) * h;
		d[i + 1] = ((grau + (g - grau) * s - 127.5) * k + 127.5) * h;
		d[i + 2] = ((grau + (b - grau) * s - 127.5) * k + 127.5) * h;
	}
	zc.putImageData(bild, 0, 0);
}
