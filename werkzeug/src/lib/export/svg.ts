/**
 * Die Pläne als SVG (Volker, 07.11.2026: „die 2D-Pläne genau so als
 * Pfadzeichnung exportieren; DXF bietet nur Kurven und sieht komplett anders
 * aus“).
 *
 * Statt den Plan ein zweites Mal zu beschreiben, zeichnet derselbe Zeichner
 * (`zeichneBlatt`) in eine Leinwand, die keine Bildpunkte setzt, sondern
 * SVG-Elemente schreibt. So ist die SVG deckungsgleich mit dem Bild. Die
 * Leinwand kann genau das, was `zeichneBlatt` braucht: Pfade, Kreise,
 * Füllen nach Gerade-Ungerade, Striche mit Strichelung, Deckkraft,
 * Verschieben und Drehen, Text, Beschneiden und ein eingebettetes Bild für die
 * Schattenlagen von Aufsicht und Weißmodell.
 *
 * - Ebenen: `zeichneBlatt` ruft an seinen Abschnitten `ebene(name)`; hier
 *   wird daraus je eine Gruppe, die Illustrator und Inkscape als Ebene lesen.
 * - Farben: als Hex mit eigener Deckkraft, weil nicht jedes Programm
 *   `rgba()` oder `hsl()` in SVG liest. Die Karten-Regler (Sättigung,
 *   Kontrast, Helligkeit) werden über `farbe` in jede Farbe gerechnet.
 * - Maß: Breite 841 mm wie DIN A1, dazu passend die Höhe. Die Strichstärken
 *   rechnet `Rahmen.strich` ohnehin auf A1, und der Maßstab im Plan stimmt.
 */
type Matrix = [number, number, number, number, number, number];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zahl = (n: number) => (Math.round(n * 100) / 100).toString();

type Zustand = {
	fillStyle: string; strokeStyle: string; lineWidth: number; globalAlpha: number;
	lineJoin: CanvasLineJoin; lineCap: CanvasLineCap; dash: number[];
	font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline;
	m: Matrix; offen: number;
};

export class SvgLeinwand {
	private teile: string[] = [];
	private stapel: Zustand[] = [];
	private z: Zustand = {
		fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
		lineJoin: 'miter', lineCap: 'butt', dash: [], font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
		m: [1, 0, 0, 1, 0, 0], offen: 0
	};
	private pfad: string[] = [];
	private ebeneOffen = false;
	private clipZaehler = 0;
	/** Zum Messen von Text und zum Vereinheitlichen von Farben. */
	private hilfe = document.createElement('canvas').getContext('2d')!;
	/** Wird für die Schattenlagen gelesen; Dichte 1. */
	readonly canvas: { width: number; height: number };

	constructor(readonly breite: number, readonly hoehe: number, private farbe: (rgb: [number, number, number]) => [number, number, number] = (c) => c) {
		this.canvas = { width: breite, height: hoehe };
	}

	// ---- Zustand ----------------------------------------------------------
	get fillStyle() { return this.z.fillStyle; } set fillStyle(v: string) { this.z.fillStyle = String(v); }
	get strokeStyle() { return this.z.strokeStyle; } set strokeStyle(v: string) { this.z.strokeStyle = String(v); }
	get lineWidth() { return this.z.lineWidth; } set lineWidth(v: number) { this.z.lineWidth = v; }
	get globalAlpha() { return this.z.globalAlpha; } set globalAlpha(v: number) { this.z.globalAlpha = v; }
	get lineJoin() { return this.z.lineJoin; } set lineJoin(v: CanvasLineJoin) { this.z.lineJoin = v; }
	get lineCap() { return this.z.lineCap; } set lineCap(v: CanvasLineCap) { this.z.lineCap = v; }
	get font() { return this.z.font; } set font(v: string) { this.z.font = v; }
	get textAlign() { return this.z.textAlign; } set textAlign(v: CanvasTextAlign) { this.z.textAlign = v; }
	get textBaseline() { return this.z.textBaseline; } set textBaseline(v: CanvasTextBaseline) { this.z.textBaseline = v; }
	// Ohne Wirkung in der SVG: Schatten des Bildschirmblatts, Bildglättung.
	shadowColor = ''; shadowBlur = 0; shadowOffsetX = 0; shadowOffsetY = 0;
	imageSmoothingEnabled = true; imageSmoothingQuality: ImageSmoothingQuality = 'low';
	setLineDash(d: number[]) { this.z.dash = [...d]; }
	getLineDash() { return [...this.z.dash]; }

	save() { this.stapel.push({ ...this.z, dash: [...this.z.dash], m: [...this.z.m] as Matrix, offen: 0 }); }
	restore() {
		const alt = this.stapel.pop();
		if (!alt) return;
		for (let i = 0; i < this.z.offen; i++) this.teile.push('</g>');
		this.z = alt;
	}

	// ---- Lage -------------------------------------------------------------
	private mal(x: number, y: number): [number, number] {
		const [a, b, c, d, e, f] = this.z.m;
		return [a * x + c * y + e, b * x + d * y + f];
	}
	private get mass() { const [a, b] = this.z.m; return Math.hypot(a, b); }
	translate(x: number, y: number) { const [a, b, c, d, e, f] = this.z.m; this.z.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y]; }
	rotate(w: number) {
		const [a, b, c, d, e, f] = this.z.m, co = Math.cos(w), si = Math.sin(w);
		this.z.m = [a * co + c * si, b * co + d * si, -a * si + c * co, -b * si + d * co, e, f];
	}
	scale(x: number, y: number) { const [a, b, c, d, e, f] = this.z.m; this.z.m = [a * x, b * x, c * y, d * y, e, f]; }
	setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.z.m = [a, b, c, d, e, f]; }
	getTransform() { const [a, b, c, d, e, f] = this.z.m; return new DOMMatrix([a, b, c, d, e, f]); }

	// ---- Pfad -------------------------------------------------------------
	beginPath() { this.pfad = []; }
	moveTo(x: number, y: number) { const [px, py] = this.mal(x, y); this.pfad.push(`M${zahl(px)} ${zahl(py)}`); }
	lineTo(x: number, y: number) { const [px, py] = this.mal(x, y); this.pfad.push(`L${zahl(px)} ${zahl(py)}`); }
	closePath() { this.pfad.push('Z'); }
	rect(x: number, y: number, b: number, h: number) { this.moveTo(x, y); this.lineTo(x + b, y); this.lineTo(x + b, y + h); this.lineTo(x, y + h); this.closePath(); }
	/** Nur volle Kreise und Bögen ohne Scherung, wie `zeichneBlatt` sie zeichnet. */
	arc(x: number, y: number, r: number, a0: number, a1: number, gegen = false) {
		const rr = r * this.mass;
		const voll = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
		if (voll) {
			const [cx, cy] = this.mal(x, y);
			this.pfad.push(`M${zahl(cx + rr)} ${zahl(cy)}A${zahl(rr)} ${zahl(rr)} 0 1 0 ${zahl(cx - rr)} ${zahl(cy)}A${zahl(rr)} ${zahl(rr)} 0 1 0 ${zahl(cx + rr)} ${zahl(cy)}Z`);
			return;
		}
		const [sx, sy] = this.mal(x + r * Math.cos(a0), y + r * Math.sin(a0));
		const [ex, ey] = this.mal(x + r * Math.cos(a1), y + r * Math.sin(a1));
		const gross = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
		this.pfad.push(`${this.pfad.length ? 'L' : 'M'}${zahl(sx)} ${zahl(sy)}A${zahl(rr)} ${zahl(rr)} 0 ${gross} ${gegen ? 0 : 1} ${zahl(ex)} ${zahl(ey)}`);
	}

	// ---- Farbe ------------------------------------------------------------
	/** Jede Canvas-Farbe als Hex und Deckkraft, nach den Karten-Reglern. */
	private farbeVon(stil: string): { hex: string; alpha: number } {
		this.hilfe.fillStyle = '#000';
		this.hilfe.fillStyle = stil;
		const n = String(this.hilfe.fillStyle);
		let r = 0, g = 0, b = 0, a = 1;
		if (n.startsWith('#')) { const v = parseInt(n.slice(1, 7), 16); r = v >> 16 & 255; g = v >> 8 & 255; b = v & 255; }
		else { const t = n.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; [r, g, b] = t; a = t[3] ?? 1; }
		const [r2, g2, b2] = this.farbe([r, g, b]);
		const hex = '#' + [r2, g2, b2].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
		return { hex, alpha: a };
	}

	private schreiben(s: string) { this.teile.push(s); }

	fill(regel?: CanvasFillRule) {
		if (!this.pfad.length) return;
		const f = this.farbeVon(this.z.fillStyle), al = f.alpha * this.z.globalAlpha;
		if (al <= 0) return;
		this.schreiben(`<path d="${this.pfad.join('')}" fill="${f.hex}"${al < 1 ? ` fill-opacity="${zahl(al)}"` : ''}${regel === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`);
	}
	stroke() {
		if (!this.pfad.length) return;
		const f = this.farbeVon(this.z.strokeStyle), al = f.alpha * this.z.globalAlpha;
		if (al <= 0) return;
		const s = this.mass;
		const dash = this.z.dash.length ? ` stroke-dasharray="${this.z.dash.map((v) => zahl(v * s)).join(' ')}"` : '';
		this.schreiben(`<path d="${this.pfad.join('')}" fill="none" stroke="${f.hex}"${al < 1 ? ` stroke-opacity="${zahl(al)}"` : ''} stroke-width="${zahl(this.z.lineWidth * s)}" stroke-linejoin="${this.z.lineJoin}" stroke-linecap="${this.z.lineCap}"${dash}/>`);
	}
	fillRect(x: number, y: number, b: number, h: number) { this.beginPath(); this.rect(x, y, b, h); this.fill(); }
	strokeRect(x: number, y: number, b: number, h: number) { this.beginPath(); this.rect(x, y, b, h); this.stroke(); }
	/** Am Anfang jedes Blattes: nichts zu löschen. */
	clearRect() { /* leer */ }
	clip() {
		const id = `rand${++this.clipZaehler}`;
		this.schreiben(`<clipPath id="${id}"><path d="${this.pfad.join('')}"/></clipPath><g clip-path="url(#${id})">`);
		this.z.offen++;
	}

	// ---- Text -------------------------------------------------------------
	measureText(t: string) { this.hilfe.font = this.z.font; return this.hilfe.measureText(t); }
	private text(t: string, x: number, y: number, art: 'fill' | 'stroke') {
		const groesse = parseFloat(this.z.font.match(/([\d.]+)px/)?.[1] ?? '10');
		const gewicht = this.z.font.match(/^\s*(\d{3}|bold)/)?.[1] ?? '400';
		const familie = this.z.font.replace(/^.*?px\s*/, '');
		const anker = this.z.textAlign === 'center' ? 'middle' : this.z.textAlign === 'right' || this.z.textAlign === 'end' ? 'end' : 'start';
		const basis = this.z.textBaseline === 'middle' ? 'central' : this.z.textBaseline === 'top' ? 'hanging' : 'alphabetic';
		const [a, b, c, d, e, f] = this.z.m;
		const farbe = this.farbeVon(art === 'fill' ? this.z.fillStyle : this.z.strokeStyle);
		const al = farbe.alpha * this.z.globalAlpha;
		const malen = art === 'fill'
			? `fill="${farbe.hex}"${al < 1 ? ` fill-opacity="${zahl(al)}"` : ''}`
			: `fill="none" stroke="${farbe.hex}"${al < 1 ? ` stroke-opacity="${zahl(al)}"` : ''} stroke-width="${zahl(this.z.lineWidth)}" stroke-linejoin="round"`;
		this.schreiben(`<text transform="matrix(${[a, b, c, d, e, f].map((v) => (Math.round(v * 10000) / 10000).toString()).join(' ')})" x="${zahl(x)}" y="${zahl(y)}" font-family="${esc(familie)}" font-size="${zahl(groesse)}" font-weight="${gewicht}" text-anchor="${anker}" dominant-baseline="${basis}" ${malen}>${esc(t)}</text>`);
	}
	fillText(t: string, x: number, y: number) { this.text(t, x, y, 'fill'); }
	strokeText(t: string, x: number, y: number) { this.text(t, x, y, 'stroke'); }

	// ---- Bild -------------------------------------------------------------
	/** Die Schattenlagen: als eingebettetes PNG, in der Lage, in der sie liegen. */
	drawImage(bild: HTMLCanvasElement, x: number, y: number, b?: number, h?: number) {
		const bb = b ?? bild.width, hh = h ?? bild.height;
		const [a, bm, c, d, e, f] = this.z.m;
		const al = this.z.globalAlpha;
		this.schreiben(`<image transform="matrix(${[a, bm, c, d, e, f].join(' ')})" x="${zahl(x)}" y="${zahl(y)}" width="${zahl(bb)}" height="${zahl(hh)}" preserveAspectRatio="none"${al < 1 ? ` opacity="${zahl(al)}"` : ''} href="${bild.toDataURL('image/png')}"/>`);
	}

	// ---- Ebenen -----------------------------------------------------------
	/** Ein neuer Abschnitt des Plans als eigene Ebene. */
	ebene(name: string) {
		if (this.ebeneOffen) this.schreiben('</g>');
		this.schreiben(`<g id="${esc(name.replace(/\s+/g, '_'))}" inkscape:groupmode="layer" inkscape:label="${esc(name)}">`);
		this.ebeneOffen = true;
	}

	/** Die fertige Datei. */
	svg(titel: string, beschreibung: string) {
		while (this.stapel.length) this.restore();
		for (let i = 0; i < this.z.offen; i++) this.teile.push('</g>');
		this.z.offen = 0;
		if (this.ebeneOffen) { this.teile.push('</g>'); this.ebeneOffen = false; }
		const mmB = 841, mmH = (841 * this.hoehe) / this.breite;
		return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${zahl(mmB)}mm" height="${zahl(mmH)}mm" viewBox="0 0 ${this.breite} ${this.hoehe}">
<title>${esc(titel)}</title>
<desc>${esc(beschreibung)}</desc>
${this.teile.join('\n')}
</svg>
`;
	}
}
