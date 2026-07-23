// =====================================================================
//  ADM · Outreach · WhatsApp Cloud API (free tier de conversaciones).
//  - Envía mensajes aprobados de canal 'whatsapp'.
//  - Exporta manejadorWebhook() para el webhook de mensajes entrantes.
//
//  --dry : simula el envío sin llamar a Meta.
//  Uso:   node src/whatsapp.js [--dry] [--limite=100] [--sin-horario]
// =====================================================================
import { pool, suprimido, enHorario, evento, ejecucion } from './lib.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const DRY = 'dry' in args;
const LIMITE = Number(args.limite ?? 100);

/** Normaliza a formato E.164 sin '+' (Meta lo pide así). */
function e164(tel) {
  const d = (tel || '').replace(/[^\d]/g, '');
  return d.startsWith('52') ? d : d ? '52' + d : '';
}

async function enviarWhatsApp(to, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('Faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID.');
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
  return (await res.json()).messages?.[0]?.id;
}

async function main() {
  if (!DRY && !(await enHorario()) && !('sin-horario' in args)) {
    console.log('⏸  Fuera del horario de envío.'); await pool.end(); return;
  }
  const { rows: msgs } = await pool.query(`
    SELECT m.id, m.lead_id, m.cuerpo, l.empresa,
           COALESCE(c.whatsapp, c.telefono, l.telefono) AS destino
    FROM mensajes m
    JOIN leads l ON l.id = m.lead_id
    LEFT JOIN contactos c ON c.id = m.contacto_id
    WHERE m.canal='whatsapp' AND m.direccion='saliente'
      AND m.estado IN ('aprobado','programado')
      AND (m.programado_para IS NULL OR m.programado_para <= now())
    ORDER BY m.creado_en LIMIT $1`, [LIMITE]);

  console.log(`💬 ${msgs.length} WhatsApp por enviar ${DRY ? '(DRY RUN)' : '(Cloud API)'}...`);
  let enviados = 0, suprimidos = 0, fallidos = 0;

  for (const m of msgs) {
    const to = e164(m.destino);
    if (!to) { fallidos++; await marcar(m.id, 'fallido', 'sin teléfono'); continue; }
    if (await suprimido(null, m.destino)) { suprimidos++; await marcar(m.id, 'cancelado', 'do_not_contact'); continue; }
    try {
      let pid = 'dry-' + m.id.slice(0, 8);
      if (!DRY) pid = await enviarWhatsApp(to, m.cuerpo);
      await pool.query(`UPDATE mensajes SET estado='enviado', proveedor='whatsapp', proveedor_msg_id=$2, enviado_en=now() WHERE id=$1`, [m.id, pid]);
      await pool.query(`UPDATE leads SET estado_pipeline='contactada' WHERE id=$1 AND estado_pipeline IN ('calificada','descubierta')`, [m.lead_id]);
      await evento(m.lead_id, 'mensaje_enviado', { canal: 'whatsapp', dry: DRY });
      enviados++;
      console.log(`  ✓ ${m.empresa} → ${to}${DRY ? ' (simulado)' : ''}`);
    } catch (e) { fallidos++; await marcar(m.id, 'fallido', e.message); console.error(`  ⚠️  ${m.empresa}: ${e.message}`); }
  }
  const resumen = `enviados=${enviados} suprimidos=${suprimidos} fallidos=${fallidos}${DRY ? ' (dry)' : ''}`;
  console.log(`✅ ${resumen}`);
  await ejecucion('outreach_whatsapp', 'ok', enviados, resumen);
  await pool.end();
}

async function marcar(id, estado, detalle) {
  await pool.query('UPDATE mensajes SET estado=$2, error_detalle=$3 WHERE id=$1', [id, estado, detalle]);
}

/**
 * Manejador del webhook de WhatsApp (úsalo desde n8n o un endpoint HTTP).
 * Guarda el mensaje entrante y devuelve {lead_id, texto} para dispararle reply.js.
 * `body` es el JSON que envía Meta.
 */
export async function manejadorWebhook(body) {
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return null;
  const de = msg.from; // E.164 sin '+'
  const texto = msg.text?.body || '';
  const { rows } = await pool.query(`
    SELECT l.id FROM leads l
    LEFT JOIN contactos c ON c.lead_id=l.id
    WHERE regexp_replace(COALESCE(c.whatsapp,c.telefono,l.telefono),'[^0-9]','','g') LIKE '%'||$1||'%'
    LIMIT 1`, [de.slice(-10)]);
  const leadId = rows[0]?.id;
  if (!leadId) return null;
  // Opt-out
  if (/^\s*baja\b/i.test(texto)) {
    await pool.query("INSERT INTO do_not_contact (telefono, motivo, canal_origen, lead_id) VALUES ($1,'opt_out','whatsapp',$2) ON CONFLICT DO NOTHING", ['+' + de, leadId]);
    await pool.query("UPDATE leads SET estado_pipeline='perdida' WHERE id=$1", [leadId]);
  } else {
    await pool.query(`INSERT INTO mensajes (lead_id, canal, direccion, estado, cuerpo) VALUES ($1,'whatsapp','entrante','respondido',$2)`, [leadId, texto]);
    await pool.query(`UPDATE leads SET estado_pipeline='respondio' WHERE id=$1 AND estado_pipeline IN ('contactada','en_conversacion')`, [leadId]);
    await evento(leadId, 'respuesta', { canal: 'whatsapp' });
  }
  return { lead_id: leadId, texto };
}

// Ejecuta el envío solo si se corre directamente (no al importar el webhook).
if (import.meta.url === `file://${process.argv[1]}`) main();
