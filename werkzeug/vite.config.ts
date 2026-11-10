import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
// @ts-expect-error -- Node-Typen sind im Projekt nicht installiert; gebraucht wird nur execSync.
import { execSync } from 'node:child_process';
// @ts-expect-error -- wie oben
import { readFileSync } from 'node:fs';

/**
 * Die Versionsnummer, aus `package.json` (seit 09.11.2026, 1.0.0 mit dem
 * Schritt „Entwerfen“). Hauptversion: der Datenvertrag bricht; zweite Stelle:
 * neue Funktion; dritte: Korrektur. Die Git-Kennung (`stand`) bleibt daneben.
 */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * Der Stand des Builds als Git-Kennung, für die Herkunft im Vertrag
 * (`provenance.generated.version`). Mit `+` dahinter, wenn der Arbeitsbaum
 * beim Bauen Änderungen hatte, die noch nicht committet sind.
 */
const stand = (() => {
	try {
		const k = execSync('git rev-parse --short HEAD').toString().trim();
		const offen = execSync('git status --porcelain -- .').toString().trim() !== '';
		return offen ? `${k}+` : k;
	} catch { return 'unbekannt'; }
})();

export default defineConfig({
	plugins: [sveltekit()],
	define: { __NOLLI_STAND__: JSON.stringify(stand), __NOLLI_VERSION__: JSON.stringify(version) },
	// MapLibre bringt einen eigenen Web Worker mit. Vorgebündelt findet Vite ihn
	// im Entwicklungsbetrieb nicht, dann bleibt die Karte leer.
	optimizeDeps: { exclude: ['maplibre-gl'] },
	// Der Arbeiter wird als Modul geladen (siehe Karte.svelte), also muss er
	// auch als Modul gebündelt werden.
	worker: { format: 'es' }
});
