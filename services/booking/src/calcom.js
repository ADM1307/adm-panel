// =====================================================================
//  ADM · Booking · Cal.com
//  - linkCita(lead): link de Cal.com prellenado (gratis, plan free de Cal).
//  - manejadorWebhook(body): al crearse una cita, registra en `citas`,
//    avanza el lead a 'cita_agendada' y dispara handoff a Fernando.
// =====================================================================
import pg from 'pg';
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

/** Genera el link de Cal.com prellenado con datos del lead. */
export function linkCita(lead, base = process.env.CAL_LINK || 'https://cal.com/adm/diagnostico') {
  const q = new URLSearchParams();
  if (lead.contacto_nombre) q.set('name', lead.contacto_nombre);
  if (lead.contacto_email || lead.email_general) q.set('email', lead.contacto_email || lead.email_general);
  if (lead.empresa) q.set('notes', `Empresa: ${lead.empresa}`);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * Webhook de Cal.com (evento BOOKING_CREATED / BOOKING_RESCHEDULED).
 * Ubica el lead por email del asistente, crea la cita y hace handoff.
 * Devuelve { cita_id, lead_id } o null.
 */
export async function manejadorWebhook(body) {
  const ev = body?.triggerEvent;
  const p = body?.payload || {};
  const email = p?.attendees?.[0]?.email || p?.responses?.email?.value;
  const inicio = p?.startTime || p?.start;
  const fin = p?.endTime || p?.end;
  if (!email || !inicio) return null;

  const { rows } = await pool.query(`
    SELECT l.id FROM leads l
    LEFT JOIN contactos c ON c.lead_id=l.id
    WHERE lower(c.email)=lower($1) OR lower(l.email_general)=lower($1) LIMIT 1`, [email]);
  const leadId = rows[0]?.id;
  if (!leadId) return null;

  const closer = (await pool.query("SELECT id FROM usuarios WHERE rol='closer' LIMIT 1")).rows[0]?.id;
  const estado = ev === 'BOOKING_CANCELLED' ? 'cancelada' : (ev === 'BOOKING_RESCHEDULED' ? 'reprogramada' : 'agendada');

  const { rows: cita } = await pool.query(`
    INSERT INTO citas (lead_id, closer_id, estado, inicio, fin, medio, cal_booking_uid, liga_reunion)
    VALUES ($1,$2,$3,$4,$5,'videollamada',$6,$7)
    RETURNING id`,
    [leadId, closer, estado, inicio, fin || null, p?.uid || null, p?.metadata?.videoCallUrl || p?.location || null]);

  if (estado !== 'cancelada') {
    await pool.query("UPDATE leads SET estado_pipeline='cita_agendada' WHERE id=$1", [leadId]);
  }
  await pool.query("INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1,'cita','sistema',$2)", [leadId, { estado, inicio }]);
  // Aquí dispararías la notificación de handoff a Fernando (email/WhatsApp).
  return { cita_id: cita[0].id, lead_id: leadId };
}

// CLI de prueba: node src/calcom.js --link  (imprime un link de ejemplo)
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--link')) {
  console.log(linkCita({ contacto_nombre: 'Luis Herrera', contacto_email: 'luis@ejemplo.mx', empresa: 'Tacos El Güero' }));
  await pool.end();
}
