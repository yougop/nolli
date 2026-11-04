/**
 * Sättigung und Kontrast eines Bodenbilds, Bildpunkt für Bildpunkt.
 *
 * Anlass (Volker, 03.11.2026): Jonathan wollte die Farben aus der Textur
 * haben und musste sie in Rhino entsättigen. Hier geschieht das, bevor die
 * Textur geschrieben wird, und dieselbe Rechnung zeigt das 3D-Modell.
 *
 * Bewusst von Hand statt mit `ctx.filter`: Das Ergebnis soll in jedem Browser
 * dasselbe sein. Sättigung mischt mit dem Grauwert (Rec. 709), Kontrast
 * spreizt um die mittlere Helligkeit des Bildes, Helligkeit multipliziert;
 * gerechnet in sRGB.
 *
 * Um die mittlere Helligkeit, nicht um 50 % Grau (Volker, 04.11.2026: „bei
 * mehr Kontrast sollten die dunklen Flächen dunkler und die hellen heller
 * werden"). Eine Karte ist fast ganz hell — Grund, Straßen und Grün liegen
 * über der Hälfte. Um 50 % gespreizt wurde dann alles heller, auch die
 * dunkleren Straßen, und das Bild wurde bleich statt kräftiger.
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
	kc = ((kg + (kc - kg) * uSaettigung) - uMitte) * uKontrast + uMitte;
	kc = clamp(kc * uHelligkeit, 0.0, 1.0);
	diffuseColor.rgb = sRGBTransferEOTF(vec4(kc, 1.0)).rgb;
`;

/**
 * Die mittlere Helligkeit eines Bildes, 0 bis 1, in sRGB. Gerechnet auf einer
 * kleinen Fassung, deshalb gleich für Ansicht, 3D-Boden und Datei desselben
 * Blattes. Durchsichtige Punkte zählen nicht mit.
 */
export function mitte(bild: CanvasImageSource & { width: number; height: number }): number {
	const k = document.createElement('canvas');
	k.width = 96; k.height = Math.max(1, Math.round((96 * bild.height) / Math.max(1, bild.width)));
	const c = k.getContext('2d')!;
	c.drawImage(bild, 0, 0, k.width, k.height);
	const d = c.getImageData(0, 0, k.width, k.height).data;
	let summe = 0, n = 0;
	for (let i = 0; i < d.length; i += 4) {
		if (d[i + 3] < 8) continue;
		summe += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
	}
	return n ? summe / n / 255 : 0.5;
}

/**
 * Die Anpassung als Matrix und Gerade, für einen SVG-Filter über dem
 * 2D-Blatt: dieselbe Rechnung wie `anpassen`, ohne das Blatt neu zu zeichnen.
 */
export function filterWerte(a: Anpassung, m: number) {
	const s = a.saettigung, k = a.kontrast, h = a.helligkeit ?? 1;
	const L = [0.2126, 0.7152, 0.0722];
	const zeile = (i: number) => L.map((l, j) => (l * (1 - s) + (i === j ? s : 0)).toFixed(5)).join(' ');
	return {
		matrix: `${zeile(0)} 0 0 ${zeile(1)} 0 0 ${zeile(2)} 0 0 0 0 0 1 0`,
		steigung: (k * h).toFixed(5),
		achse: (m * (1 - k) * h).toFixed(5)
	};
}

export function anpassen(quelle: HTMLCanvasElement, ziel: HTMLCanvasElement, a: Anpassung, m = mitte(quelle)) {
	ziel.width = quelle.width; ziel.height = quelle.height;
	const zc = ziel.getContext('2d')!;
	zc.drawImage(quelle, 0, 0);
	if (istNeutral(a)) return;
	const bild = zc.getImageData(0, 0, ziel.width, ziel.height);
	const d = bild.data, s = a.saettigung, k = a.kontrast, h = a.helligkeit ?? 1, p = m * 255;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i], g = d[i + 1], b = d[i + 2];
		const grau = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		d[i] = ((grau + (r - grau) * s - p) * k + p) * h;
		d[i + 1] = ((grau + (g - grau) * s - p) * k + p) * h;
		d[i + 2] = ((grau + (b - grau) * s - p) * k + p) * h;
	}
	zc.putImageData(bild, 0, 0);
}
