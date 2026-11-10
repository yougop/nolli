/**
 * Entwürfe aus DXF und 3DM einlesen und im Paket nachsehen.
 *
 * Legt die Testdateien selbst an: ein DXF in Millimetern ohne Einheit, ein
 * DXF in UTM, ein 3DM mit Netz, Flächenkörper ohne Renderdaten, Umriss und
 * je einem Körper auf einer Nolli-Ebene mit und ohne `body_id`: Nur der ohne kommt herein.
 *
 * Braucht einen laufenden `vite preview` auf 5185.
 *
 *     node pruefung/import.mjs <zielordner>
 */
import puppeteer from 'puppeteer-core';
import { unzipSync, strFromU8 } from 'fflate';
import rhino3dm from 'rhino3dm';
import fs from 'node:fs';
const exe = '/home/volker/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const ziel = process.argv[2]; fs.mkdirSync(ziel, { recursive: true });

const zeilen = (...p) => p.flat().join('\n') + '\n';
const lw = (e, pts, dicke) => ['0', 'LWPOLYLINE', '8', e, '90', pts.length, '70', '1', ...(dicke ? ['39', dicke] : []), ...pts.flatMap(([x, y]) => ['10', x, '20', y])];
const face = (e, q) => ['0', '3DFACE', '8', e, ...q.flatMap((p, n) => [`1${n}`, p[0], `2${n}`, p[1], `3${n}`, p[2]])];
/** Ein Quader aus sechs 3D-Flächen. */
const quaderFlaechen = (e, x, y, z, a, b, c) => {
  const P = (i, j, k) => [x + i * a, y + j * b, z + k * c];
  return [[P(0,0,0),P(0,1,0),P(1,1,0),P(1,0,0)],[P(0,0,1),P(1,0,1),P(1,1,1),P(0,1,1)],[P(0,0,0),P(1,0,0),P(1,0,1),P(0,0,1)],
    [P(1,0,0),P(1,1,0),P(1,1,1),P(1,0,1)],[P(1,1,0),P(0,1,0),P(0,1,1),P(1,1,1)],[P(0,1,0),P(0,0,0),P(0,0,1),P(0,1,1)]].flatMap((q) => face(e, q));
};
const dxf = (kopf, ent) => zeilen(['0','SECTION','2','HEADER'], kopf, ['0','ENDSEC','0','SECTION','2','ENTITIES'], ent, ['0','ENDSEC','0','EOF']);
// Millimeter, ohne Einheit, am Ursprung: gehört in die Blattmitte und wird als mm gelesen.
fs.writeFileSync(`${ziel}/mm.dxf`, dxf([], [...quaderFlaechen('haus', 0, 0, 0, 40000, 25000, 18000), ...lw('umriss', [[60000,0],[90000,0],[90000,20000],[60000,20000]], 12000)]));
// UTM 32N mitten in der HafenCity, in Metern.
fs.writeFileSync(`${ziel}/utm.dxf`, dxf(['9','$INSUNITS','70','6'], lw('bau', [[566483,5932400],[566543,5932400],[566543,5932440],[566483,5932440]], 20)));

const rh = await rhino3dm();
const f = new rh.File3dm();
f.settings().modelUnitSystem = rh.UnitSystem.Meters;
const nl = new rh.Layer(); nl.name = 'N_BUILDINGS'; const nIndex = f.layers().add(nl);
const meinL = new rh.Layer(); meinL.name = 'Entwurf'; const mIndex = f.layers().add(meinL);
const attr = (i) => { const a = new rh.ObjectAttributes(); a.layerIndex = i; return a; };
// Ein L als Netz, 24 m hoch, mit Schräge oben: Das zeigt, dass die Form erhalten bleibt.
const m = new rh.Mesh();
const V = [[0,0,0],[50,0,0],[50,20,0],[20,20,0],[20,50,0],[0,50,0],[0,0,24],[50,0,14],[50,20,14],[20,20,14],[20,50,24],[0,50,24]];
for (const v of V) m.vertices().add(...v);
const T = [[0,5,4],[0,4,3],[0,3,2],[0,2,1],[6,7,8],[6,8,9],[6,9,10],[6,10,11],[0,1,7],[0,7,6],[1,2,8],[1,8,7],[2,3,9],[2,9,8],[3,4,10],[3,10,9],[4,5,11],[4,11,10],[5,0,6],[5,6,11]];
for (const t of T) m.faces().addTriFace(...t);
f.objects().addMesh(m, attr(mIndex));
f.objects().addCurve(new rh.PolylineCurve([[100,0,0],[140,0,0],[140,30,0],[100,30,0],[100,0,0]]), attr(mIndex));
// Eine Extrusion trägt ohne Rhino keine Renderdaten: Sie muss als Quader ankommen.
f.objects().addExtrusion(rh.Extrusion.create(new rh.PolylineCurve([[200,0,0],[230,0,0],[230,30,0],[200,30,0],[200,0,0]]), 9, true), attr(mIndex));
// Auf einer Nolli-Ebene: Ohne Kennung ist es ein eigener Körper, mit `body_id` und passender Höhe Nollis Bestand.
f.objects().addMesh(m, attr(nIndex));
const marke = attr(nIndex); marke.setUserString('body_id', 'w123'); marke.setUserString('height_m', '24.00'); f.objects().addMesh(m, marke);
fs.writeFileSync(`${ziel}/entwurf.3dm`, f.toByteArray());

const b = await puppeteer.launch({ executablePath: exe, headless: 'shell', protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const s = await b.newPage(); await s.setViewport({ width: 1440, height: 900 });
s.on('pageerror', e => { if (!/shader/i.test(e.message)) console.log('[fehler]', e.message); });
await s.evaluateOnNewDocument(() => { try { localStorage.setItem('nolli.sprache', 'de'); } catch {} });
await s.goto('http://localhost:5185/', { waitUntil: 'networkidle2' });
const cdp = await s.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: ziel });
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const klick = (t) => s.evaluate((t) => { const x = [...document.querySelectorAll('button')].find(y => (y.querySelector('.wort, .lang')?.textContent ?? y.textContent).trim().startsWith(t)); if (x && !x.disabled) { x.click(); return true; } return false; }, t);
const info = () => s.evaluate(() => ({ wink: [...document.querySelectorAll('.importwink span')].map(x => x.textContent), fehler: document.querySelector('.fehler span')?.textContent, kopf: document.querySelector('.arbeit .fkopf')?.textContent.trim().replace(/\s+/g, ' '), zahlen: [...document.querySelectorAll('aside .entwurf dl.buch div')].slice(0, 3).map(d => d.textContent.trim().replace(/\s+/g, ' ')).join(' | ') }));
const laden = async (n) => { const h = await s.$('.arbeit input[type=file]'); await h.uploadFile(`${ziel}/${n}`); await warte(2500); console.log(n.padEnd(14), JSON.stringify(await info())); await s.screenshot({ path: `${ziel}/nach_${n}.png` }); };

await klick('HafenCity'); await warte(6000);
await klick('Weiter zum Entwerfen'); await warte(1500);
await laden('mm.dxf'); await laden('utm.dxf'); await laden('entwurf.3dm');
console.log('Drehknopf da:', await klick('+15')); await warte(400); await s.screenshot({ path: `${ziel}/gedreht.png` });
await s.keyboard.down('Control'); await s.keyboard.press('z'); await s.keyboard.up('Control'); await warte(400);
console.log('Strg+Z nimmt nur die Drehung:', JSON.stringify(await info()));
await klick('+15'); await warte(400);
await s.evaluate(() => [...document.querySelectorAll('.sichtleiste button')].find(x => x.querySelector('.lang')?.textContent.trim() === '3D-Modell')?.click()); await warte(6000);
await s.mouse.move(690, 480); for (let i = 0; i < 6; i++) { await s.mouse.wheel({ deltaY: -400 }); await warte(150); } await warte(3000);
await s.screenshot({ path: `${ziel}/3d.png` });
await klick('Weiter zur Ausgabe'); await warte(2000);
await s.evaluate(() => { const x = [...document.querySelectorAll('button')].find(y => y.textContent.trim().startsWith('Weitere Dateien')); if (x?.getAttribute('aria-expanded') === 'false') x.click(); }); await warte(500);
await klick('Paket');
let datei; for (let i = 0; i < 40 && !datei; i++) { await warte(4000); datei = fs.readdirSync(ziel).find(n => n.endsWith('.zip') && !n.endsWith('_model.zip')); }
await s.reload({ waitUntil: 'networkidle2' }); await warte(5000);
await s.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('Entwerfen') && x.querySelector('.ziffer'))?.click()); await warte(2000);
console.log('Nach Neuladen:', JSON.stringify(await info()));
await b.close();
if (!datei) { console.log('FEHLER: kein Paket'); process.exit(1); }
const zip = unzipSync(fs.readFileSync(`${ziel}/${datei}`));
const K = JSON.parse(strFromU8(zip['data/bodies.json'])).filter(x => x.design_id);
console.log('Körper:', K.map(x => `${x.body_id} ${x.height_m} m${x.imported_from ? ' ' + x.imported_from : ''}`).join(' · '));
const obj = strFromU8(zip['model.obj']);
const stuecke = obj.split(/^o /m).filter(x => x.startsWith('new_'));
console.log('OBJ:', stuecke.map(x => `${x.split('\n')[0]}: ${(x.match(/^f /gm) ?? []).length} f`).join(' · '));
console.log('Vertrag frame.new:', JSON.stringify(JSON.parse(strFromU8(zip['frame.json'])).new));
