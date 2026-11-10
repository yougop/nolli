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
  // Darstellungen tragen Lang- und Kurznamen (07.11.2026), Werkzeuge der Palette Wort und Kürzel (09.11.2026).
  const b = [...document.querySelectorAll('button')].find(x => (x.querySelector('.wort, .lang')?.textContent ?? x.textContent).trim() === t);
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
await klick('Polygon'); await sammeln(); await klick('Select');
// Seit 09.11.2026: der Schritt „Design“ zwischen Cleanup und Export.
await klick('Continue to design'); await warte(1500);
await sammeln();
for (const w of ['Green', 'Trees', 'Select', 'Building']) { await klick(w); await warte(300); await sammeln(); }
// Ein Gebäude zeichnen, damit Arbeitsfenster, Formen und Kennzahlen Text tragen.
const k = await s.evaluate(() => { const r = document.querySelector('.huelle canvas').getBoundingClientRect(); return [r.x + r.width * 0.55, r.y + r.height * 0.72]; });
await s.mouse.move(k[0] - 60, k[1] - 30); await s.mouse.down(); for (let i = 1; i <= 6; i++) await s.mouse.move(k[0] - 60 + i * 20, k[1] - 30 + i * 10); await s.mouse.up(); await warte(300); await sammeln();
for (const w of ['Raise', 'Courtyard']) { await klick(w); await warte(200); await sammeln(); }
await s.keyboard.press('v'); await klick('+ Setback storey'); await warte(300); await sammeln();
await s.keyboard.press('a'); await s.mouse.move(k[0] - 20, k[1] - 5); await s.mouse.down(); for (let i = 1; i <= 5; i++) await s.mouse.move(k[0] - 20 + i * 6, k[1] - 5 + i * 3); await s.mouse.up(); await warte(300); await sammeln();
await s.keyboard.press('Escape'); await warte(200); await sammeln(); await s.keyboard.press('Escape');
await s.screenshot({ path: ziel + '/3-design.png' });
await klick('Continue to export'); await warte(1500);
await sammeln();
await s.screenshot({ path: ziel + '/3-export.png' });
await b.close();
const verdacht = /[äöüßÄÖÜ]|\b(und|der|die|das|nicht|mit|frei|keine|Kacheln|Gebäude|Rahmen|Bäume|Ebenen|Darstellung|Ausgabe|zurück|holen)\b/;
const reste = [...texte].filter((x) => verdacht.test(x));
console.log(reste.length ? 'Deutsche Reste:\n  ' + reste.join('\n  ') : 'Keine deutschen Reste.');
