/**
 * Transversale Mercator-Abbildung. Reihenentwicklung nach Snyder, im
 * nutzbaren Bereich millimetergenau. Gegen pyproj geprueft.
 *
 * Zwei Gitter kommen vor:
 *
 * **Das Ortsgitter** ist das Arbeitsgitter. Sein Mittelmeridian liegt in der
 * Mitte des Plangebiets, sein Massstabsfaktor ist genau 1. Dadurch faellt
 * Gitternord mit geographisch Nord zusammen, der Rahmen steht auf einer
 * genordeten Karte gerade, und Strecken im Gitter sind echte Meter.
 *
 * **Das UTM-Gitter** der zustaendigen Zone wird nur noch berichtet, damit
 * der Datenvertrag an amtliche Daten anschliessbar bleibt. Es ist nicht die
 * Rechengrundlage: Sein Mittelmeridian kann bis zu drei Grad entfernt liegen,
 * und dann steht ein achsparalleles Rechteck sichtbar schief.
 */
const A = 6378137.0;              // grosse Halbachse WGS84
const F = 1 / 298.257223563;      // Abplattung
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

export type Gitter = {
	lon0: number;   // Mittelmeridian in Grad
	k0: number;     // Massstabsfaktor auf dem Mittelmeridian
	ost0: number;   // falscher Ostwert
	nord0: number;  // falscher Nordwert
};

/** Das Arbeitsgitter: Mittelmeridian im Plangebiet, kein Versatz, Massstab 1. */
export const ortsgitter = (lon: number): Gitter => ({ lon0: lon, k0: 1, ost0: 0, nord0: 0 });

export type Zone = { zone: number; nord: boolean; epsg: number };

export function zoneFuer(lon: number, lat: number): Zone {
	const zone = Math.floor((lon + 180) / 6) + 1;
	const nord = lat >= 0;
	return { zone, nord, epsg: (nord ? 32600 : 32700) + zone };
}

export const utmGitter = (z: Zone): Gitter => ({
	lon0: (z.zone - 1) * 6 - 180 + 3,
	k0: 0.9996,
	ost0: 500000,
	nord0: z.nord ? 0 : 10000000
});

/** Meridianbogenlaenge vom Aequator bis zur Breite phi. */
function bogen(phi: number): number {
	const e4 = E2 * E2, e6 = e4 * E2;
	return A * (
		(1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
		- ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
		+ ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
		- ((35 * e6) / 3072) * Math.sin(6 * phi)
	);
}

export function nachGitter(lon: number, lat: number, g: Gitter): { x: number; y: number } {
	const phi = lat * RAD;
	const dl = (lon - g.lon0) * RAD;
	const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);

	const N = A / Math.sqrt(1 - E2 * sin * sin);
	const T = tan * tan;
	const C = EP2 * cos * cos;
	const Aa = cos * dl;
	const M = bogen(phi);

	const x = g.k0 * N * (
		Aa + ((1 - T + C) * Aa ** 3) / 6
		+ ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120
	) + g.ost0;

	const y = g.k0 * (M + N * tan * (
		(Aa * Aa) / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24
		+ ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720
	)) + g.nord0;

	return { x, y };
}

export function nachGrad(x: number, y: number, g: Gitter): { lon: number; lat: number } {
	const xx = x - g.ost0;
	const M = (y - g.nord0) / g.k0;
	const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
	const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

	const phi1 = mu
		+ ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
		+ ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
		+ ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
		+ ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

	const sin = Math.sin(phi1), cos = Math.cos(phi1), tan = Math.tan(phi1);
	const C1 = EP2 * cos * cos;
	const T1 = tan * tan;
	const N1 = A / Math.sqrt(1 - E2 * sin * sin);
	const R1 = (A * (1 - E2)) / (1 - E2 * sin * sin) ** 1.5;
	const D = xx / (N1 * g.k0);

	const lat = phi1 - ((N1 * tan) / R1) * (
		(D * D) / 2
		- ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
		+ ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720
	);
	const lon = g.lon0 * RAD + (
		D - ((1 + 2 * T1 + C1) * D ** 3) / 6
		+ ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120
	) / cos;

	return { lon: lon / RAD, lat: lat / RAD };
}

/** Winkel zwischen Gitternord und geographisch Nord, in Grad. */
export const konvergenz = (lon: number, lat: number, g: Gitter) =>
	(Math.atan(Math.tan((lon - g.lon0) * RAD) * Math.sin(lat * RAD)) * 180) / Math.PI;

export const proj4Von = (g: Gitter) =>
	`+proj=tmerc +lat_0=0 +lon_0=${g.lon0.toFixed(7)} +k=${g.k0} `
	+ `+x_0=${g.ost0} +y_0=${g.nord0} +ellps=WGS84 +units=m +no_defs`;
