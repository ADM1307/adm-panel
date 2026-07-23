// =====================================================================
//  ADM · Scraper · orquestador de prospección
//  Recorre verticales activas × ciudades objetivo, busca en Google Places,
//  normaliza, deduplica (vía DB) y escribe leads nuevos.
//
//  Uso:
//    node src/index.js                      # todas las verticales activas
//    node src/index.js --vertical=clinicas  # una sola vertical
//    node src/index.js --ciudad=Delicias    # una sola ciudad
//    node src/index.js --dry                # no escribe, solo reporta
// =====================================================================
import { pool, upsertLead, registrarEjecucion, registrarEvento } from './db.js';
import { buscarNegocios, normalizarPlace } from './places.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DRY = Boolean(args.dry);

async function leerConfig(clave, fallback) {
  const { rows } = await pool.query('SELECT valor FROM configuracion WHERE clave=$1', [clave]);
  return rows[0]?.valor ?? fallback;
}

async function leerVerticales() {
  let sql = 'SELECT id, clave, nombre, giros_google FROM verticales WHERE activo = true';
  const params = [];
  if (args.vertical) { params.push(args.vertical); sql += ` AND clave = $${params.length}`; }
  sql += ' ORDER BY prioridad';
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  const inicio = Date.now();
  let insertados = 0, duplicados = 0, descartados = 0, vistos = 0;

  const ciudadesCfg = await leerConfig('ciudades_objetivo', ['Chihuahua']);
  const ciudades = args.ciudad ? [args.ciudad] : ciudadesCfg;
  const verticales = await leerVerticales();

  console.log(`🔎 Prospección ADM — ${verticales.length} verticales × ${ciudades.length} ciudades${DRY ? ' (DRY RUN)' : ''}`);

  for (const v of verticales) {
    for (const ciudad of ciudades) {
      for (const giro of v.giros_google) {
        const query = `${giro} en ${ciudad}, Chihuahua, México`;
        let places = [];
        try {
          places = await buscarNegocios(query, { maxPaginas: 2 });
        } catch (e) {
          console.error(`  ⚠️  ${query} → ${e.message}`);
          continue;
        }

        for (const place of places) {
          vistos++;
          const lead = normalizarPlace(place, { ciudad, verticalId: v.id, giroBusqueda: giro });

          // Anti-ICP básico: negocios cerrados permanentemente se descartan.
          if (lead._businessStatus === 'CLOSED_PERMANENTLY') { descartados++; continue; }
          delete lead._businessStatus;

          if (DRY) { insertados++; continue; }

          const r = await upsertLead(lead);
          if (r === null) { duplicados++; continue; }
          if (r.insertado) {
            insertados++;
            await registrarEvento(r.id, 'lead_descubierto', { query, giro, ciudad });
          } else {
            duplicados++;
          }
        }
        console.log(`  · ${giro} @ ${ciudad}: ${places.length} resultados`);
      }
    }
  }

  const resumen = `vistos=${vistos} nuevos=${insertados} dup=${duplicados} descartados=${descartados}`;
  console.log(`✅ Listo — ${resumen} (${((Date.now() - inicio) / 1000).toFixed(1)}s)`);

  if (!DRY) {
    await registrarEjecucion({
      job: 'prospeccion_diaria', estado: 'ok', items: insertados, resumen,
    });
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Fallo la prospección:', e);
  try { await registrarEjecucion({ job: 'prospeccion_diaria', estado: 'error', error: e.message }); } catch {}
  await pool.end();
  process.exit(1);
});
