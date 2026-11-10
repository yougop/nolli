/**
 * Bereinigen und Entwerfen einmal durchspielen und Bilder ablegen.
 *
 * Wählt in Bereinigen ein Haus, zeichnet in Entwerfen ein Gebäude, eine
 * Staffel, einen Hof, einen Aufsatz und eine Grünfläche, pflanzt Bäume und
 * meldet, was die Arbeitsspalte links und die Kennzahlen rechts dabei zeigen.
 * Gedacht für den Blick nach einem Umbau der Oberfläche: Bei 1280×720 muss
 * alles, was man tun kann, ohne Scrollen zu sehen sein.
 *
 * Braucht einen laufenden `vite preview` auf 5185.
 *
 *     node pruefung/entwurf.mjs <zielordner> [breite] [hoehe]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const exe = '/home/volker/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const ziel = process.argv[2]; fs.mkdirSync(ziel, { recursive: true });
const B = Number(process.argv[3] ?? 1280), H = Number(process.argv[4] ?? 720);
const b = await puppeteer.launch({ executablePath: exe, headless: 'shell',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage();
await s.setViewport({ width: B, height: H });
s.on('pageerror', e => { if (!/shader/i.test(e.message)) console.log('[fehler]', e.message); });
await s.evaluateOnNewDocument(() => { try { localStorage.setItem('nolli.sprache', 'de'); } catch {} });
await s.goto('http://localhost:5185/', { waitUntil: 'networkidle2' });
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const bild = (n) => s.screenshot({ path: `${ziel}/${B}_${n}.png` });
/** Knopf an seiner Aufschrift; in der Palette zählt das Wort, in der Leiste der Langname. */
const klick = (t) => s.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find(x => (x.querySelector('.wort, .lang')?.textContent ?? x.textContent).trim() === t);
  if (b && !b.disabled) { b.click(); return true; } return false;
}, t);
const zug = async (von, nach, mods = [], n = 8) => {
  for (const m of mods) await s.keyboard.down(m);
  await s.mouse.move(...von); await s.mouse.down();
  for (let i = 1; i <= n; i++) await s.mouse.move(von[0] + (nach[0] - von[0]) * i / n, von[1] + (nach[1] - von[1]) * i / n);
  await s.mouse.up(); await warte(300);
  for (const m of mods) await s.keyboard.up(m);
};
/** Was links steht: Kopf des Arbeitsfensters, ob es scrollt, und was rechts unter der Falz liegt. */
const lage = () => s.evaluate(() => {
  const f = document.querySelector('.arbeit .fenster'), w = document.querySelector('.arbeit .wink'), sch = document.querySelector('aside');
  const fuss = document.querySelector('.fuss')?.getBoundingClientRect().top ?? innerHeight;
  const unter = [...document.querySelectorAll('aside .teil > .feld')].filter(x => x.getBoundingClientRect().top > fuss).map(x => x.textContent.trim().replace(/\s+/g, ' '));
  return {
    fenster: f ? f.querySelector('.fkopf')?.textContent.trim().replace(/\s+/g, ' ') : w ? '(Wink) ' + w.textContent.trim().slice(0, 40) : null,
    fensterScrollt: f ? f.scrollHeight - f.clientHeight : 0,
    aktiv: [...document.querySelectorAll('.palette .werk.an')].map(x => x.querySelector('.wort').textContent).join('+'),
    schieneUeberlauf: sch ? sch.scrollHeight - sch.clientHeight : null,
    unterFalz: unter.join(' | ')
  };
});
const melde = async (was) => console.log(was.padEnd(22), JSON.stringify(await lage()));
const kasten = () => s.evaluate(() => { const r = document.querySelector('.huelle canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

await klick('HafenCity'); await warte(6000);
// ---- Bereinigen
let k = await kasten();
await melde('S2 Grund'); await bild('s2_grund');
await s.mouse.click(k.x + k.w * 0.34, k.y + k.h * 0.42); await warte(300);
await melde('S2 Auswahl'); await bild('s2_auswahl');
// Streichen und mit Strg+Z zurück: Der Verlauf gilt in jedem Schritt.
const gestrichen = () => s.evaluate(() => [...document.querySelectorAll('aside dl.buch div')].find(d => d.textContent.includes('Gestrichen'))?.querySelector('dd')?.textContent.trim());
await klick('Streichen'); await warte(200); const nach = await gestrichen();
await s.keyboard.down('Control'); await s.keyboard.press('z'); await s.keyboard.up('Control'); await warte(200); const zurueck = await gestrichen();
await s.keyboard.down('Control'); await s.keyboard.press('y'); await s.keyboard.up('Control'); await warte(200);
console.log('S2 Streichen / Strg+Z / Strg+Y:', nach, '/', zurueck, '/', await gestrichen());
await s.keyboard.down('Control'); await s.keyboard.press('z'); await s.keyboard.up('Control'); await warte(200);
await s.keyboard.press('Escape'); await s.keyboard.press('p'); await warte(200);
for (const [fx, fy] of [[0.3, 0.3], [0.5, 0.3], [0.5, 0.5]]) { await s.mouse.click(k.x + k.w * fx, k.y + k.h * fy); await warte(100); }
await melde('S2 Polygon'); await bild('s2_polygon');
await s.keyboard.press('v'); await warte(200);
// ---- Entwerfen
await klick('Weiter zum Entwerfen'); await warte(1200);
k = await kasten();
const cx = k.x + k.w * 0.55, cy = k.y + k.h * 0.72;
await melde('S3 leer'); await bild('s3_leer');
await zug([cx - 70, cy - 35], [cx + 70, cy + 35], ['Alt']);
await melde('S3 Gebäude'); await bild('s3_gebaeude');
// Staffelgeschoss mit einem Klick, dann eine Aufstockung zeichnen
await klick('+ Staffelgeschoss'); await warte(300);
await melde('S3 Staffelgeschoss'); await bild('s3_staffel');
await s.keyboard.press('Escape'); await s.keyboard.press('a'); await warte(150);
await zug([cx - 30, cy], [cx + 10, cy + 22]);
await melde('S3 Hof'); await bild('s3_hof');
await s.keyboard.press('Escape'); await s.keyboard.press('u'); await warte(150);
await zug([cx + 25, cy - 5], [cx + 60, cy + 25]);
await melde('S3 Aufstockung'); await bild('s3_aufstockung');
await s.keyboard.press('Escape'); await warte(150);
await melde('S3 Gebäude+Formen'); await bild('s3_formen');
await s.keyboard.press('Escape'); await s.keyboard.press('g'); await warte(150);
await zug([cx - 260, cy - 30], [cx - 180, cy + 30]);
await melde('S3 Grün'); await bild('s3_gruen');
await s.keyboard.press('Escape'); await warte(150); await bild('s3_gruen_abgewaehlt');
await s.keyboard.press('t'); await warte(400);
await zug([cx - 120, cy + 60], [cx + 40, cy + 66], [], 14);
await zug([k.x + k.w * 0.22, k.y + k.h * 0.47], [k.x + k.w * 0.46, k.y + k.h * 0.45], [], 16);
await melde('S3 Bäume'); await bild('s3_baeume');
console.log('gepflanzt:', await s.evaluate(() => document.querySelector('.arbeit .fkopf em')?.textContent.trim()));
// Das Aussehen der Bäume: Fenster aus der Leiste, über der Arbeitsspalte
await s.evaluate(() => document.querySelector('.sichtleiste .klappknopf.wort')?.click()); await warte(400);
await bild('s3_baumfenster');
console.log('Bäume-Fenster verdeckt Blatt:', await s.evaluate(() => { const f = document.querySelector('.baumfenster')?.getBoundingClientRect(), h = document.querySelector('.huelle')?.getBoundingClientRect(); const sp = document.querySelector('.arbeit')?.getBoundingClientRect(); return f && sp ? Math.max(0, Math.round(f.right - sp.right)) + ' px über die Arbeitsspalte hinaus' : 'kein Fenster'; }));
await s.keyboard.press('Escape'); await warte(300);
await s.keyboard.press('v'); await warte(200);
await s.keyboard.press('b'); await s.keyboard.press('p'); await warte(150);
for (const [dx, dy] of [[150, -60], [220, -60], [220, 0]]) { await s.mouse.click(cx + dx, cy + dy); await warte(100); }
await melde('S3 Polygon'); await bild('s3_polygon');
await s.keyboard.press('Enter'); await warte(300);
await melde('S3 nach Enter');
await s.keyboard.press('Delete'); await warte(200);
await s.keyboard.down('Control'); await s.keyboard.press('z'); await s.keyboard.up('Control'); await warte(300);
await melde('S3 Löschen, Strg+Z');
console.log('Kennzahlen:', await s.evaluate(() => [...document.querySelectorAll('aside .entwurf dl.buch div')].map(d => d.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));
await klick('Weißmodell') || await klick('Weiß'); await warte(2000); await bild('s3_weiss');
await s.evaluate(() => { const x = [...document.querySelectorAll('.sichtleiste button')].find((x) => x.querySelector('.lang')?.textContent.trim() === '3D-Modell'); x?.click(); });
await warte(6500); await melde('S3 3D'); await bild('s3_3d');
await klick('Schwarzplan') || await klick('Schwarz'); await warte(800);
await klick('Weiter zur Ausgabe'); await warte(1500);
await bild('s4');
await s.evaluate(() => [...document.querySelectorAll('.fuss button')].find(x => x.classList.contains('zweit'))?.click()); await warte(1200);
console.log('S4 Druck:', await s.evaluate(() => { const f = document.querySelector('.druckfenster'); return f ? { ueberlauf: f.scrollHeight - f.clientHeight, schwarz: [...document.querySelectorAll('.fuss .haupt, .druckfuss .haupt')].filter(x => !x.classList.contains('zweit') || x.classList.contains('an')).map(x => x.textContent.trim().slice(0, 18)) } : null; }));
await bild('s4_druck');
await b.close();
