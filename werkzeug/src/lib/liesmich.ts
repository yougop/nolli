/**
 * Die README im Paket.
 *
 * Für Menschen geschrieben, deshalb in der gewählten Sprache. Was darin an
 * Zahlen steht, kommt aus dem fertigen Vertrag — die README erklärt ihn,
 * sie ist keine zweite Quelle. Wer etwas nachrechnen will, liest `frame.json`.
 */
import type { Sprache } from './sprache.svelte';

type V = Record<string, any>;

export function paketLiesmich(v: V, sprache: Sprache): string {
	const p = v.package ?? {};
	const [x0, y0] = v.bbox_grid ?? [0, 0];
	const daten: V[] = p.data ?? [];
	const bilder: V[] = p.images ?? [];
	const caveats: string[] = v.caveats ?? [];
	const datenZeilen = daten
		.map((d) => `| \`${d.file}\` | ${d.entries} | ${d.description} | ${(d.fields ?? []).map((f: string) => `\`${f}\``).join(', ')} |`)
		.join('\n');
	const bildZeilen = bilder.map((b) => `| \`${b.file}\` | ${b.description} |`).join('\n');
	// Die Verschiebung, die Fremddaten auf den Ursprung bringt.
	const dx = -x0, dy = -y0;
	const ter = v.terrain;
	const ov = v.overture;
	const ort = v.place ? [v.place.name, v.place.region].filter(Boolean).join(', ') : '—';

	if (sprache === 'de') return `# Nolli-Paket — ${ort}

Kontext aus OpenStreetMap für Städtebau und Entwurf. Erstellt ${v.created}.
${v.license}.

## Inhalt

| Datei | Inhalt |
|---|---|
| \`frame.json\` | Der Datenvertrag: Rahmen, Projektion, Maßstab, Herkunft, Inhaltsverzeichnis. **Maßgeblich.** |
| \`model.obj\` | Baukörper, extrudiert. Meter, Z nach oben, Y nach Norden. Grund mit Textur, bei eingeschalteten Bäumen die Kronen als Körper \`trees\`. Materialien in \`model.mtl\` |
| \`drawing.dxf\` | Zeichnung mit getrennten Ebenen (\`N_BUILDINGS\`, \`N_STREETS\`, …), Meter |
| \`images/\` | Jede Darstellung, dazu je eine Fassung \`_bare\` ohne Baukörper und Bäume |
| \`data/\` | Alle Daten als JSON, Feldnamen siehe unten |

Die Feld- und Dateinamen sind englisch (Datenvertrag v${v.contract_version}), unabhängig von der Sprache dieser Datei. Die Beschreibungen in den Tabellen unten stammen aus dem Vertrag und sind deshalb ebenfalls englisch.

## Lage und Maßstab

- Projektion: Transversale Mercator mit Mittelmeridian im Plangebiet, Maßstab 1.
  \`${v.grid?.proj4}\`
- Ursprung von OBJ und DXF ist die linke untere Rahmenecke, im Gitter **${x0} / ${y0}** (\`bbox_grid[0]\`, \`bbox_grid[1]\`).
- Rahmen ${v.width_m} × ${v.height_m} m, ${v.area_ha} ha. Bilder ${v.pixel_width} × ${v.pixel_height} px, ${v.meters_per_pixel} m/px.
- Zum Anschluss an amtliche Daten stehen die Ecken auch in UTM (EPSG:${v.utm?.epsg}) im Vertrag.

**Rhino:** OBJ und DXF in Metern importieren, sie liegen deckungsgleich. Die Bilder passen als Textur genau auf den Rahmen von 0/0 bis ${v.width_m}/${v.height_m}.

\`model.obj\` endet sauber an der Rahmenkante. Was von Gebäuden darüber hinausragt, liegt getrennt in \`model_outside.obj\`, auf denselben Höhen; wer Schatten von außen braucht, importiert es dazu.

**Fremde Daten dazulegen (QGIS):** Aus \`grid.proj4\` ein benutzerdefiniertes Koordinatensystem anlegen, die Fremddaten dorthin projizieren und um X ${dx}, Y ${dy} verschieben. Dann liegen sie auf dem Modell. So lässt sich auch ein genaueres amtliches Geländemodell einsetzen.

## Gelände

${ter ? `Höhen aus ${ter.source}, Modelle: ${(ter.models ?? []).join(', ') || '—'}. Im Rahmen ${ter.z_min} bis ${ter.z_max} m über dem Meer.

- \`model.obj\`: Körper \`terrain\`, ein Dreiecksnetz im ${ter.grid_spacing_m}-m-Raster, mit Texturkoordinaten. Das Material \`terrain\` legt \`model_texture.png\` darauf, die Aufsicht ohne Bauten; \`model.mtl\` und das Bild müssen neben dem OBJ liegen. Die Zeichnung bleibt bewusst eben, damit sich ihre Kurven schraffieren und extrudieren lassen. Jeder Baukörper steht auf der tiefsten Geländehöhe unter seinem Grundriss (\`base_m\` in \`data/bodies.json\`). Z ist absolut, Meter über dem Meer.
- \`drawing.dxf\`: Höhenlinien alle ${ter.contour_interval_m} m auf \`N_CONTOUR\`, jede fünfte auf \`N_CONTOUR_MAJOR\`, jeweils auf ihrer Höhe.
- \`data/terrain.json\`: das Raster selbst, mit 150 m Rand um den Rahmen.

Die Quellmodelle haben rund 25–30 m Auflösung und messen meist die Oberfläche: Bebauung und Wald heben sie leicht an. Für Hangneigung, Talform und Flusslage im Masterplanmaßstab reicht das, für Böschungen und Stufen nicht. Ein genaueres amtliches Modell lässt sich wie oben beschrieben einsetzen.

${ter.license}` : 'Kein Gelände: Alle Körper stehen auf z = 0, ebene Platte (\`terrain_flat\`).'}

## Vorbehalte

${caveats.length ? caveats.map((c) => `- \`${c}\``).join('\n') : '- keine bekannt'}
${ov ? `
\`buildings_from_imagery\`: ${ov.added} Gebäude stammen nicht aus OpenStreetMap, sondern aus Overture (Release ${ov.release}). Ergänzt nur, wo OSM kein Gebäude hatte. Umrisse und Höhen sind meist mit maschinellem Lernen aus Luftbildern gewonnen; Höhen tragen \`source: imagery\`, die Körper \`origin: overture\` und \`geometry_source\` in \`data/bodies.json\` und \`_height_estimated\` im OBJ. ${ov.attribution}.
` : ''}
\`roofs_flat\`: Jeder Baukörper hat eine Höhe und ein waagerechtes Dach. Höhen ohne Messung kommen aus der Geschosszahl oder sind mit 8 m angenommen; solche Körper tragen \`_height_estimated\` im Namen.

## Bilder

| Datei | Inhalt |
|---|---|
${bildZeilen}

## Daten

| Datei | Einträge | Inhalt | Felder |
|---|---|---|---|
${datenZeilen}
`;

	return `# Nolli package — ${ort}

Context from OpenStreetMap for urban design. Created ${v.created}.
${v.license}.

## Contents

| File | Contents |
|---|---|
| \`frame.json\` | The data contract: frame, projection, scale, provenance, table of contents. **Authoritative.** |
| \`model.obj\` | Extruded building bodies. Metres, Z up, Y north. Textured ground; with trees switched on, the crowns as one object \`trees\`. Materials in \`model.mtl\` |
| \`drawing.dxf\` | Drawing with separate layers (\`N_BUILDINGS\`, \`N_STREETS\`, …), metres |
| \`images/\` | Every style, plus a \`_bare\` version without buildings and trees |
| \`data/\` | All data as JSON, field names below |

Data contract v${v.contract_version}.

## Position and scale

- Projection: transverse Mercator with the central meridian in the site, scale 1.
  \`${v.grid?.proj4}\`
- OBJ and DXF have their origin at the lower-left frame corner, at **${x0} / ${y0}** in the grid (\`bbox_grid[0]\`, \`bbox_grid[1]\`).
- Frame ${v.width_m} × ${v.height_m} m, ${v.area_ha} ha. Images ${v.pixel_width} × ${v.pixel_height} px, ${v.meters_per_pixel} m/px.
- For joining official data, the corners are also in the contract in UTM (EPSG:${v.utm?.epsg}).

**Rhino:** import OBJ and DXF in metres; they line up. The images fit exactly onto the frame from 0/0 to ${v.width_m}/${v.height_m} as a texture.

\`model.obj\` ends cleanly at the frame edge. Whatever buildings reach beyond it is in \`model_outside.obj\`, at the same heights; import it as well if you need shadows from outside.

**Adding other data (QGIS):** create a custom coordinate system from \`grid.proj4\`, reproject the other data into it and move it by X ${dx}, Y ${dy}. It then sits on the model. This is also how to bring in a more accurate official terrain model.

## Terrain

${ter ? `Heights from ${ter.source}, models: ${(ter.models ?? []).join(', ') || '—'}. Within the frame ${ter.z_min} to ${ter.z_max} m above sea level.

- \`model.obj\`: body \`terrain\`, a triangle mesh on a ${ter.grid_spacing_m} m grid, with texture coordinates. The material \`terrain\` puts \`model_texture.png\` on it, the top view without buildings; keep \`model.mtl\` and the image next to the OBJ. The drawing deliberately stays flat so its curves can still be hatched and extruded. Every building stands on the lowest terrain height under its footprint (\`base_m\` in \`data/bodies.json\`). Z is absolute, metres above sea level.
- \`drawing.dxf\`: contours every ${ter.contour_interval_m} m on \`N_CONTOUR\`, every fifth on \`N_CONTOUR_MAJOR\`, each at its height.
- \`data/terrain.json\`: the raster itself, with a 150 m margin around the frame.

The source models have roughly 25–30 m resolution and mostly measure the surface: buildings and forest raise it slightly. Good enough for slope, valley form and river position at masterplan scale, not for embankments and steps. A more accurate official model can be brought in as described above.

${ter.license}` : 'No terrain: all bodies stand on z = 0, a flat plate (\`terrain_flat\`).'}

## Caveats

${caveats.length ? caveats.map((c) => `- \`${c}\``).join('\n') : '- none known'}
${ov ? `
\`buildings_from_imagery\`: ${ov.added} buildings do not come from OpenStreetMap but from Overture (release ${ov.release}). Added only where OSM had no building. Footprints and heights are mostly derived by machine learning from aerial imagery; heights carry \`source: imagery\`, the bodies \`origin: overture\` and \`geometry_source\` in \`data/bodies.json\`, and \`_height_estimated\` in the OBJ. ${ov.attribution}.
` : ''}
\`roofs_flat\`: every body has one height and a flat roof. Heights that are not measured come from the number of storeys or are assumed at 8 m; such bodies carry \`_height_estimated\` in their name.

## Images

| File | Contents |
|---|---|
${bildZeilen}

## Data

| File | Entries | Contents | Fields |
|---|---|---|---|
${datenZeilen}
`;
}
