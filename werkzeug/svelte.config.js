import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Nolli wird als blosser Dateiordner ausgeliefert.
 *
 * Es gibt keinen eigenen Server mehr: Bestand und Ortssuche fragt die Seite
 * direkt aus dem Browser (siehe `src/lib/quelle.ts`). Damit laeuft Nolli auf
 * jedem Webspace, jeder Besucher redet mit seiner eigenen Adresse mit den
 * gespendeten Diensten, und es gibt keine Route, die jemand anzapfen koennte.
 */
/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter({ fallback: '200.html' }) }
};
