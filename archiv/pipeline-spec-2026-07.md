# NAI Bridge — Abgrenzung zu UrbanGPT & aktualisierte Pipeline

**Quelle:** Tim Fu / Studio Tim Fu, „UrbanGPT" — ATN Summit 2026 (Vortrag, ab ~Min. 20).
**Zweck:** Blaupause verstehen, bewusst abgrenzen, eigene Pipeline schärfen.

---

## Was UrbanGPT ist (rekonstruiert aus Vortrags-Screenshots)

**Architektur-Evolution, die Tim Fu zeigt:**

```
UrbanGPT 1.0:
Site Data / Constraints / Criteria → [LLM] → (Matrices/values) → [Configurator]
                                       ↑__________adjust__________|

UrbanGPT 2.0:
Site Data / Constraints / Criteria → [LLM + Diffusion] → (Visual Data) → [2D Processor]
                                                                        → [3D Processor]
```

**Konkreter 2.0-Workflow (aus Vortragsmitschrieb):**
1. Bereinigter Site-Screenshot (Google Maps)
2. Diffusionsmodell (auf echte Dimensionen **trainiert**) generiert Masterplan-Varianten in Topview
3. Footprint-Extraktion aus dem Diffusionsbild
4. Digitalisieren + Variieren des Footprints (mit Nutzungen)
5. LLM generiert 3D-Volumen auf dem **gelockten** digitalisierten Footprint

**Endprodukt:** Läuft nativ in Rhino, über Grasshopper mit OpenAI-Node gesteuert (Natural-Language-Prompts wie „Add skyscrapers adjacent to the river"), mit Live-Kennzahlen (Area + GFA je Nutzungsklasse). Dazu ein Web-Dashboard („STF UrbanGPT Program Distributor"): Site Coverage, Program Distribution (Donut), GFA-Sets je Nutzung.

---

## Bestätigung: Wo UrbanGPT die NAI-These stützt

Die Kernstruktur ist fast deckungsgleich — ein Renommierter validiert die Richtung öffentlich:

- Diffusion auf echte Maßstäbe → deckt sich mit „realistische Zahlen & Maßstäbe"
- Footprint → 3D-Volumen mit Kennzahlen → NAI-Schritte identisch
- Nativ in Rhino, GH-gesteuert, Live-Kennzahlen → identische Rhino-Live-Schnittstelle
- Zweistufiger Sprung Bild→Footprint→Volumen → identische Pipeline-Logik

---

## Abgrenzung: Wo NAI Bridge bewusst anders (und besser) ist

| Dimension | UrbanGPT (Tim Fu) | NAI Bridge | Vorteil |
|---|---|---|---|
| **Bildmodell** | Eigenes Diffusionsmodell, auf Maßstäbe **trainiert** | NB2/Gemini + **LLM-Verifikation**, kein Training | Kein Trainingsaufwand, sofort kontextflexibel, reitet auf NB2-Updates mit — machbar für Ein-Personen-Studio |
| **Footprint-Übergang** | Gelockt, Blackbox, automatisiert | **Offener GH-Escape-Hatch** über Datenvertrag | Profi kann an jedem Übergang eingreifen — echtes Projektwerkzeug, nicht nur Demo |
| **Eingang** | „Generier mir eine Stadt" (Fantasie-Areal) | Auch **realer Lageplan rein** | Trifft echten Entwickler-Bedarf: „was passt auf MEIN Grundstück" |
| **Umfang** | Volle Städtebau-Suite (Program Distributor) | Fokussiert: Lageplan → verifiziertes Volumen → Rhino | Schlanker, schärfer, schneller nutzbar |

**Die drei verteidigbaren Wedges von NAI Bridge:**
1. Offener Grasshopper-Escape-Hatch (er hat eine Blackbox)
2. Realer-Lageplan-Eingang für Projektentwickler (er generiert Fantasie-Areale)
3. Kein Modelltraining nötig — NB2 + LLM-Verifikation (er hat teures, statisches Training)

**Ehrliche Warnung:** Tim Fu ist weiter und renommiert. „Ich baue auch UrbanGPT" ist kein Wedge. Die drei Punkte oben sind der Wedge. Nur auf denen aufbauen.

---

## NB2-Strategie: Maßstab richtig verankern

**Trugschluss vermeiden — zwei Mechanismen sauber trennen:**

- **Maßstab im Input-Bild mitgeben = stark, richtig.** NB2 ist bildkonditioniert. Site-Screenshot immer mit eingebranntem **Maßstabsbalken + Nordpfeil + bekanntem Referenzobjekt** (Straßenbreite, Fußballfeld) füttern → Output respektiert Proportionen deutlich besser. (= Bratislava-Befund.)
- **Referenz-„How-to" / Systemprompt = Konditionierung, NICHT Training.** Hilft der Steuerung für den einzelnen Call. Ändert NB2 nicht. Kein „Trainieren" per Prompt möglich.

**Kernprinzip:** NB2 wird **nie metrisch exakt**. Diffusion ist visuell-plausibel, nicht vermessungsgenau.
→ NB2 macht die **Form**. Die **Zahlen** kommen im LLM-Verifikationsschritt + beim Digitalisieren des Footprints.
→ Genau deshalb braucht NAI **kein** trainiertes Modell wie Tim Fu: Präzision wird vom Bild in die nachgelagerte Verifikation verlagert. Das ist der Moat.

---

## Aktualisierte NAI-Bridge-Pipeline (Dashboard-zentriert)

Das Dashboard rückt in die Mitte — als Steuerungs- UND Verifikationsinstrument.

### Schritt 0 — Site-Aufbereitung & städtebauliche Analyse (NEU)
Der rohe Enscape/CAD-Site-Screenshot wird aufbereitet, BEVOR generiert wird. Zwei Teilausgaben:
```
Roher Site-Screenshot
   → NB2: gecleanter Städtebauplan (Rauschen raus, Bestand als klare diagrammatische Flächen)
   → LLM (via Städtebau-SKILL): planerische Analyse
        - Raumkanten, Fluchten, Erschließungsachsen, Blickbeziehungen, Bestandskörnung
        - Ausgabe 1: Plan MIT eingezeichneten städtebaulichen Bezügen
        - Ausgabe 2: textliche Analyse, die den Generierungs-Prompt in Schritt 1 füttert
   → Maßstabs-Kalibrierung / Referenzpunkte werden HIER gesetzt (Input-seitig)
```
**Warum:** NB2 bekommt in Schritt 1 einen bereits *planerisch verstandenen* Kontext statt nur Screenshot + Programm. Es nimmt dann mehr Bezüge auf (Fluchten fortführen, an Bestandskanten andocken, Achsen respektieren) → höhere städtebauliche Qualität statt beliebiger Bebauung.
**Moat:** Die Analyse-Methodik liegt in einem **Skill** (wie arch-prompt/nai-context) — Volkers architektonisches Fachwissen kodifiziert, jeder Site nach demselben professionellen Raster untersucht. Ein generisches Tool hat das nicht.

### Schritt 1 — NB2 generiert Masterplan + Alpha-Maske ✓ validiert
```
Site-Screenshot (mit Maßstab + Nordpfeil, aufbereitet aus Schritt 0)
   → NB2/Diffusion generiert Masterplan-Design (top view, flat 2D, footprints only)
   → deckungsgleiche RGB + Alpha-Maske in einem Call
```

### Schritt 2 — Footprint + Dashboard mit Footprint-Kennzahlen
```
Alpha-Maske
   → Vektorisierung (OpenCV RETR_CCOMP, Innenhöfe ausgeschnitten) → Polygone
   → Filter + Regularisierung + LLM-Nutzungsklassen
   → DASHBOARD (2D-Ebene): Flächen, Nutzungsverteilung, Site Coverage, GRZ
   → Nutzer VALIDIERT + LOCKT die 2D-Grundfigur   ← erstes Lock-Gate
```
*„Passt das Programm überhaupt aufs Grundstück?" — 2D-Verifikation vor der Höhe.*

### Schritt 3 — Volumen + Dashboard mit Volumen-Kennzahlen
```
Gelockter Footprint
   → LLM überführt in 3D-Volumen (Höhen, Geschossigkeit, Nutzung je Körper)
   → DASHBOARD (3D-Ebene): GFA, GFZ, Kubatur je Nutzung
   → Nutzer VALIDIERT die 3D-Umsetzung            ← zweites Lock-Gate
```
*„Wie viel Programm bringt die gelockte Figur wirklich?" — 3D-Verifikation, wirtschaftlich entscheidend.*

**Warum 2 getrennte Gates (Kern-Moat vs. Tim Fu):** Bei UrbanGPT ist der Footprint gelockt und verschwindet in die Volumengenerierung. Bei NAI Bridge validiert der Nutzer erst die 2D-Figur, lockt sie, und validiert dann getrennt die 3D-Umsetzung. Zwei inspizierbare Kontrollpunkte, dazwischen der Escape-Hatch. Ehrlicher und für Profis brauchbarer.

### Schritt 4 — Eingriff per Rhino/Grasshopper Escape-Hatch
```
An jedem Übergang: Datenvertrag (affines JSON + Geometrie, georeferenziert)
   → GH liest Zwischenstand raus
   → manuelle Sonderlösung / Custom-Parametrik / ungewöhnliche Geometrie
   → zurückschreiben in Pipeline + Dashboard
   → Live-Schnittstelle Rhino 3D
```

---

## ✅ VALIDIERT: Schritt 1 (Bratislava-Test, Juli 2026)

Der kritischste Übergang der Bridge — **NB2-Bild → deckungsgleicher Footprint** — ist empirisch bestätigt. Der Teil, an dem das Konzept hätte scheitern können, trägt.

**Was getestet wurde:** Enscape/CAD-Site-Screenshot (Bratislava Winterhafen) → Gemini/NB2 mit gezieltem Prompt → RGB-Masterplan + Alpha-Maske. Overlay beider Ausgaben in Photoshop: **100 % pixel-deckungsgleich.**

**Bestätigte Befunde:**

1. **NB2 generiert Masterplan auf realer Site** — Bestandskontext (Fluss, Becken, Brücken, Bahn, Bestandsblöcke) bleibt gelockt, nur die Brownfield-Fläche wird bebaut.
2. **Doppel-Output in einem Call funktioniert** — RGB-Plan + separate Alpha-Maske sind deckungsgleich. Die saubere Binärmaske (weiß auf schwarz) fällt als Nebenprodukt der Generierung ab. Besser als nachträgliche Segmentierung, weil kein Farbrauschen aus dem RGB rauszurechnen ist.
3. **Der flache 2D-Plan-Modus ist der Schlüssel.** Prompt-Anweisung „footprints only, flat 2D plan, no heights yet" entkoppelt NB2 von der 3D-Interpretation → saubere orthogonale Kanten statt verwischter Volumen-Blobs. Höhe kommt erst in Schritt 2 (LLM → Volumen).
4. **Stil-Anchor regularisiert vorab.** „clean BIG / KCAP masterplan aesthetic, thin precise outlines" zwingt NB2 in diagrammatische, orthogonale Formensprache → weniger Vektorisierungs-Aufräumarbeit hinten. Ein Teil der Regularisierung wird in den Generierungs-Prompt vorverlagert.

**Der bewährte Prompt-Aufbau (Schritt 1):**
- Explizit: „Edit this exact image, keep all existing geometry locked, pixel-identical" + Aufzählung der zu erhaltenden Elemente
- Bestandsgebäude, die der Auslober zu erhalten vorgibt, **namentlich als locked im Prompt benennen** — sie erscheinen dann korrekt sowohl im RGB als auch in der Alpha-Maske als erhaltene Struktur (im Bratislava-Test bewusst so gesteuert)
- Nur die Entwicklungsfläche modifizieren, mit Programm-Vorgaben (Blockstruktur, Flächenanteile bebaut/öffentlich/Hof, Promenaden, Platz, Wegenetz)
- Drawing-Style-Block: top view, thin black outlines, flat grey fill, keep photographic context underneath, no photorealism, no textures
- „footprints only, no heights yet, no watermark, no labels, no distortion of existing elements"
- „Generate a second image as an alpha image showing only the new buildings"

**Was danach kommt = Handwerk (kein KI-Risiko mehr):**
```
Alpha-Maske (binär, deckungsgleich)
   → Vektorisierung: OpenCV RETR_CCOMP + approxPolyDP  (Maske ist binär → leichtester Fall)
       WICHTIG: RETR_CCOMP statt RETR_EXTERNAL — sonst werden Innenhöfe NICHT ausgeschnitten
       Perimeterblock-Höfe machen 22–33% der Bruttofläche aus → sonst GFA um bis zu 1/3 zu hoch
   → Footprint = Außenpolygon MINUS Hof-Polygone (gross_area vs. net_area getrennt führen)
   → Filter: Kleinstflächen + Kleinsthöfe unter Schwellwert ignorieren
   → Regularisierung: Kanten orthogonalisieren / Winkel-Snapping (teils deterministisch, teils LLM)
   → Nutzungsklassen: LLM klassifiziert die bereinigten Footprints
```
✅ **Vektorisierung getestet (v2):** 21 Footprints, 4 mit korrekt ausgeschnittenem Innenhof. Skript: `vectorize_v2.py`.

**Design-Regel, die sich durch die ganze Bridge zieht:**
> **Geometrie deterministisch, Semantik per LLM.**
> Das LLM misst keine Pixel (das kann es schlecht). Es versteht, klassifiziert, plausibilisiert (das kann es gut). Kanten, Konturen, Meter kommen aus deterministischer Bildverarbeitung.

**Rolle des Validierungs-Gates (Dashboard):**
Bestandsstrukturen, die (gewollt) in der Maske landen, sowie Rausch-Fragmente werden im Konfigurator/Dashboard aussortiert, bevor die Variante gelockt wird — über den „neu vs. Bestand"-Differenzcheck gegen das Baseline-Bild oder manuell/LLM-gestützt. Erwartbare Arbeit im Gate, kein Generierungsfehler.

---

## Noch offene technische Punkte

- **Datenvertrag-Spezifikation:** Konkretes JSON-Schema, das Dashboard, LLM und GH gemeinsam lesen/schreiben — das technische Herzstück, an dem alles hängt (nächster sinnvoller Baustein)
- **Maßstabs-Kalibrierung:** Wie wird der eingebrannte Maßstab beim Digitalisieren in echte Meter zurückgerechnet? (Referenzpunkt-Mapping) — Schritt 1 liefert saubere Pixel-Polygone, die Meter-Umrechnung ist noch zu bauen
- **Vektorisierungs-Test:** OpenCV-Skript auf der binären Alpha-Maske — den letzten deterministischen Schritt einmal durchspielen, Polygone zur Kontrolle zurückzeichnen
- **Dashboard-Tech:** Web (Mapbox/Cesium-Erbe aus früherer Pipeline-Planung) vs. direkt in Rhino/Eto
