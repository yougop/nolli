/**
 * Ein Paket mit Neubau an einem Hang erzeugen und nachlesen.
 *
 * Zwei Fehler aus der Prüfung zu 1.0.0 lagen nur im Paket: Die Teile eines
 * Neubaus standen am Hang auf verschiedenen Böden, und Bäume unter dem Neubau
 * blieben in `data/trees.json`. Im Plan sah beides richtig aus.
 *
 * Braucht einen laufenden `vite preview` auf 5185, Netz für Overpass und Gelände.
 *
 *     node pruefung/neubau.mjs <zielordner> ["Ort für die Suche"]
 */
import puppeteer from 'puppeteer-core';
import { unzipSync, strFromU8 } from 'fflate';
import fs from 'node:fs';
const exe = '/home/volker/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const ziel = process.argv[2]; fs.mkdirSync(ziel, { recursive: true });
const ort = process.argv[3] ?? 'Galceti, Prato';
const b = await puppeteer.launch({ executablePath: exe, headless: 'shell',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage();
await s.setViewport({ width: 1440, height: 900 });
s.on('pageerror', e => { if (!/shader/i.test(e.message)) console.log('[fehler]', e.message); });
await s.evaluateOnNewDocument(() => { try { localStorage.setItem('nolli.sprache', 'de'); } catch {} });
await s.goto('http://localhost:5185/', { waitUntil: 'networkidle2' });
const cdp = await s.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: ziel });
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const knopf = (t) => s.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(t));
  if (b && !b.disabled) { b.click(); return true; } return false;
}, t);
const bis = async (t, ms) => {
  for (let i = 0; i < ms / 500; i++) {
    if (await s.evaluate((t) => [...document.querySelectorAll('button')].some(x => !x.disabled && x.textContent.trim().startsWith(t)), t)) return true;
    await warte(500);
  }
  return false;
};
const zug = async (von, nach, mods = []) => {
  for (const m of mods) await s.keyboard.down(m);
  await s.mouse.move(...von); await s.mouse.down();
  for (let i = 1; i <= 12; i++) await s.mouse.move(von[0] + (nach[0] - von[0]) * i / 12, von[1] + (nach[1] - von[1]) * i / 12);
  await s.mouse.up(); await warte(300);
  for (const m of mods) await s.keyboard.up(m);
};

await s.$eval('#suchfeld', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
await s.type('#suchfeld', ort, { delay: 20 });
await s.waitForSelector('.treffer button', { timeout: 40000 });
await s.click('.treffer button'); await warte(1500);
await knopf('Bestandsdaten holen');
if (!await bis('Weiter zum Entwerfen', 180000)) { console.log('FEHLER: keine Daten'); await b.close(); process.exit(1); }
await knopf('Weiter zum Entwerfen'); await warte(1500);

const cx = 700, cy = 480;
await s.keyboard.press('t'); await warte(400);
await zug([cx - 50, cy], [cx + 50, cy + 10]);
const gepflanzt = await s.evaluate(() => parseInt(document.querySelector('.arbeit .fkopf em')?.textContent ?? '0', 10));
await s.keyboard.press('Escape'); await s.keyboard.press('b'); await warte(200);
await zug([cx - 110, cy - 60], [cx + 110, cy + 70], ['Alt']);
await s.keyboard.press('Escape'); await s.keyboard.press('u'); await warte(200);
await zug([cx - 60, cy - 30], [cx + 20, cy + 40]);
await s.keyboard.press('Escape'); await warte(200);

await knopf('3D-Modell'); await warte(1500);
await knopf('Gelände');
await bis('Gelände', 60000); await warte(5000);
await knopf('Weiter zur Ausgabe'); await warte(2000);
await s.evaluate(() => { const x = [...document.querySelectorAll('button')].find((y) => y.textContent.trim().startsWith('Weitere Dateien')); if (x?.getAttribute('aria-expanded') === 'false') x.click(); });
await warte(500);
await knopf('Paket');
let datei;
for (let i = 0; i < 60 && !datei; i++) { await warte(4000); datei = fs.readdirSync(ziel).find(n => n.endsWith('.zip') && !n.endsWith('_model.zip')); }
await b.close();
if (!datei) { console.log('FEHLER: kein Paket'); process.exit(1); }

const zip = unzipSync(fs.readFileSync(`${ziel}/${datei}`));
const json = (n) => JSON.parse(strFromU8(zip[n]));
const koerper = json('data/bodies.json').filter(x => x.design_id);
const boeden = new Set(koerper.map(x => x.base_m));
const ergaenzt = json('data/trees.json').filter(x => (x.origin ?? x.herkunft) === 'added').length;
const neu = json('frame.json').new;
console.log('Neubau-Körper:', koerper.length, '· Böden:', [...boeden].join(', '));
console.log('Gepflanzt im Fenster:', gepflanzt, '· im Paket:', ergaenzt);
console.log('new:', JSON.stringify(neu));
const gut = koerper.length >= 2 && boeden.size === 1 && !boeden.has(undefined) && gepflanzt > 0 && ergaenzt === 0 && neu?.length === 1;
console.log(gut ? 'In Ordnung.' : 'FEHLER');
process.exit(gut ? 0 : 1);
