// =====================================================================
//  ADM · Scraper GRATIS con OpenStreetMap (Overpass API) — SIN llave.
//  Trae negocios locales de Chihuahua (y ciudades objetivo) 24/7.
//  Overpass es abierto y gratuito; corre 1×/hora para respetar el fair-use.
//
//  Uso:  node src/osm.js [--dry]
// =====================================================================
import { pool, upsertLead, registrarEjecucion, registrarEvento } from './db.js';

const DRY = process.argv.includes('--dry');

// Cajas (bounding boxes) aprox. de las ciudades objetivo: [sur, oeste, norte, este]
const CIUDADES = [
  { ciudad: 'Chihuahua',      bbox: [28.55, -106.20, 28.75, -106.00] },
  { ciudad: 'Ciudad Juárez',  bbox: [31.60, -106.55, 31.80, -106.35] },
  { ciudad: 'Delicias',       bbox: [28.15, -105.53, 28.24, -105.42] },
  { ciudad: 'Cuauhtémoc',     bbox: [28.38, -106.90, 28.46, -106.82] },
  { ciudad: 'Parral',         bbox: [26.90, -105.70, 26.97, -105.62] },
];

// Mapa de etiquetas OSM → vertical ADM + señal de giro
const MAP = [
  { k: 'amenity', v: /^(restaurant|cafe|bar|fast_food|pub|food_court|ice_cream)$/, vertical: 'restaurantes' },
  { k: 'amenity', v: /^(dentist|clinic|doctors|hospital)$/,                        vertical: 'clinicas' },
  { k: 'amenity', v: /^(gym)$/,                                                    vertical: 'gimnasios' },
  { k: 'leisure', v: /^(fitness_centre|sports_centre)$/,                           vertical: 'gimnasios' },
  { k: 'shop',    v: /^(clothes|shoes|boutique|jewelry|furniture|gift)$/,          vertical: 'retail' },
  { k: 'shop',    v: /^(beauty|hairdresser|cosmetics)$/,                           vertical: 'salud_bienestar' },
  { k: 'office',  v: /^(lawyer|accountant|estate_agent)$/,                         vertical: 'despachos' },
  { k: 'shop',    v: /^(car_repair|tyres|car)$/,                                   vertical: 'automotriz' },
  { k: 'tourism', v: /^(hotel|motel|guest_house)$/,                                vertical: 'hoteles' },
];

function clasificar(tags) {
  for (const m of MAP) {
    const val = tags[m.k];
    if (val && m.v.test(val)) return { vertical: m.vertical, giro: `${m.k}=${val}` };
  }
  return null;
}

async function consultarOverpass(bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:60];
(
  node["amenity"~"^(restaurant|cafe|bar|fast_food|pub|dentist|clinic|doctors|gym)$"](${s},${w},${n},${e});
  node["leisure"~"^(fitness_centre|sports_centre)$"](${s},${w},${n},${e});
  node["shop"~"^(clothes|shoes|boutique|jewelry|furniture|beauty|hairdresser|car_repair|tyres)$"](${s},${w},${n},${e});
  node["office"~"^(lawyer|accountant|estate_agent)$"](${s},${w},${n},${e});
  node["tourism"~"^(hotel|motel|guest_house)$"](${s},${w},${n},${e});
);
out center 400;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': 'ADM-Motor-Ventas/1.0 (contact@atlasdigitalmark.com)' },
        body: q,
      });
      if (!res.ok) { lastErr = new Error(`Overpass ${res.status}`); continue; }
      return (await res.json()).elements ?? [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('Overpass sin respuesta');
}

/** Normaliza un elemento OSM al shape de leads. */
export function normalizarOSM(el, ciudad) {
  const tags = el.tags ?? {};
  const clas = clasificar(tags);
  if (!clas || !tags.name) return null;
  const website = tags.website || tags['contact:website'] || null;
  const telefono = tags.phone || tags['contact:phone'] || null;
  const email = tags.email || tags['contact:email'] || null;
  const tieneWeb = Boolean(website);
  return {
    empresa: tags.name,
    giro: clas.giro,
    vertical_clave: clas.vertical,
    ciudad,
    estado: 'Chihuahua',
    sitio_web: website,
    telefono,
    email_general: email,
    google_place_id: `osm:${el.type}/${el.id}`, // id externo estable (dedupe + upsert)
    google_maps_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    tiene_web: tieneWeb,
    redes: {},
    sucursales: 1,
    hallazgo_clave: !tieneWeb
      ? 'Sin sitio web en su ficha pública (OpenStreetMap)'
      : 'Tiene web; oportunidad de mejorar captación/anuncios',
    fuente: 'openstreetmap',
  };
}

async function verticalId(clave, cache) {
  if (cache[clave] !== undefined) return cache[clave];
  const { rows } = await pool.query('SELECT id FROM verticales WHERE clave=$1', [clave]);
  return (cache[clave] = rows[0]?.id ?? null);
}

async function main() {
  const inicio = Date.now();
  let vistos = 0, nuevos = 0, dup = 0;
  const cache = {};

  for (const { ciudad, bbox } of CIUDADES) {
    let elements = [];
    try { elements = await consultarOverpass(bbox); }
    catch (e) { console.error(`  ⚠️  ${ciudad}: ${e.message}`); continue; }

    for (const el of elements) {
      const lead = normalizarOSM(el, ciudad);
      if (!lead) continue;
      vistos++;
      lead.vertical_id = await verticalId(lead.vertical_clave, cache);
      delete lead.vertical_clave;
      if (DRY) { nuevos++; continue; }
      const r = await upsertLead(lead);
      if (r === null) { dup++; continue; }
      if (r.insertado) { nuevos++; await registrarEvento(r.id, 'lead_descubierto', { fuente: 'osm', ciudad }); }
      else dup++;
    }
    console.log(`  · ${ciudad}: ${elements.length} POIs de OSM`);
  }

  const resumen = `vistos=${vistos} nuevos=${nuevos} dup=${dup}`;
  console.log(`✅ OSM scraper — ${resumen} (${((Date.now() - inicio) / 1000).toFixed(1)}s)`);
  if (!DRY) await registrarEjecucion({ job: 'prospeccion_osm', estado: 'ok', items: nuevos, resumen });
  await pool.end();
}

// Corre solo cuando se ejecuta directamente (no al importarlo para pruebas).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error('❌ OSM scraper:', e);
    try { await registrarEjecucion({ job: 'prospeccion_osm', estado: 'error', error: e.message }); } catch {}
    await pool.end();
    process.exit(1);
  });
}
