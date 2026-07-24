// =====================================================================
//  ADM · Enriquecedor con Google Places (New).
//  Para los leads que NO tienen ni teléfono ni correo (OSM no los trae),
//  busca el negocio por nombre + ciudad en Google Places y rellena
//  teléfono y sitio web. El teléfono sirve para WhatsApp; con el sitio,
//  el crawler (enrich.js) puede sacar después el correo.
//
//  Solo corre si hay GOOGLE_PLACES_API_KEY. Costo: 1 búsqueda por lead,
//  dentro del crédito gratis mensual de Google Cloud para este volumen.
//
//  Uso:  node services/scraper/src/enrich_places.js [--limite=300]
// =====================================================================
import { pool } from './db.js';
import { buscarNegocios } from './places.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 300);

/** Normaliza para comparar nombres (sin acentos, símbolos ni mayúsculas). */
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** ¿El resultado de Places es realmente el mismo negocio? (evita teléfonos ajenos) */
function coincide(nombreLead, place) {
  const a = norm(nombreLead), b = norm(place.displayName?.text || '');
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // solape de palabras significativas
  const pa = new Set(a.split(' ').filter((w) => w.length > 2));
  const pb = new Set(b.split(' ').filter((w) => w.length > 2));
  if (!pa.size) return false;
  let comunes = 0;
  for (const w of pa) if (pb.has(w)) comunes++;
  return comunes / pa.size >= 0.6;
}

async function main() {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.log('ℹ️  Sin GOOGLE_PLACES_API_KEY — me salto el enriquecimiento con Places.');
    await pool.end();
    return;
  }

  const { rows: leads } = await pool.query(`
    SELECT id, empresa, ciudad, telefono, email_general, sitio_web
    FROM leads
    WHERE (telefono IS NULL OR telefono = '')
      AND (email_general IS NULL OR email_general = '')
    ORDER BY score DESC NULLS LAST, creado_en ASC
    LIMIT $1`, [LIMITE]);

  console.log(`📞 Google Places: buscando contacto para ${leads.length} leads sin datos...`);
  let conTel = 0, conWeb = 0, sinMatch = 0, sinDato = 0;

  for (const l of leads) {
    let places = [];
    try {
      places = await buscarNegocios(`${l.empresa}, ${l.ciudad || 'Chihuahua'}, Chihuahua, México`, { maxPaginas: 1 });
    } catch (e) {
      console.error(`  ⚠️  ${l.empresa}: ${e.message}`);
      sinDato++;
      continue;
    }

    const m = places.find((p) => coincide(l.empresa, p));
    if (!m) { sinMatch++; continue; } // sin coincidencia confiable → no arriesgamos

    const tel = m.nationalPhoneNumber || m.internationalPhoneNumber || null;
    const web = m.websiteUri || null;
    if (!tel && !web) { sinDato++; continue; }

    await pool.query(`
      UPDATE leads
      SET telefono   = COALESCE(NULLIF(telefono,''), $2),
          sitio_web  = COALESCE(NULLIF(sitio_web,''), $3),
          tiene_web  = CASE WHEN $3 <> '' THEN true ELSE tiene_web END,
          actualizado_en = now()
      WHERE id = $1`, [l.id, tel, web || '']);

    if (tel) { conTel++; console.log(`  ✓ ${l.empresa} → ${tel}`); }
    if (web) conWeb++;
  }

  const resumen = `con_tel=${conTel} con_web=${conWeb} sin_match=${sinMatch} sin_dato=${sinDato} (de ${leads.length})`;
  console.log(`✅ Places enrich — ${resumen}`);
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen)
     VALUES ('enriquecimiento_places','ok', now(), now(), $1, $2)`, [conTel, resumen]);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
}
