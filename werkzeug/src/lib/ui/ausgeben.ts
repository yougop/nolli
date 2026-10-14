import { t } from '$lib/sprache.svelte';
import { Rahmen } from '$lib/geo/rahmen';
import { zip } from 'fflate';
import { zeichneBlatt } from '$lib/zeichnen';
import { alsDxf } from '$lib/export/dxf';
import { alsObj } from '$lib/export/obj';
import type { Objekt } from '$lib/osm';
import type { Gelaende } from '$lib/geo/gelaende';

export function laden(inhalt: BlobPart, name: string, typ: string) {
	const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
	const a = document.createElement('a');
	a.href = url; a.download = name;
	document.body.appendChild(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const stempel = () => new Date().toISOString().slice(0, 10);

/**
 * Verlustfreies WebP statt PNG.
 *
 * `toBlob('image/webp', 1)` schreibt in Chrome bitgenau dasselbe Bild — an
 * allen sechs Darstellungen nachgemessen, null abweichende Farbkanaele — und
 * braucht dafuer 13,7 statt 31,1 Megabyte. Ein Plan ist grosse einfarbige
 * Flaechen mit harten Kanten, und genau darin ist WebP stark.
 *
 * Fuer das Paket also WebP. Der einzelne Bild-Ausgang bleibt PNG: Der landet
 * im Ordner „Downloads" und wandert in Dokumente und Programme, die aelter
 * sind als dieses Format.
 *
 * Nebenbefund aus der Umbra-Sitzung: Der Bildoptimierer eines Webhosters
 * rechnete ein ausgeliefertes 4096er-PNG stillschweigend auf 1600 herunter,
 * mit Status 200 und richtigem Inhaltstyp. WebP liess er in Ruhe.
 */
export const WEBP = 'image/webp';

export async function bild(objekte: Objekt[], r: Rahmen, darstellung: string, bereinigt: boolean,
	beschriftung: boolean, plangebiet: [number, number][] | null, sichtbar: Set<any>,
	ohneBauten = false, typ = 'image/png',
	baeume?: { x: number; y: number; krone: number }[]): Promise<Blob> {
	const c = document.createElement('canvas');
	c.width = r.pixelBreite; c.height = r.pixelHoehe;
	const ctx = c.getContext('2d');
	if (!ctx) throw new Error(t().bild.keineLeinwand);
	zeichneBlatt(ctx, objekte, r, {
		darstellung, bereinigt, beschriftung, plangebiet,
		rahmenZeigen: false, sichtbar, hervorgehoben: null, ohneBauten, baeume
	});
	return new Promise((gut, schlecht) =>
		c.toBlob((b) => (b ? gut(b) : schlecht(new Error(t().bild.nichtErzeugt))), typ, 1)
	);
}

/**
 * Das Paket für die nächste Station der Kette.
 *
 * Drei Dateien in einem Archiv: das Modell, die Bodentextur und der
 * Datenvertrag. Wer damit weiterarbeitet, lädt sie einzeln — das Archiv ist
 * für den Weg dorthin, nicht für das Laden selbst.
 *
 * Die Textur ist die Fassung ohne Baukörper, sofern es sie zu dieser
 * Darstellung gibt. Ein Werkzeug, das die Häuser selbst als Körper stellt,
 * braucht unter ihnen den Grund und nicht noch einmal die Häuser.
 */
export async function paket(teile: { name: string; inhalt: Blob | string }[]): Promise<Blob> {
	const roh: Record<string, Uint8Array> = {};
	for (const t of teile)
		roh[t.name] = typeof t.inhalt === 'string'
			? new TextEncoder().encode(t.inhalt)
			: new Uint8Array(await t.inhalt.arrayBuffer());
	const gepackt = await new Promise<Uint8Array>((gut, schlecht) =>
		zip(roh, { level: 6 }, (f, d) => (f ? schlecht(f) : gut(d)))
	);
	return new Blob([gepackt as BlobPart], { type: 'application/zip' });
}

export const dxf = (o: Objekt[], r: Rahmen, g: Gelaende | null = null) => alsDxf(o, r, false, g);
export const obj = (o: Objekt[], r: Rahmen, g: Gelaende | null = null) => alsObj(o, r, g);
