#!/usr/bin/env python3
"""Schritt 1b — Bestandsplan in einen definierten Rahmen zeichnen.

Flacher Diagrammstil. Der Rahmen ist der Vertrag: Bbox in UTM, Pixelmasse,
Meter pro Pixel. Alles wird affin in diesen Rahmen projiziert.
"""
import json, argparse, pathlib
from PIL import Image, ImageDraw
from pyproj import Transformer

# --- Stil: flach, diagrammatisch, ohne Schrift und Textur ---------------
STIL = {
    "grund":      (242, 241, 238),
    "wasser":     (201, 216, 227),
    "gruen":      (220, 229, 214),
    "bahnflaeche":(234, 232, 228),
    "bau_fuell":  (216, 213, 208),
    "bau_kante":  (150, 146, 139),
    "weg_kante":  (206, 202, 196),
    "weg_fuell":  (252, 252, 251),
    "bahn":       (162, 158, 151),
}
# Fahrbahnbreiten in Metern je Strassenklasse
BREITE = {
    "motorway":22,"motorway_link":12,"trunk":18,"trunk_link":11,
    "primary":16,"primary_link":10,"secondary":13,"secondary_link":9,
    "tertiary":10,"tertiary_link":8,"residential":8,"unclassified":8,
    "living_street":7,"pedestrian":5,"service":4.5,"track":3,
    "footway":2,"path":1.8,"cycleway":2.2,"steps":1.8,
}
GRUEN = {"park","garden","grass","meadow","forest","recreation_ground",
         "village_green","allotments","cemetery","pitch","playground","scrub"}

class Rahmen:
    """Affine Abbildung UTM -> Pixel. Einzige Bruecke zwischen Meter und Bild."""
    def __init__(self, x0, y0, x1, y1, breite_px, epsg=32633):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.breite_m, self.hoehe_m = x1-x0, y1-y0
        self.mpp = self.breite_m / breite_px
        self.breite_px = breite_px
        self.hoehe_px = int(round(self.hoehe_m / self.mpp))
        self.epsg = epsg
        self.tf = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)

    def punkt(self, lon, lat):
        x, y = self.tf.transform(lon, lat)
        return ((x - self.x0)/self.mpp, (self.y1 - y)/self.mpp)   # y gespiegelt

    def als_dict(self, quelle):
        return {"epsg": self.epsg, "bbox_utm": [self.x0,self.y0,self.x1,self.y1],
                "pixel_breite": self.breite_px, "pixel_hoehe": self.hoehe_px,
                "meter_pro_pixel": round(self.mpp,4),
                "breite_m": round(self.breite_m,1), "hoehe_m": round(self.hoehe_m,1),
                "quelle": quelle}

def ringe(rel, wege):
    """Aussenringe einer Multipolygon-Relation zusammensetzen."""
    teile = [m["geometry"] for m in rel.get("members",[])
             if m.get("role") in ("outer","") and m.get("geometry")]
    fertig, offen = [], list(teile)
    while offen:
        k = offen.pop(0)
        geschlossen = False
        while not geschlossen and offen:
            ende = (k[-1]["lat"], k[-1]["lon"])
            for i, t in enumerate(offen):
                if (t[0]["lat"],t[0]["lon"]) == ende:
                    k = k + t[1:]; offen.pop(i); break
                if (t[-1]["lat"],t[-1]["lon"]) == ende:
                    k = k + list(reversed(t))[1:]; offen.pop(i); break
            else:
                break
            geschlossen = (k[0]["lat"],k[0]["lon"]) == (k[-1]["lat"],k[-1]["lon"])
        if len(k) >= 4: fertig.append(k)
    return fertig

def zeichnen(roh, rahmen, ziel):
    el = roh["elements"]
    byid = {e["id"]: e for e in el if e["type"]=="way"}
    im = Image.new("RGB", (rahmen.breite_px, rahmen.hoehe_px), STIL["grund"])
    d = ImageDraw.Draw(im)
    P = lambda g: [rahmen.punkt(p["lon"], p["lat"]) for p in g]

    def flaeche(g, farbe):
        pts = P(g)
        if len(pts) >= 3: d.polygon(pts, fill=farbe)

    # 1 Nutzung und Gruen
    for e in el:
        t = e.get("tags",{}); g = e.get("geometry")
        if not g: continue
        if t.get("landuse") in GRUEN or t.get("leisure") in GRUEN:
            flaeche(g, STIL["gruen"])
        elif t.get("landuse") in ("railway","industrial"):
            flaeche(g, STIL["bahnflaeche"])
    # 2 Wasser
    for e in el:
        t = e.get("tags",{})
        if t.get("natural")=="water" or t.get("waterway")=="riverbank":
            if e["type"]=="way" and e.get("geometry"): flaeche(e["geometry"], STIL["wasser"])
            elif e["type"]=="relation":
                for r in ringe(e, byid): flaeche(r, STIL["wasser"])
    # 3 Strassen, erst Kante dann Fahrbahn
    strassen = [(e, BREITE[e["tags"]["highway"]]) for e in el
                if e.get("geometry") and e.get("tags",{}).get("highway") in BREITE]
    strassen.sort(key=lambda s: s[1])
    for durchgang, farbe, zuschlag in ((0, STIL["weg_kante"], 2.0), (1, STIL["weg_fuell"], 0.0)):
        for e, b in strassen:
            px = max(1, int(round(b/rahmen.mpp + zuschlag)))
            d.line(P(e["geometry"]), fill=farbe, width=px, joint="curve")
    # 4 Bahn
    for e in el:
        if e.get("tags",{}).get("railway") in ("rail","tram","light_rail") and e.get("geometry"):
            d.line(P(e["geometry"]), fill=STIL["bahn"], width=max(1,int(round(3/rahmen.mpp))))
    # 5 Gebaeude zuletzt
    kante = 1 if rahmen.mpp > 1.2 else 2
    for e in el:
        if "building" in e.get("tags",{}) and e.get("geometry"):
            pts = P(e["geometry"])
            if len(pts) >= 3:
                d.polygon(pts, fill=STIL["bau_fuell"], outline=STIL["bau_kante"], width=kante)
    im.save(ziel)
    print(f"{ziel}  {im.size[0]}x{im.size[1]} px  {rahmen.mpp:.3f} m/px")
    return im

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--roh", required=True)
    p.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("X0","Y0","X1","Y1"))
    p.add_argument("--breite-px", type=int, default=2400)
    p.add_argument("--ziel", default="basemap.png")
    p.add_argument("--frame-json", default=None)
    a = p.parse_args()
    r = Rahmen(*a.bbox, a.breite_px)
    zeichnen(json.load(open(a.roh)), r, a.ziel)
    if a.frame_json:
        pathlib.Path(a.frame_json).write_text(json.dumps(r.als_dict("osm"), indent=2))
        print("->", a.frame_json)
