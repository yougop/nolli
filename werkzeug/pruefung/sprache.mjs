/**
 * Die Oberfläche auf Englisch durchgehen und deutsche Reste melden.
 *
 * Lädt HafenCity, schaltet jede Darstellung und jeden Schritt einmal an und
 * sammelt allen sichtbaren Text samt `title` und `aria-label`. Gemeldet wird,
 * was Umlaute oder typisch deutsche Wörter enthält. Ortsnamen aus
 * OpenStreetMap stehen auf der Leinwand und fallen nicht darunter.
 *
 * Braucht einen laufenden `vite preview` auf 5185.
 *
 *     node pruefung/sprache.mjs <zielordner>
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const exe = '/home/volker/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const ziel = process.argv[2]; fs.mkdirSync(ziel, { recursive: true });
const b = await puppeteer.launch({ executablePath: exe, headless: 'shell',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage();
await s.setViewport({ width: 1440, height: 900 });
s.on('pageerror', e => console.log('[fehler]', e.message));
await s.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('nolli.sprache', 'en'); } catch {} });
await s.goto('http://localhost:5185/', { waitUntil: 'networkidle2' });
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const klick = (t) => s.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t);
  if (b) { b.click(); return true; } return false;
}, t);
const texte = new Set();
const sammeln = async () => {
  for (const x of await s.evaluate(() => {
    const aus = [document.body.innerText, document.documentElement.lang];
    for (const e of document.querySelectorAll('[title],[aria-label],[placeholder]'))
      aus.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '', e.getAttribute('placeholder') ?? '');
    return aus;
  })) for (const z of x.split('\n')) if (z.trim()) texte.add(z.trim());
};
await sammeln();
await s.screenshot({ path: ziel + '/1-frame.png' });
await klick('HafenCity'); await warte(6000);
await sammeln();
await s.screenshot({ path: ziel + '/2-cleanup.png' });
for (const d of ['Inverted', 'Line', 'Use', 'Top view', 'White model', 'Data depth', '3D model', 'Figure-ground']) {
  console.log(d, await klick(d)); await warte(1500); await sammeln();
}
await klick('3D model'); await warte(1500);
console.log('Terrain', await klick('Terrain')); await warte(8000); await sammeln();
await klick('Figure-ground'); await warte(800); await sammeln();
await klick('Polygon'); await sammeln(); await klick('Pick');
await klick('Continue to export'); await warte(1500);
await sammeln();
await s.screenshot({ path: ziel + '/3-export.png' });
await b.close();
const verdacht = /[äöüßÄÖÜ]|\b(und|der|die|das|nicht|mit|frei|keine|Kacheln|Gebäude|Rahmen|Bäume|Ebenen|Darstellung|Ausgabe|zurück|holen)\b/;
const reste = [...texte].filter((x) => verdacht.test(x));
console.log(reste.length ? 'Deutsche Reste:\n  ' + reste.join('\n  ') : 'Keine deutschen Reste.');
