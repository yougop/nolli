import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// MapLibre bringt einen eigenen Web Worker mit. Vorgebündelt findet Vite ihn
	// im Entwicklungsbetrieb nicht, dann bleibt die Karte leer.
	optimizeDeps: { exclude: ['maplibre-gl'] },
	// Der Arbeiter wird als Modul geladen (siehe Karte.svelte), also muss er
	// auch als Modul gebündelt werden.
	worker: { format: 'es' }
});
