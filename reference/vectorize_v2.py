#!/usr/bin/env python3
"""
NAI Bridge — Schritt 1 Vektorisierung v2.
FIX: Innenhoefe (Loecher in Perimeterbloecken) werden korrekt als
Aussparung erfasst -> Footprint = Aussenpolygon MINUS Hof-Polygone.
Wichtig fuer korrekte Flaechen/GFA-Berechnung.

RETR_CCOMP liefert 2-stufige Hierarchie:
  - aeussere Konturen (Level 0)
  - Loecher darin      (Level 1)
"""
import cv2
import numpy as np
import json
import sys

MIN_AREA_PX      = 400      # Aussenflaeche kleiner -> ignorieren
MIN_HOLE_PX      = 300      # Hof kleiner -> ignorieren (kein echter Hof)
APPROX_EPS_FRAC  = 0.01
CLOSE_KERNEL     = 3
BINARY_THRESH    = 127

def simplify(contour):
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, APPROX_EPS_FRAC * peri, True)
    return [[int(p[0][0]), int(p[0][1])] for p in approx]

def vectorize(mask_path, out_json, out_overlay):
    img = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f"FEHLER: {mask_path} nicht lesbar"); sys.exit(1)
    h, w = img.shape
    print(f"Maske geladen: {w}x{h}px")

    _, binm = cv2.threshold(img, BINARY_THRESH, 255, cv2.THRESH_BINARY)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (CLOSE_KERNEL, CLOSE_KERNEL))
    binm = cv2.morphologyEx(binm, cv2.MORPH_CLOSE, k)
    binm = cv2.morphologyEx(binm, cv2.MORPH_OPEN,  k)

    # RETR_CCOMP: 2-Level-Hierarchie (aussen + Loecher)
    contours, hierarchy = cv2.findContours(binm, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    hierarchy = hierarchy[0]  # [next, prev, first_child, parent]
    print(f"Rohkonturen: {len(contours)}")

    # Aussenkonturen = parent == -1 ; Loecher = parent != -1
    footprints = []
    overlay = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    overlay = (overlay * 0.35).astype(np.uint8)

    kept = 0; holes_kept = 0
    for i, c in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            continue  # Loch -> wird beim Parent behandelt
        area = cv2.contourArea(c)
        if area < MIN_AREA_PX:
            continue

        outer = simplify(c)

        # Kinder (Loecher) dieser Aussenkontur einsammeln
        holes = []
        child = hierarchy[i][2]  # first_child
        while child != -1:
            hc = contours[child]
            harea = cv2.contourArea(hc)
            if harea >= MIN_HOLE_PX:
                holes.append({"polygon_px": simplify(hc), "area_px": round(harea,1)})
                holes_kept += 1
            child = hierarchy[child][0]  # next sibling

        net_area = area - sum(hh["area_px"] for hh in holes)
        footprints.append({
            "id": f"fp_{kept+1:03d}",
            "outer_px": outer,
            "holes_px": [hh["polygon_px"] for hh in holes],
            "gross_area_px": round(area, 1),
            "net_area_px": round(net_area, 1),
            "hole_count": len(holes),
            "vertices": len(outer) + sum(len(hh["polygon_px"]) for hh in holes),
        })

        # Zeichnen: Aussenkontur orange, Loecher cyan gefuellt (= ausgeschnitten)
        pts = np.array(outer, np.int32).reshape(-1,1,2)
        cv2.polylines(overlay, [pts], True, (0,90,255), 2)
        for p in outer:
            cv2.circle(overlay, tuple(p), 3, (0,255,255), -1)
        for hh in holes:
            hp = np.array(hh["polygon_px"], np.int32).reshape(-1,1,2)
            cv2.fillPoly(overlay, [hp], (60,20,20))   # Hof "ausgeschnitten" andeuten
            cv2.polylines(overlay, [hp], True, (255,120,0), 2)  # Hofkante blau
        kept += 1

    print(f"Footprints nach Filter: {kept}")
    print(f"davon mit Innenhof: {sum(1 for f in footprints if f['hole_count']>0)}")
    print(f"Innenhoefe gesamt: {holes_kept}")

    result = {
        "source": mask_path,
        "image_dimensions": {"width": w, "height": h},
        "params": {"min_area_px": MIN_AREA_PX, "min_hole_px": MIN_HOLE_PX,
                   "approx_eps_frac": APPROX_EPS_FRAC},
        "footprint_count": kept,
        "footprints": footprints,
    }
    with open(out_json, "w") as f:
        json.dump(result, f, indent=2)
    cv2.imwrite(out_overlay, overlay)
    print(f"JSON -> {out_json}")
    print(f"Overlay -> {out_overlay}")
    return result

if __name__ == "__main__":
    vectorize(
        "/mnt/user-data/uploads/1783246037178_image.png",
        "/home/claude/footprints_v2.json",
        "/home/claude/overlay_v2.png",
    )
