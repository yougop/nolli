import adapter from '@sveltejs/adapter-static';
import { execSync } from 'node:child_process';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Nolli wird als blosser Dateiordner ausgeliefert.
 *
 * Es gibt keinen eigenen Server mehr: Bestand und Ortssuche fragt die Seite
 * direkt aus dem Browser (siehe `src/lib/quelle.ts`). Damit laeuft Nolli auf
 * jedem Webspace, jeder Besucher redet mit seiner eigenen Adresse mit den
 * gespendeten Diensten, und es gibt keine Route, die jemand anzapfen koennte.
 */
/**
 * Die Fassung in `_app/version.json` ist der Git-Stand, nicht `Date.now()`:
 * Mit der Uhrzeit änderte sich der Fingerabdruck des Builds bei jedem
 * Neubau derselben Quellen, und `pruefung/stand.mjs seither` konnte nie
 * „unverändert“ melden (Fund der Fehlersuche, 05.11.2026).
 */
const stand = (() => {
	try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'ohne-git'; }
})();

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter({ fallback: '200.html' }), version: { name: stand } }
};
