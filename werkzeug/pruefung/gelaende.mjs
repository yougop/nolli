/**
 * Ein Paket mit Gelände erzeugen, an einem Ort mit Hang.
 *
 * Holt echte Daten: Ortssuche, Overpass und die Höhenkacheln. Deshalb nur bei
 * Bedarf laufen lassen — Overpass ist eine Spende.
 *
 * Braucht einen laufenden `vite preview` auf 5185.
 *
 *     node pruefung/gelaende.mjs <zielordner> ["Ort für die Suche"]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const exe = '/home/volker/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const ziel = process.argv[2]; fs.mkdirSync(ziel, { recursive: true });
const ort = process.argv[3] ?? 'Galceti, Prato';
const b = await puppeteer.launch({ executablePath: exe, headless: 'shell',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage();
await s.setViewport({ width: 1440, height: 900 });
s.on('pageerror', e => console.log('[fehler]', e.message));
await s.evaluateOnNewDocument(() => { try { localStorage.setItem('nolli.sprache', 'de'); } catch {} });
await s.goto('http://localhost:5185/', { waitUntil: 'networkidle2' });
const cdp = await s.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: ziel });
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const knopf = (t, prefix) => s.evaluate((t, prefix) => {
  const b = [...document.querySelectorAll('button')].find(x =>
    prefix ? x.textContent.trim().startsWith(t) : x.textContent.trim() === t);
  if (b && !b.disabled) { b.click(); return true; } return false;
}, t, !!prefix);
const bisKnopf = async (t, ms, prefix) => {
  for (let i = 0; i < ms / 500; i++) { if (await s.evaluate((t, prefix) => [...document.querySelectorAll('button')]
    .some(x => !x.disabled && (prefix ? x.textContent.trim().startsWith(t) : x.textContent.trim() === t)), t, !!prefix)) return true;
    await warte(500); }
  return false;
};

await s.$eval('#suchfeld', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
await s.type('#suchfeld', ort, { delay: 20 });
await s.waitForSelector('.treffer button', { timeout: 20000 });
console.log('Treffer:', await s.evaluate(() => document.querySelector('.treffer button')?.textContent?.trim()));
await s.click('.treffer button');
await warte(1500);
console.log('holen:', await knopf('Bestandsdaten holen', true));
console.log('Bestand da:', await bisKnopf('Weiter zur Ausgabe', 180000));
console.log('Gelände an:', await knopf('Gelände'));
console.log('Gelände geladen:', await bisKnopf('Gelände', 60000));
const titel = await s.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Gelände')?.title);
console.log('Titel:', titel);
console.log('3D:', await knopf('3D-Modell'));
await warte(8000);
await s.screenshot({ path: ziel + '/3d.png' });
await knopf('Weiter zur Ausgabe');
await warte(1500);
await s.screenshot({ path: ziel + '/ausgabe.png' });
console.log('Paket:', await knopf('Paket', true));
for (let i = 0; i < 60; i++) {
  await warte(5000);
  if (fs.readdirSync(ziel).some(n => n.endsWith('.zip'))) break;
}
console.log('Dateien:', fs.readdirSync(ziel).join(' · '));
await b.close();
