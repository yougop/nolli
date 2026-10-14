/**
 * Ablage der Sitzung im Browser.
 *
 * Der Bestand eines Rahmens sind schnell ein paar Megabyte. Der uebliche
 * `localStorage` nimmt nur Zeichenketten und ist bei fuenf Megabyte zu Ende;
 * eine Innenstadt passt da nicht hinein. `indexedDB` nimmt die Objekte, wie
 * sie sind, ohne sie vorher in Text zu verwandeln.
 *
 * Alles hier ist absichtlich stumm: Geht die Ablage nicht — privates Fenster,
 * gesperrter Speicher, voller Datentraeger —, arbeitet die App weiter, nur
 * eben ohne Gedaechtnis. Ein Werkzeug darf daran nicht scheitern.
 */
// Der Name bleibt, auch wenn die App jetzt nur noch Nolli heisst: Er ist der
// Schluessel zu bereits abgelegten Sitzungen, und ein neuer Name hiesse, dass
// jeder seine laufende Arbeit verliert.
const DATENBANK = 'nolli-site';
const LAGER = 'sitzung';

let offen: Promise<IDBDatabase | null> | null = null;

function oeffnen(): Promise<IDBDatabase | null> {
	if (offen) return offen;
	offen = new Promise((fertig) => {
		if (typeof indexedDB === 'undefined') return fertig(null);
		let a: IDBOpenDBRequest;
		try { a = indexedDB.open(DATENBANK, 1); } catch { return fertig(null); }
		a.onupgradeneeded = () => {
			if (!a.result.objectStoreNames.contains(LAGER)) a.result.createObjectStore(LAGER);
		};
		a.onsuccess = () => fertig(a.result);
		a.onerror = () => fertig(null);
		a.onblocked = () => fertig(null);
	});
	return offen;
}

export async function ablegen(schluessel: string, wert: unknown): Promise<boolean> {
	const db = await oeffnen();
	if (!db) return false;
	return new Promise((fertig) => {
		try {
			const t = db.transaction(LAGER, 'readwrite');
			t.objectStore(LAGER).put(wert, schluessel);
			t.oncomplete = () => fertig(true);
			t.onerror = () => fertig(false);
			t.onabort = () => fertig(false);
		} catch (e) {
			if (typeof console !== 'undefined') console.warn('Ablage:', e);
			fertig(false);
		}
	});
}

export async function abholen<T>(schluessel: string): Promise<T | null> {
	const db = await oeffnen();
	if (!db) return null;
	return new Promise((fertig) => {
		try {
			const a = db.transaction(LAGER, 'readonly').objectStore(LAGER).get(schluessel);
			a.onsuccess = () => fertig((a.result as T) ?? null);
			a.onerror = () => fertig(null);
		} catch { fertig(null); }
	});
}

export async function wegwerfen(schluessel: string): Promise<void> {
	const db = await oeffnen();
	if (!db) return;
	try { db.transaction(LAGER, 'readwrite').objectStore(LAGER).delete(schluessel); } catch { /* egal */ }
}
