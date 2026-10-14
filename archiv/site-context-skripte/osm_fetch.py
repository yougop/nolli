#!/usr/bin/env python3
"""Schritt 1a — OSM-Rohdaten fuer einen Rahmen ziehen.

Holt Gebaeude, Strassen, Bahn, Wasser, Nutzung und Gruen fuer eine Bbox und
legt die Overpass-Rohantwort unveraendert ab. Rohdaten werden nie ueberschrieben,
damit ein Lauf nachvollziehbar bleibt.
"""
import json, sys, time, argparse, pathlib
import requests

OVERPASS = "https://overpass-api.de/api/interpreter"

ABFRAGE = """[out:json][timeout:300];
(
  way["building"]({s},{w},{n},{e});
  relation["building"]({s},{w},{n},{e});
  way["highway"]({s},{w},{n},{e});
  way["railway"]({s},{w},{n},{e});
  way["natural"="water"]({s},{w},{n},{e});
  relation["natural"="water"]({s},{w},{n},{e});
  way["waterway"="riverbank"]({s},{w},{n},{e});
  way["landuse"]({s},{w},{n},{e});
  way["leisure"]({s},{w},{n},{e});
);
out geom;"""

def holen(s, w, n, e, ziel, versuche=3):
    q = ABFRAGE.format(s=s, w=w, n=n, e=e)
    for i in range(versuche):
        r = requests.post(OVERPASS, data={"data": q}, timeout=320,
                          headers={"User-Agent": "nolli/0.1 (volker@zinssmeister.info)"})
        if r.status_code == 200:
            pathlib.Path(ziel).write_text(r.text, encoding="utf-8")
            d = json.loads(r.text)
            print(f"{len(d['elements'])} Elemente -> {ziel} ({len(r.content)/1e6:.1f} MB)")
            return d
        print(f"  Versuch {i+1}: HTTP {r.status_code}, warte 20 s")
        time.sleep(20)
    sys.exit("Overpass antwortet nicht")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--sued", type=float, required=True)
    p.add_argument("--west", type=float, required=True)
    p.add_argument("--nord", type=float, required=True)
    p.add_argument("--ost",  type=float, required=True)
    p.add_argument("--ziel", default="osm_raw.json")
    a = p.parse_args()
    holen(a.sued, a.west, a.nord, a.ost, a.ziel)
