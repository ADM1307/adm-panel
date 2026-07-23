// =====================================================================
//  ADM · agent-core · Redactar el primer contacto (email + WhatsApp)
//  para leads calificados que ya tienen oferta.
//
//  GRATIS por defecto: usa plantillas de la secuencia base (sin costo de IA).
//  Opcional: USAR_IA=true + ANTHROPIC_API_KEY para que Claude Sonnet redacte.
//
//  Deja los mensajes en 'borrador' (human-in-the-loop) o 'aprobado' si
//  human_in_the_loop=false y el score alcanza el umbral.
//
//  Uso:  node src/personalize.js [--limite=50] [--lead=<uuid>]
// =====================================================================
import { pool, render, cfg, evento, ejecucion } from './lib.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 50);
const USAR_IA = process.env.USAR_IA === 'true';

// Carga perezosa de la IA solo si se pide (evita costo por defecto).
async function redactarIA(system, prompt) {
  const { claude, MODELOS } = await import('./anthropic.js');
  return claude({ system, prompt, modelo: MODELOS.redactor, temperature: 0.6, maxTokens: 700 });
}

async function plantillasBase() {
  const { rows } = await pool.query(`
    SELECT sp.orden, sp.canal, sp.plantilla_asunto, sp.plantilla_cuerpo
    FROM secuencia_pasos sp
    JOIN secuencias s ON s.id = sp.secuencia_id
    WHERE s.nombre = 'Outreach base 3 toques'
    ORDER BY sp.orden`);
  return rows;
}

async function main() {
  const humanLoop = await cfg('human_in_the_loop', true);
  const scoreMin = Number(await cfg('auto_enviar_score_min', 80));
  const firma = await cfg('firma_agente', 'Sofía, asesora digital de ADM');
  const avisoUrl = await cfg('aviso_privacidad_url', 'https://atlasdigitalmark.com/privacidad');
  const optOut = await cfg('texto_opt_out', 'Responde BAJA para no recibir más mensajes.');
  const pasos = await plantillasBase();
  const emailPaso = pasos.find((p) => p.canal === 'email');
  const waPaso = pasos.find((p) => p.canal === 'whatsapp');

  let where = `l.estado_pipeline='calificada' AND l.oferta IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM mensajes m WHERE m.lead_id=l.id AND m.direccion='saliente')`;
  const params = [];
  if (args.lead) { params.push(args.lead); where = `l.id=$${params.length}`; }
  params.push(LIMITE);

  const { rows: leads } = await pool.query(`
    SELECT l.id, l.empresa, l.hallazgo_clave, l.score, l.oferta, l.email_general,
           c.id AS contacto_id, c.nombre AS contacto_nombre, c.email AS contacto_email,
           c.telefono AS contacto_tel, c.whatsapp,
           v.servicio_ancla, v.prueba_social
    FROM leads l
    LEFT JOIN contactos c ON c.lead_id = l.id AND c.es_principal = true
    LEFT JOIN verticales v ON v.id = l.vertical_id
    WHERE ${where}
    ORDER BY l.score DESC
    LIMIT $${params.length}`, params);

  console.log(`✍️  Redactando outreach para ${leads.length} leads ${USAR_IA ? '(IA)' : '(plantillas · gratis)'}...`);
  let creados = 0;

  for (const l of leads) {
    const o = l.oferta || {};
    const nombre = l.contacto_nombre ? l.contacto_nombre.split(' ')[0] : '';
    const vars = {
      empresa: l.empresa,
      contacto_nombre: nombre,
      contacto_nombre_coma: nombre ? `, ${nombre}` : '',
      hallazgo: l.hallazgo_clave || '',
      prueba_social: l.prueba_social || '',
      servicio_ancla: o.servicio || l.servicio_ancla || '',
      necesidad: o.necesidad || '',
      paquete: o.paquete || '',
      firma, aviso_privacidad_url: avisoUrl, opt_out: optOut,
    };

    // Estado según human-in-the-loop.
    const estado = (!humanLoop && l.score >= scoreMin) ? 'aprobado' : 'borrador';

    // --- EMAIL ---
    let asunto, cuerpoEmail;
    if (USAR_IA) {
      const txt = await redactarIA(
        'Eres Sofía, asesora digital de ADM. Redacta un email de primer contacto, cálido y directo, español de México.',
        `Empresa: ${l.empresa}. Hallazgo: ${vars.hallazgo}. Oferta: ${vars.necesidad} (${vars.paquete}). Prueba social (referencia): ${vars.prueba_social}. Incluye 1 CTA (auditoría gratis 24h), firma "${firma}", aviso ${avisoUrl} y opt-out "${optOut}". Devuelve: primera línea "Asunto: ..." y luego el cuerpo.`);
      const mm = txt.match(/Asunto:\s*(.+)/i);
      asunto = mm ? mm[1].trim() : render(emailPaso.plantilla_asunto, vars);
      cuerpoEmail = txt.replace(/Asunto:\s*.+\n?/i, '').trim();
    } else {
      asunto = render(emailPaso.plantilla_asunto, vars);
      cuerpoEmail = render(emailPaso.plantilla_cuerpo, vars);
    }
    await pool.query(`
      INSERT INTO mensajes (lead_id, contacto_id, canal, direccion, estado, asunto, cuerpo,
                            generado_por_ia, modelo_ia)
      VALUES ($1,$2,'email','saliente',$3,$4,$5,$6,$7)`,
      [l.id, l.contacto_id, estado, asunto, cuerpoEmail, USAR_IA, USAR_IA ? 'claude-sonnet' : null]);

    // --- WHATSAPP ---
    const cuerpoWA = USAR_IA
      ? `Hola${vars.contacto_nombre_coma} soy Sofía de ADM. En ${l.empresa} noté: ${vars.hallazgo}. Te preparo gratis una propuesta de ${vars.necesidad}. ¿Te la comparto? ${optOut}`
      : render(waPaso.plantilla_cuerpo, vars);
    await pool.query(`
      INSERT INTO mensajes (lead_id, contacto_id, canal, direccion, estado, cuerpo,
                            generado_por_ia, modelo_ia)
      VALUES ($1,$2,'whatsapp','saliente',$3,$4,$5,$6)`,
      [l.id, l.contacto_id, estado, cuerpoWA, USAR_IA, USAR_IA ? 'claude-sonnet' : null]);

    await evento(l.id, 'outreach_redactado', { estado, canales: ['email', 'whatsapp'] });
    creados += 2;
    console.log(`  ✓ ${l.empresa} → email + whatsapp (${estado})`);
  }

  const resumen = `${creados} mensajes creados para ${leads.length} leads`;
  console.log(`✅ ${resumen}`);
  await ejecucion('secuencias_outreach', 'ok', creados, resumen);
  await pool.end();
}

main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
