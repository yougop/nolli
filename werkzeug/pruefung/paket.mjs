/**
 * Ein Paket aus dem gebauten Stand erzeugen und die Ausgaenge ausloesen.
 *
 * Nicht zum Spass: Zweimal hat dieser Umweg gefunden, was Typpruefung und
 * Bundle-Grep nicht finden konnten — einmal zwei verschiedene Namenssaetze
 * fuer dieselben drei Gruppen im erzeugten Vertrag, einmal zwei Knoepfe mit
 * derselben Aufschrift auf demselben Schirm. Beides war im Quelltext richtig
 * und in der Ausgabe falsch.
 *
 * Braucht einen laufenden `vite preview` auf 5185 — und zwar einen, der nach
 * dem letzten Build gestartet wurde: Ein aelterer Server liefert die alte
 * Dateiliste und die Seite bleibt weiss.
 *
 *     node pruefung/paket.mjs <zielordner>
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
// Die Knöpfe werden unten an ihrer deutschen Aufschrift gefunden.
await s.evaluateOnNewDocument(() => { try { localStorage.setItem('nolli.sprache', 'de'); } catch {} });
await s.goto('http://localhost:5185/', { waitUntil: 'networkidle2' });
const cdp = await s.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: ziel });
const klick = (t, prefix) => s.evaluate((t, prefix) => {
  const b = [...document.querySelectorAll('button')].find(x =>
    prefix ? x.textContent.trim().startsWith(t) : x.textContent.trim() === t);
  if (b) { b.click(); return true; } return false;
}, t, !!prefix);

await klick('HafenCity'); await new Promise(r => setTimeout(r, 6000));
console.log('Bäume an:', await klick('Bäume'));
console.log('3D:', await klick('3D-Modell'));
await new Promise(r => setTimeout(r, 6000));
await s.screenshot({ path: ziel + '/3d-baeume.png' });
console.log('zur Ausgabe:', await klick('Weiter zur Ausgabe'));
await new Promise(r => setTimeout(r, 2000));
console.log('Baumkronen-OBJ:', await klick('Baumkronen', true));
await new Promise(r => setTimeout(r, 4000));
console.log('Paket:', await klick('Paket', true));
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 5000));
  if (fs.readdirSync(ziel).some(n => n.endsWith('.zip'))) break;
}
console.log('Dateien:', fs.readdirSync(ziel).join(' · '));
await b.close();
