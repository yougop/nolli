---
name: Nolli
description: Grauleiter, ein Akzent, jede Bedienung neben ihrer Zahl — das Zeichenwerk für maßstäblich verankerte Bestandsgrundlagen.
colors:
  grund: "#fafafa"
  blatt: "#ffffff"
  senke: "#f2f2f2"
  linie: "#e6e6e6"
  linie-stark: "#cfcfcf"
  tinte: "#111111"
  tinte-2: "#616161"
  tinte-3: "#737373"
  akzent: "#a6c23f"
  akzent-tief: "#5d7a16"
  akzent-flor: "rgba(166, 194, 63, 0.16)"
  warn: "#8a4b12"
  warn-flor: "rgba(138, 75, 18, 0.1)"
  stift-gruen: "#f0f0f0"
  stift-wasser: "#e6e6e6"
  stift-strasse: "#cfcfcf"
  stift-gestrichen: "#c3c3c3"
  stift-bahn: "#a6a6a6"
  stift-gebaeude: "#111111"
  stift-plangebiet: "#8ca82f"
typography:
  display:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  prose:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Satoshi, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.11em"
  data:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
    fontFeature: "tabular-nums"
rounded:
  klein: "2px"
  rund: "4px"
  kreis: "50%"
spacing:
  haar: "2px"
  eng: "4px"
  reihe: "6px"
  naht: "9px"
  block: "12px"
  teil: "16px"
  rand: "18px"
  buehne: "28px"
components:
  button-haupt:
    backgroundColor: "{colors.tinte}"
    textColor: "{colors.blatt}"
    typography: "{typography.title}"
    rounded: "{rounded.rund}"
    padding: "11px 14px"
    width: "100%"
  button-haupt-gesperrt:
    backgroundColor: "{colors.tinte}"
    textColor: "{colors.blatt}"
  button-haupt-arbeitet:
    backgroundColor: "{colors.tinte}"
    textColor: "{colors.blatt}"
  button-wahl:
    backgroundColor: "{colors.grund}"
    textColor: "{colors.tinte-2}"
    rounded: "{rounded.rund}"
    padding: "7px 4px"
  button-wahl-an:
    backgroundColor: "{colors.tinte}"
    textColor: "{colors.blatt}"
  button-schritt:
    backgroundColor: "transparent"
    textColor: "{colors.tinte-2}"
    rounded: "{rounded.rund}"
    padding: "6px 13px 6px 9px"
  button-schritt-jetzt:
    backgroundColor: "{colors.senke}"
    textColor: "{colors.tinte}"
  input-suche:
    backgroundColor: "{colors.grund}"
    textColor: "{colors.tinte}"
    rounded: "{rounded.rund}"
    padding: "9px 11px"
    width: "100%"
  karte-ausgabe:
    backgroundColor: "{colors.grund}"
    textColor: "{colors.tinte}"
    rounded: "{rounded.rund}"
    padding: "10px 12px"
  urteil:
    backgroundColor: "{colors.grund}"
    textColor: "{colors.tinte-2}"
    typography: "{typography.prose}"
    rounded: "{rounded.rund}"
    padding: "9px 11px"
  urteil-mahnt:
    backgroundColor: "{colors.warn-flor}"
    textColor: "{colors.warn}"
---

# Design System: Nolli

## Overview

**Creative North Star: "Die Stifttabelle"**

Nolli sieht aus wie das, was es ausgibt: ein Blatt, ein Rahmen, eine Feder je Ebene. Der Bildschirm ist keine Vorschau auf die Zeichnung, er ist derselbe Zeichner bei kleinerer Pixelbreite — `zeichnen.ts` bedient Schirm und 4096-Pixel-Ausgabe aus einer Routine. Daraus folgt die ganze Oberfläche: Flächen statt Panels, Haarlinien statt Rahmen, ein einziger lebendiger Ton in einer sonst vollständig entsättigten Welt.

Die Welt ist monochrom aus Pflicht, nicht aus Geschmack. Ein Bestandsplan trennt seine Ebenen über den Wert, wie ein Schwarzplan; Grün und Wasser sind hier deshalb reine Grauwerte (`#F0F0F0`, `#E6E6E6`), und selbst der fremde Kartenstil von OpenFreeMap wird beim Laden wahrnehmungsgewichtet auf die Grauleiter gezogen, bevor die Karte ihn zu sehen bekommt. Was übrig bleibt vom Farbvorrat, gehört dem Akzent — und der gehört nur dem, was gerade lebt.

Die Dichte ist die einer Werkbank, nicht einer Marketingseite: 14px Grundschrift, 16–18px Innenabstände, Trennung durch eine 1px-Linie statt durch Abstand. Der Ernst kommt aus der Zahl. Jede Bedienung steht neben dem Wert, den sie erzeugt, und jede Zahl steht in JetBrains Mono mit Tabellenziffern, damit sie beim Ziehen des Rahmens nicht springt.

**Key Characteristics:**
- Eine Grauleiter von `#FAFAFA` bis `#111111`, ein einziger Akzent `#A6C23F`
- Farbe trägt keine Ebenenbedeutung — Ebenen werden über den Wert getrennt
- Haarlinien (1px, `--linie`) als einziges Trennmittel; Flächen, keine Karten
- Satoshi 400/500/700 für Sprache, JetBrains Mono 400/500 ausschließlich für Messwerte
- Radius 4px, kein größerer; die Leinwand selbst hat keinen
- Zwei Schemata, hell und dunkel, aus derselben Tokenliste

## Colors

Eine feine, fast rauschfreie Grauleiter mit einem einzigen olivgrünen Signalton, der so selten vorkommt, dass er als Zustandsanzeige gelesen wird.

### Primary
- **Plotterolive** (`#a6c23f`): Der einzige Farbton des Systems. Er trägt vier Dinge und sonst nichts: den Rahmen, das Plangebiet, die aktuelle Auswahl und den Ring der Hauptaktion. Im hellen Schema zeichnet der Plan in der abgedunkelten Variante `#8CA82F`, damit die Linie auf Weiß denselben Kontrast hat wie auf Schwarz.
- **Tiefolive** (`#5d7a16`): Nur für Zustände, die Kontrast gegen Weiß brauchen — der Fokusring (`2px`, Offset `2px`) und die Akzentfarbe der Checkbox.
- **Olivflor** (`rgba(166,194,63,0.16)`): Textmarkierung (`::selection`). Nie als Flächenfüllung eines Bedienelements.

### Neutral
- **Grund** (`#fafafa`): Der Untergrund der Anwendung und die Füllung eingelassener Felder (Suchfeld, Ausgabekarten, Urteilskasten).
- **Blatt** (`#ffffff`): Erhobene Flächen — Kopf, Schiene, Statuszeile, Kartensteuerung, und die Leinwand des Plans selbst.
- **Senke** (`#f2f2f2`): Der Kartenhintergrund und die Füllung eines aktiven oder überfahrenen Schritts.
- **Linie** (`#e6e6e6`): Die Haarlinie. Jede Trennung im System ist diese eine Linie.
- **Linie stark** (`#cfcfcf`): Nur als Antwort auf Zeigen — die Randfarbe, die ein Knopf oder Feld beim Überfahren oder Fokussieren annimmt.
- **Tinte** (`#111111`): Fließtext, Gebäudefüllung im Plan, und die Fläche der Hauptaktion.
- **Tinte 2** (`#616161`): Beschriftungen, Begriffe in Wertepaaren, Statuszeile.
- **Tinte 3** (`#737373`): Nachgeordnetes — Platzhalter, Strichbreitenangaben, Rechtehinweis, gesperrte Schrift.
- **Mahnung** (`#8a4b12`): Der einzige Nicht-Grau-Nicht-Akzent-Ton. Er erscheint, wenn eine Zahl das Ergebnis unbrauchbar macht (Meter je Pixel zu grob) oder eine Ausgabe scheitert, immer zusammen mit `warn-flor` als Fläche.

### Die Stifte (semantisches Ebenensystem)
Die Zeichnung hat ihre eigene Tabelle: jede Ebene hat einen Grauwert, eine Strichbreite in Millimetern auf DIN A1 und einen DXF-Ebenennamen. Die Strichbreite ist das eigentliche Unterscheidungsmittel, nicht der Wert allein.

| Ebene | Wert (hell) | mm auf A1 | DXF |
|---|---|---|---|
| Grün | `#F0F0F0` | 0.13 | `N_GRUEN` |
| Wasser | `#E6E6E6` | 0.13 | `N_WASSER` |
| Straßen | `#CFCFCF` | 0.18 | `N_STRASSE` |
| Gestrichen | `#C3C3C3` | 0.18 | `N_GESTRICHEN` |
| Bahn | `#A6A6A6` | 0.35 | `N_BAHN` |
| Gebäude | `#111111` | 0.25 | `N_GEBAEUDE` |
| Erhalt | `#111111` | 0.50 | `N_ERHALT` |
| Plangebiet | `#8CA82F` | 0.70 | `N_PLANGEBIET` |
| Rahmen | `#8CA82F` | 0.70 | `N_RAHMEN` |

### Named Rules

**The Wertleiter Rule.** Farbe trägt keine Ebenenbedeutung. Ebenen werden über den Grauwert und die Strichbreite unterschieden, wie in einem Schwarzplan — Wasser und Grün eingeschlossen. Eine neue Ebene bekommt einen Platz auf der Grauleiter und eine Millimeterbreite, keinen Farbton.

**The Akzent gehört dem Lebendigen Rule.** `#A6C23F` gehört dem Rahmen, dem Plangebiet, der aktuellen Auswahl und dem Ring der Hauptaktion. Nichts Fünftes. Ein Element, das den Akzent bekommen will, muss erklären, welches dieser vier es ist.

**The Fremde Farbe wird eingezogen Rule.** Material, das von außen kommt und Farbe mitbringt — der Kartenstil, künftige Bilddaten — wird wahrnehmungsgewichtet (`0.2126 R + 0.7152 G + 0.0722 B`) auf seinen Grauwert gezogen, Deckung bleibt erhalten. Die Welt wird nicht um ein Fremdmaterial herum aufgeweicht.

## Typography

**Display / Body Font:** Satoshi (selbst gehostet, 400/500/700, Fallback `ui-sans-serif, system-ui`)
**Mono / Data Font:** JetBrains Mono (selbst gehostet, 400/500, Fallback `ui-monospace, SF Mono, Menlo`)

**Character:** Satoshi spricht, JetBrains Mono misst. Satoshi ist eng geführt (Überschriften bei `-0.022em` bis `-0.03em`), sachlich und ohne Schnörkel; JetBrains Mono erscheint nur dort, wo eine Ziffer steht, und immer mit `tabular-nums`, damit sich beim Ziehen des Rahmens nur die Ziffer ändert und nicht die Spaltenbreite.

### Hierarchy
- **Display** (Mono 500, 19px, `-0.02em`, Tabellenziffern): Die zwei Hauptmaße des Rahmens, Breite und Höhe in Metern. Der größte Text im Bild ist eine Zahl, nicht eine Überschrift.
- **Headline** (Satoshi 700, 15px, `-0.03em`): Die Wortmarke im Kopf. Der zweite Wortteil steht in 500 und `--tinte-3`.
- **Title** (Satoshi 500, 13px): Wertzeilen, Treffernamen, Titel einer Ausgabekarte, Beschriftung der Hauptaktion (13.5px).
- **Body** (Satoshi 400, 14px, 1.5): Grundschrift des Dokuments; Bedienelemente laufen dichter bei 12.5px.
- **Prose** (Satoshi 400, 12px, 1.45, `--tinte-2`): Die erklärenden Absätze — das Urteil über die Tragfähigkeit, die Hinweise. In der leisen Variante `--tinte-3`.
- **Label** (Satoshi 500, 10.5px, `0.11em`, Versalien, `--tinte-2`): Die Feldbeschriftung über jeder Gruppe in der Schiene. Sie benennt das Feld darunter; sie ist keine Rubrik und kein Aufreißer.
- **Data** (Mono 400, 10.5–13px, `-0.01em`, Tabellenziffern): Jede Zahl, Koordinate und Anzahl — Statuszeile, Ebenenzählung, Strichbreiten, Zeigerkoordinate, `frame.json`.

### Named Rules

**The Mono ist für Messwerte Rule.** JetBrains Mono erscheint ausschließlich bei Messungen, Koordinaten, Anzahlen und Rohdaten. Ein Wort, das keine Zahl ist, steht in Satoshi. Jede Mono-Stelle trägt `tabular-nums`.

**The Zahl ist die Überschrift Rule.** Der größte Text einer Ansicht ist der Messwert, den der Nutzer gerade erzeugt hat. Keine Display-Überschrift überbietet ihn.

## Layout

Drei Zeilen über die volle Höhe (`100dvh`): Kopf `56px`, Fläche `minmax(0,1fr)`, Statuszeile `38px`. Die Fläche teilt sich in die Bühne (`1fr`) und die Schiene rechts (`348px`, feste Breite, eigener Bildlauf).

Die Bühne trägt entweder die Karte (flach auf `--senke`) oder das Blatt (weicher Radialverlauf `radial-gradient(120% 90% at 50% 0%, #ffffff, #f4f4f4 55%, #ededed)` mit einer Kornstruktur bei 5.5% Deckung im hellen, 10% im dunklen Schema). Die Leinwand steht mittig mit `28px` Luft ringsum und folgt dem Seitenverhältnis der Ausgabe.

Die Schiene ist in Teile zerlegt, jeder mit `16px 18px` Innenabstand und einer unteren Haarlinie. Der Fuß klebt unten (`position: sticky`) und trägt die Hauptaktion über die volle Breite. Der Rhythmus ist durchweg 4-basiert: `2 / 4 / 6 / 9 / 12 / 16 / 18 / 28`.

Ein einziger Umbruchpunkt bei `940px`: die Schiene rutscht unter die Bühne, die Bühne nimmt das Seitenverhältnis des Blattes an (bei der Karte feste `56vh`), die Schrittleiste wird zur vollbreiten Reihe gleicher Teile, Kopf und Statuszeile brechen um.

### Named Rules

**The Bedienung neben ihrer Zahl Rule.** Jedes Bedienelement steht im selben Teil wie der Wert, den es erzeugt: Seitenverhältnis und Ausgabebreite über der Maßliste, Auswahl über der Buchführung, Bildfassung über der Ausgabe. Eine Einstellung, deren Folge man nicht im selben Blick sieht, gehört nicht in die Schiene.

**The Statuszeile lügt nicht Rule.** EPSG, Meter je Pixel, Maßstab auf A1 und Objektanzahl stehen dauerhaft am unteren Rand in Mono. Steht kein Rahmen, sagt die Zeile das ausdrücklich, statt leer zu bleiben.

## Elevation & Depth

Das System ist im Kern flach und arbeitet über Wert und Haarlinie: `--blatt` liegt über `--grund`, `--senke` liegt darunter, `--linie` trennt. Schatten kommen nur an drei Stellen vor, und jedes Mal, weil etwas physisch über der Bühne schwebt.

### Shadow Vocabulary
- **Heben** (`0 1px 2px rgba(17,17,17,0.05), 0 12px 32px -12px rgba(17,17,17,0.14)`): Ausschließlich unter der Plan-Leinwand. Das Blatt liegt auf dem Feld, und dieser Schatten ist der ganze Grund, warum man es als Blatt liest.
- **Heben klein** (`0 1px 2px rgba(17,17,17,0.06)`): Schwebende Kartensteuerung über der Karte — die eigenen Werkzeugknöpfe und die eingezogene MapLibre-Gruppe.

Im dunklen Schema werden beide tiefer und weicher (`0 14px 36px -14px rgba(0,0,0,0.7)`).

### Named Rules

**The Schatten heißt Schweben Rule.** Ein Schatten erscheint nur unter etwas, das buchstäblich über der Bühne liegt: das Blatt und die Kartensteuerung. Flächen in der Schiene, Knöpfe, Felder und Karten bleiben flach; ihre Tiefe kommt aus `--grund` gegen `--blatt` und einer Haarlinie.

**The Plan-Schatten ist gemessen Rule.** Der Schlagschatten im Weißmodell ist kein Stilmittel, sondern eine Projektion: Versatz `= Höhe × 0.45 / Meter-je-Pixel`, gezeichnet in `#D6D6D2` (hell) bzw. `#0D0F10` (dunkel). Er gilt nur auf der Leinwand und wird nie in die Oberfläche übernommen.

## Shapes

Eine einzige Rundung, `4px` (`--rund`), für alles Bediente: Knöpfe, Felder, Karten, Trefferliste, Meldungen. `2px` für das Kleinste (Ebenenprobe, Koordinatenfähnchen, Fokusring). `50%` nur für echte Kreise — die Schrittziffer, den Suchpuls, den Ring der Hauptaktion.

Die Plan-Leinwand hat keine Rundung. Sie ist ein Rechteck mit dem Seitenverhältnis der Ausgabedatei, und jede Rundung würde behaupten, die Datei hätte eine.

Ränder sind durchweg `1px solid var(--linie)`; der einzige Randwechsel im System ist `--linie` → `--linie-stark` als Antwort auf Zeigen oder Fokus. Linien im Plan sind rund abgeschlossen (`lineJoin`/`lineCap: round`), die Bahn gestrichelt, das Plangebiet gestrichelt im Akzent.

## Components

### Buttons
- **Shape:** Leicht gebrochene Ecken (`4px`), Rand `1px`.
- **Hauptaktion:** Tintenfläche auf Blatt-Schrift, volle Breite, `11px 14px`, 13.5px/500, mit einem `11px`-Akzentring links der Beschriftung. Sie sitzt immer im klebenden Fuß der Schiene, eine je Schritt.
- **Hover / Focus:** Hauptaktion nimmt `opacity: 0.88` (120ms). Alle übrigen Knöpfe wechseln nur die Randfarbe auf `--linie-stark`. Fokus ist systemweit ein `2px`-Ring in Tiefolive mit `2px` Offset.
- **Gesperrt vs. Arbeitend:** Gesperrt ist `opacity: 0.4`, `cursor: not-allowed`. Arbeitend ist voll deckend (`opacity: 1`, `cursor: progress`), der Ring dreht sich in 900ms, die Beschriftung wechselt auf die Tätigkeit („Holt Bestandsdaten …", „Zeichnet das Blatt …").
- **Wahlreihe:** Gleich breite Knöpfe auf `--grund`, 12.5px/500, mit einer Mono-Unterzeile in `--tinte-3` (der Rohwert, z. B. `4096`). Gewählt heißt Umkehr: Tintenfläche, Blatt-Schrift.
- **Tatzeile (Streichen / Erhalten / Zurück):** gleiche Form, ohne Umkehrzustand; gesperrt, solange nichts gewählt ist.

### Inputs / Fields
- **Style:** Volle Breite, `9px 11px`, Füllung `--grund`, Rand `--linie`, Radius `4px`, geerbte Schrift.
- **Focus:** Rand auf `--linie-stark`, Fokusring mit `1px` Offset.
- **Arbeitszustand:** Ein `6px`-Punkt im Akzent rechts im Feld, der in 900ms pulst, solange gesucht wird.
- **Trefferliste:** Rahmenloser Stapel in einem `4px`-Kasten, Zeilen durch Haarlinien getrennt, Titel 13px/500, Ort 11.5px in `--tinte-2`, Hover `--senke`.

### Navigation
- **Schrittleiste:** Drei Knöpfe mittig im Kopf. Jeder trägt eine `18px`-Kreisziffer in Mono. Ruhend: `--tinte-2`, durchsichtig. Aktuell: Fläche `--senke`, Rand `--linie`, Ziffer umgekehrt (Tintenkreis, Blatt-Ziffer). Gesperrt: `--tinte-3` mit einem Titel, der sagt, was zuerst zu tun ist.

### Cards / Containers
- **Ausgabekarte:** Zwei-Spalten-Raster auf `--grund`, `10px 12px`, Radius `4px`, Rand `--linie`. Titel 13px/500, rechts ein Mono-Etikett mit dem, was herauskommt (`DXF · 9 Ebenen`), darunter über die volle Breite eine Zeile in `--tinte-3`, die den Inhalt der Datei beschreibt. Beim Schreiben wechselt das Mono-Etikett auf `schreibt …` und die Karte auf `opacity: 0.5`, `cursor: wait`.
- **Urteilskasten:** Ein Absatz in 12px über der Tragfähigkeit des Rahmens, ruhend auf `--grund` mit Haarlinie. Schlägt der Prüfwert um, färbt der ganze Kasten auf `--warn` über `--warn-flor` ohne Rand — und dieselben zwei Wertzeilen (Meter je Pixel, Prüfpixel) färben mit.
- **Wertliste:** Begriff links in 12px `--tinte-2`, Wert rechts in Mono 13px/500, Zeilen durch Haarlinien getrennt. Die zwei Hauptmaße stehen in 19px.

### Ebenenliste (Signature)
Eine Zeile je Stift, als 4-Spalten-Raster: `14px`-Farbprobe (gefüllt bei Flächenebenen, sonst nur `1.5px` Rand), Name, Strichbreite in Mono `--tinte-3`, Anzahl rechtsbündig in Mono. Ausgeschaltet heißt `opacity: 0.38`, leer heißt `0.3` und gesperrt. Überfahren hebt dieselbe Ebene im Plan hervor, indem ihre Strichbreite auf das 2.4-fache geht — nicht indem sie die Farbe wechselt.

### Rahmenwerkzeug (Signature)
Über der Karte liegt eine SVG-Ebene: ein Schleier `rgba(15,17,19,0.34)` mit ausgespartem Rechteck, das Rechteck selbst als `2px`-Akzentlinie, zwei gestrichelte Achsenkreuze im Akzent bei 55% Deckung, und vier `12px`-Eckgriffe in Blattweiß mit Akzentrand. Die Karte selbst trägt keine Werkzeugleiste außer zwei beschrifteten Knöpfen unten links („Neu aufziehen", „Rahmen einpassen") in Blattweiß mit kleinem Heben.

### Plan-Leinwand (Signature)
Ein `canvas` mit Blattweiß und dem Heben-Schatten, ohne Rundung, im Seitenverhältnis der Ausgabedatei. Derselbe Zeichner füllt sie wie die 4096-Pixel-Datei. Nach einem Datenlauf zieht sie einmal von links auf (`clip-path: inset(0 100% 0 0)` → `0`, 800ms, `cubic-bezier(0.16,1,0.3,1)`) — der einzige gestaltete Bewegungsmoment des Systems. Beim Überfahren zeigt ein Mono-Fähnchen unten rechts die UTM-Koordinate.

## Do's and Don'ts

### Do:
- **Do** jede neue Ebene über Grauwert und Strichbreite in Millimetern auf A1 einführen, nicht über einen Farbton.
- **Do** den Akzent `#A6C23F` auf Rahmen, Plangebiet, aktuelle Auswahl und den Ring der Hauptaktion beschränken.
- **Do** jede Zahl in JetBrains Mono mit `tabular-nums` setzen und jedes Wort in Satoshi.
- **Do** jede Einstellung im selben Teil zeigen wie den Wert, den sie erzeugt.
- **Do** den arbeitenden Zustand eines Knopfes voll deckend halten (`opacity: 1`, `cursor: progress`) und die Beschriftung auf die Tätigkeit wechseln; die wartende Beschriftung ist die eine Zeile, die gelesen wird.
- **Do** mit `1px solid var(--linie)` trennen und beim Zeigen nur auf `--linie-stark` wechseln.
- **Do** fremdes Material (Kartenstile, Bilder) beim Eintritt wahrnehmungsgewichtet entfärben.
- **Do** `--warn` samt `--warn-flor` einsetzen, wenn eine Zahl das Ergebnis unbrauchbar macht, und den Grund in einem Satz danebenschreiben.

### Don't:
- **Don't** eine zweite Akzentfarbe einführen oder den Akzent als Flächenfüllung eines Bedienelements verwenden.
- **Don't** Schatten unter Flächen der Schiene legen; Schatten bedeutet Schweben über der Bühne, nichts anderes.
- **Don't** die Plan-Leinwand runden oder beschneiden — sie muss das Seitenverhältnis der Datei zeigen.
- **Don't** eine Rundung über `4px` einführen.
- **Don't** Bildschirm und Ausgabe getrennt zeichnen; ein Zeichner, zwei Pixelbreiten.
- **Don't** Mono für Fließtext oder Satoshi für eine Messreihe verwenden.
- **Don't** gesperrt und arbeitend gleich aussehen lassen.
- **Don't** eine gesetzte Versalzeile als Rubrik oder Aufreißer über einen Absatz setzen; das Versalienlabel benennt ausschließlich das Feld direkt darunter.

---

## Ausnahme: das Blatt ist ein Dokument

Nachgetragen am 13.09.2026, auf ausdrücklichen Wunsch des Nutzers
("Es müsste auch verschiedene Darstellungsoptionen geben. Nicht nur
Graustufen des Planes.").

**Die Wertleiter-Regel gilt für die Oberfläche, nicht für das Blatt.** Die
Bedienoberfläche bleibt monochrom, und der Akzent gehört weiterhin allein
dem Rahmen, dem Plangebiet, der Auswahl und dem Hauptknopf. Das Blatt in der
Mitte ist dagegen kein Bedienelement, sondern das Erzeugnis. Es trägt eine
eigene, wählbare Palette und folgt deshalb auch nicht dem hellen oder
dunklen Schema der Anwendung.

Die Darstellungen stehen in `werkzeug/src/lib/darstellung.ts`, jede mit
Blattgrund, Farbe je Ebene und Bauweise:

| Darstellung | Zweck |
|---|---|
| Schwarzplan | Figur und Grund, der Regelfall und der beste Eingang für das Bildmodell |
| Invertiert | Weiß auf Schwarz, zeigt den öffentlichen Raum als Figur statt als Rest |
| Linie | nur Konturen, für Plots und Kantenerkennung |
| Nutzung | Gebäude nach Art eingefärbt, arbeitet dem Programmschritt vor |
| Weißmodell | plastische Baukörper mit Schlagschatten aus der Geschosszahl |

**Was die Ausnahme begrenzt:** Eine Darstellung darf die Palette des Blattes
setzen, nie die der Oberfläche. Die Werkzeugleiste über dem Blatt bleibt in
der Grauleiter, auch wenn das Blatt darunter farbig ist.
