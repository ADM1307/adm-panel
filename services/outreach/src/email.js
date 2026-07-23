// =====================================================================
//  ADM · Outreach · Enviar correos aprobados con Resend (free tier).
//  Verifica compliance (do_not_contact + horario), envía, marca el
//  mensaje como enviado y avanza el lead a 'contactada'.
//
//  --dry : no llama a Resend; simula el envío (para probar sin llave).
//  Uso:   node src/email.js [--dry] [--limite=100] [--sin-horario]
// =====================================================================
import { pool, cfg, suprimido, enHorario, evento, ejecucion } from './lib.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const DRY = 'dry' in args;
const LIMITE = Number(args.limite ?? 100);

async function enviarResend({ from, to, subject, html, replyTo, listUnsub }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Falta RESEND_API_KEY.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [to], subject, html,
      reply_to: replyTo,
      headers: { 'List-Unsubscribe': listUnsub },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

async function main() {
  const from = process.env.EMAIL_FROM || 'ADM <hola@atlasdigitalmark.com>';
  const optOut = await cfg('texto_opt_out', 'Responde BAJA para no recibir más mensajes.');

  if (!DRY && !(await enHorario()) && !('sin-horario' in args)) {
    console.log('⏸  Fuera del horario de envío. (Usa --sin-horario para forzar.)');
    await pool.end(); return;
  }

  const { rows: msgs } = await pool.query(`
    SELECT m.id, m.lead_id, m.asunto, m.cuerpo,
           COALESCE(c.email, l.email_general) AS destino, l.empresa, c.telefono
    FROM mensajes m
    JOIN leads l ON l.id = m.lead_id
    LEFT JOIN contactos c ON c.id = m.contacto_id
    WHERE m.canal='email' AND m.direccion='saliente'
      AND m.estado IN ('aprobado','programado')
      AND (m.programado_para IS NULL OR m.programado_para <= now())
    ORDER BY m.creado_en
    LIMIT $1`, [LIMITE]);

  console.log(`✉️  ${msgs.length} correos por enviar ${DRY ? '(DRY RUN)' : '(Resend)'}...`);
  let enviados = 0, suprimidos = 0, fallidos = 0;

  for (const m of msgs) {
    if (!m.destino) { fallidos++; await marcar(m.id, 'fallido', 'sin email destino'); continue; }
    if (await suprimido(m.destino, m.telefono)) {
      suprimidos++; await marcar(m.id, 'cancelado', 'en do_not_contact'); continue;
    }
    const html = m.cuerpo.replace(/\n/g, '<br>');
    const listUnsub = `<mailto:baja@atlasdigitalmark.com?subject=BAJA>`;
    try {
      let pid = 'dry-' + m.id.slice(0, 8);
      if (!DRY) {
        // Reply-To: las respuestas del prospecto llegan a la bandeja de ADM.
        const replyTo = process.env.EMAIL_REPLY_TO || 'contact@atlasdigitalmark.com';
        pid = await enviarResend({ from, to: m.destino, subject: m.asunto, html,
          replyTo, listUnsub });
      }
      await pool.query(
        `UPDATE mensajes SET estado='enviado', proveedor='resend', proveedor_msg_id=$2, enviado_en=now() WHERE id=$1`,
        [m.id, pid]);
      // Avanzar el lead a 'contactada' (si no está más adelante).
      await pool.query(`
        UPDATE leads SET estado_pipeline='contactada'
        WHERE id=$1 AND estado_pipeline IN ('calificada','descubierta')`, [m.lead_id]);
      await evento(m.lead_id, 'mensaje_enviado', { canal: 'email', destino: m.destino, dry: DRY });
      enviados++;
      console.log(`  ✓ ${m.empresa} → ${m.destino}${DRY ? ' (simulado)' : ''}`);
    } catch (e) {
      fallidos++; await marcar(m.id, 'fallido', e.message);
      console.error(`  ⚠️  ${m.empresa}: ${e.message}`);
    }
  }

  const resumen = `enviados=${enviados} suprimidos=${suprimidos} fallidos=${fallidos}${DRY ? ' (dry)' : ''}`;
  console.log(`✅ ${resumen}`);
  await ejecucion('outreach_email', 'ok', enviados, resumen);
  await pool.end();
}

async function marcar(id, estado, detalle) {
  await pool.query('UPDATE mensajes SET estado=$2, error_detalle=$3 WHERE id=$1', [id, estado, detalle]);
}

main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
