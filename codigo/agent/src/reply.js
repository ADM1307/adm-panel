// =====================================================================
//  ADM · agent-core · Responder a leads que contestaron.
//  Toma leads en estado 'respondio' con un mensaje entrante sin atender,
//  redacta una respuesta (plantilla gratis / IA opcional), la deja para
//  envío y avanza el lead a 'en_conversacion'. Detecta opt-out y handoff.
//
//  Uso:  node src/reply.js [--limite=50]
// =====================================================================
import { pool, cfg, evento, ejecucion } from './lib.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 50);
const USAR_IA = process.env.USAR_IA === 'true';

async function main() {
  const humanLoop = await cfg('human_in_the_loop', true);
  const optOut = await cfg('texto_opt_out', 'Responde BAJA para no recibir más mensajes.');
  const calLink = process.env.CAL_LINK || 'https://cal.com/adm/diagnostico';

  const { rows: leads } = await pool.query(`
    SELECT l.id, l.empresa, l.hallazgo_clave, l.oferta,
      (SELECT cuerpo FROM mensajes mm WHERE mm.lead_id=l.id AND mm.direccion='entrante'
       ORDER BY mm.creado_en DESC LIMIT 1) AS ultimo_entrante,
      (SELECT canal FROM mensajes mm WHERE mm.lead_id=l.id AND mm.direccion='entrante'
       ORDER BY mm.creado_en DESC LIMIT 1) AS canal
    FROM leads l
    WHERE l.estado_pipeline='respondio'
    ORDER BY l.actualizado_en LIMIT $1`, [LIMITE]);

  console.log(`💬 Respondiendo a ${leads.length} leads ${USAR_IA ? '(IA)' : '(plantilla)'}...`);
  let ok = 0, handoffs = 0, bajas = 0;

  for (const l of leads) {
    const entrante = (l.ultimo_entrante || '').toLowerCase();
    const canal = l.canal || 'email';

    // Opt-out explícito
    if (/\bbaja\b|no me interesa|no escrib/.test(entrante)) {
      await pool.query("UPDATE leads SET estado_pipeline='perdida' WHERE id=$1", [l.id]);
      await evento(l.id, 'opt_out', { via: canal });
      bajas++; continue;
    }

    // Señal de handoff (quiere hablar con persona / listo para comprar)
    const handoff = /humano|persona|llámame|llamame|contrat|comprar|precio final|factura/.test(entrante);

    let cuerpo;
    if (USAR_IA) {
      const { claude, MODELOS } = await import('./anthropic.js');
      cuerpo = await claude({
        system: 'Eres Sofía, asesora digital de ADM. Responde breve, cálido, español de México. Meta: agendar diagnóstico de 15 min. No cierres precio final.',
        prompt: `Empresa: ${l.empresa}. Hallazgo: ${l.hallazgo_clave}. Oferta: ${JSON.stringify(l.oferta)}. El prospecto escribió: "${l.ultimo_entrante}". Responde manejando su mensaje y ofrece 2 horarios con el link ${calLink}. Incluye "${optOut}".`,
        modelo: MODELOS.redactor, temperature: 0.6, maxTokens: 400,
      });
    } else {
      cuerpo = `¡Gracias por responder! Con gusto te resuelvo. Para darte algo a la medida de ${l.empresa}, agendemos un diagnóstico de 15 min sin costo. Elige el horario que te acomode aquí: ${calLink}\n\n${optOut}`;
    }

    const estado = handoff ? 'borrador' : (humanLoop ? 'borrador' : 'aprobado');
    await pool.query(`
      INSERT INTO mensajes (lead_id, canal, direccion, estado, cuerpo, generado_por_ia, modelo_ia)
      VALUES ($1,$2,'saliente',$3,$4,$5,$6)`,
      [l.id, canal, estado, cuerpo, USAR_IA, USAR_IA ? 'claude-sonnet' : null]);

    if (handoff) {
      await pool.query("UPDATE leads SET estado_pipeline='handoff' WHERE id=$1", [l.id]);
      await evento(l.id, 'handoff', { motivo: 'intención de compra/persona', canal });
      handoffs++;
    } else {
      await pool.query("UPDATE leads SET estado_pipeline='en_conversacion' WHERE id=$1", [l.id]);
      await evento(l.id, 'respuesta_agente', { canal });
      ok++;
    }
    console.log(`  ✓ ${l.empresa} → ${handoff ? 'HANDOFF a Fernando' : 'respondido'}`);
  }

  const resumen = `respondidos=${ok} handoffs=${handoffs} bajas=${bajas}`;
  console.log(`✅ ${resumen}`);
  await ejecucion('respuestas', 'ok', ok + handoffs, resumen);
  await pool.end();
}

main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
