# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

SvelteKit, wie swzpln.de. Vom Nutzer gewählt. Node-Build, Komponenten, sauberer
Zustand bei komplexer Bedienung, tragfähig für einen späteren öffentlichen
Betrieb. Geometrie- und Exportarbeit läuft clientseitig in Web Workern, ein
schlankes Server-Backend übernimmt nur den Overpass-Zugriff mit Rate-Limit.

## Users

**Primär:** Volker Zinssmeister, Dipl.-Ing. Architektur, Hamburg, seit 2012
freischaffend, Lehrbeauftragter an der HafenCity Universität. Arbeitet an einem
Wettbewerbsbeitrag oder einer Studie und braucht in den ersten Stunden eines
Projekts eine belastbare, maßstäblich verankerte Bestandsgrundlage. Sitzt an
einer Workstation mit Rhino und Grasshopper daneben.

**Perspektivisch öffentlich.** Vom Nutzer bestätigt: Das Werkzeug soll später
für Fremde laufen. Daraus folgen Anforderungen, die ein reines Eigenwerkzeug
nicht hätte: beliebige Orte statt nur Bratislava, Fehlermeldungen die
weiterhelfen, Rate-Limit gegen Overpass, Impressum und Datenschutz, Englisch
neben Deutsch. Diese Anforderungen sind anerkannt, aber noch nicht alle gebaut.

## Eigenständig benutzbar

**Nolli soll später auch allein stehen**, ohne die übrige Kette. Daraus
folgt eine Regel für jeden Text in der Oberfläche: Er darf keine Kenntnis der
nachgelagerten Schritte voraussetzen.

Konkret heißt das, eine Zahl wird über ihre Wirkung im Ergebnis erklärt, nicht
über den Schritt, der sie später braucht. Nicht "genug für die
Vektorisierung", sondern "Gebäudekanten bleiben unterscheidbar und
nachmessbar". Wer die Kette kennt, liest dasselbe heraus; wer sie nicht kennt,
versteht es trotzdem.

## Product Purpose

Aus einem beliebigen Ort eine **maßstäblich verankerte Bestandsgrundlage**
machen, in drei Schritten: Ort suchen und Rahmen setzen, Bestandsdaten
bereinigen, als Bild und CAD ausgeben.

Erfolg heißt: Am Ende liegt ein Rahmen vor, der metrisch eindeutig ist, ein
bereinigter Bestandsplan als 4K-Bild, und dieselbe Geometrie als CAD-Datei.
Alles drei beschreibt denselben Ausschnitt, pixelgenau und in echten Metern.

## Positioning

> **Der Rahmen ist der Vertrag, nicht das Bild.**

Andere Werkzeuge geben einen Plan aus und sind fertig. Hier ist die Ausgabe der
Anfang einer Kette: Der Rahmen, also Bounding-Box in UTM, Pixelmaße und Meter
pro Pixel, wird zuerst festgelegt und von jedem folgenden Schritt geerbt. Deshalb
lässt sich ein KI-erzeugtes Bild später wieder in Meter zurückrechnen.

Zweite Besonderheit: **Bereinigen ist eine Entscheidung, kein Automatismus.**
Der Nutzer markiert, was aus dem Plangebiet verschwindet und was stehen bleibt.
Das Werkzeug führt darüber Buch, damit die Setzung später nachvollziehbar und
wiederholbar ist.

## Operating Context

Erster Schritt einer zehnstufigen Kette für KI-gestützten Städtebau. Was hier
herausfällt, geht in ein Bildmodell (NB3), kommt als Masterplan zurück, wird
vektorisiert und landet am Ende als Volumen in Rhino.

Danebenliegende Werkzeuge: Rhino und Grasshopper auf derselben Maschine,
Wettbewerbsunterlagen als PDF, Overpass als Datenquelle.

Fachsprache, die in der Oberfläche vorkommen muss: Rahmen, Bounding-Box, Meter
pro Pixel, Footprint, Plangebiet, Bestand, Geschossigkeit, GRZ, GFZ.

## Capabilities and Constraints

**Drei Schritte, in dieser Reihenfolge:**

1. Ort suchen, Rechteck über die Karte ziehen, Seitenverhältnis rastet auf
   4:3, 16:9, 3:2 oder 1:1. Rahmen sichern, OSM-Daten dazu holen.
2. Objekte im Rahmen markieren und entfernen. Plangebiet als Polygon abgrenzen,
   Erhaltungsbestand von Hand auswählen.
3. Ausgeben als 4K-Bild, DXF zweidimensional, OBJ dreidimensional und
   `frame.json` als Datenvertrag.

**Bestätigte Daten-Grenzen**, an Bratislava gemessen:

| | |
|---|---|
| Gebäude mit Geschosszahl in OSM | 56 % |
| Gebäude mit ausdrücklicher Höhe | 1,4 % |
| Denkmalgeschütztes im Hafenareal | keines getaggt |

Daraus folgt: Kubatur kommt über Geschosszahl mal Geschosshöhe, nicht über
gemessene Höhen. Die Halteliste des Erhaltungsbestands kann nicht aus den Daten
kommen, sie wird von Hand gesetzt. Beides ist Produktwahrheit, keine Schwäche
der Umsetzung, und die Oberfläche muss es offenlegen statt es zu verstecken.

**Auflösungsgrenze:** Eine zwölf Meter tiefe Gebäudezeile muss im Ergebnis
mindestens zwölf Pixel breit sein, sonst trägt die spätere Vektorisierung
nicht. Das Werkzeug rechnet das mit und warnt.

**Koordinatensystem:** UTM, für Bratislava Zone 33 Nord, EPSG 32633. Metrisch,
in Rhino unmittelbar brauchbar.

**Rechtlich:** OSM-Daten unter ODbL, Namensnennung ist Pflicht. swzpln.de steht
unter AGPL-3 und dient als Vorbild, nicht als Code-Quelle.

## Brand Commitments

Deutsch ist Arbeitssprache. Der Name des Gesamtvorhabens ist **Nolli**, nach
Giambattista Nolli, dessen Rom-Karte von 1748 den öffentlichen Raum als Figur
statt als Rest zeigt.

Keine gestalterische Richtung vorgegeben. Der Nutzer nennt swzpln.de als
funktionales Vorbild für die Ortswahl und verlangt, dass das Ergebnis
ansehnlich wird.

## Testgebiet

**Holstenareal, Neue Mitte Altona, Hamburg.** Seit 13.09.2026. Ehemalige
Holsten-Brauerei, Brachfläche von etwa 430 auf 340 Metern in Altona-Nord,
Mitte 53,56143 Nord und 9,94370 Ost.

Zuvor Bratislava, Zimný prístav. Jene Läufe bleiben als Beleg gültig, aber
weiterentwickelt wird am Holstenareal.

## Evidence on Hand

Echtes Material, das im Werkzeug gezeigt werden kann und nicht erfunden werden
muss:

- OSM-Rohdaten Bratislava Winterhafen, 38.444 Elemente, 13.022 Gebäude,
  `daten/bratislava/osm_raw.json`
- Gerenderte Bestandskarte, `daten/bratislava/picker_basemap.png`
- Erstlauf des Bildmodells mit Bestandsplan, Masterplan, Maske und Polygonen
- Auslobungszahlen Zimný prístav: 45,03 ha, GFA-Korridor 950.000 bis
  1.040.000 m², 40 Prozent bebaut, 70 Prozent Wohnen

**Nicht vorhanden, nicht zu erfinden:** Nutzerzahlen, Referenzprojekte anderer
Büros, Preise, Lizenzmodelle.

## Product Principles

1. **Der Rahmen ist der Vertrag.** Alles, was das Werkzeug ausgibt, beschreibt
   denselben Ausschnitt in denselben Metern.
2. **Zahlen vor Bildern.** Jede Ansicht sagt, was sie in Metern bedeutet.
   Maßstab, Fläche, Meter pro Pixel stehen sichtbar, nicht in einem Untermenü.
3. **Entscheidungen gehören dem Nutzer.** Das Werkzeug bereinigt nichts von
   selbst. Es macht sichtbar, was entfernt wird, und führt Buch darüber.
4. **Datenlücken offenlegen.** Wo OSM keine Höhe kennt, sagt das Werkzeug es,
   statt eine plausible Zahl zu erfinden.
5. **Jeder Zwischenstand ist abgreifbar.** Kein Schritt ist eine Einbahnstraße.

## Accessibility & Inclusion

Tastaturbedienbarkeit für alles außer dem Kartenziehen selbst, das zusätzlich
über Zahlenfelder erreichbar sein muss. Dunkel und hell, weil am Bildschirm
neben einem Rhino-Fenster gearbeitet wird, das meist dunkel steht.
