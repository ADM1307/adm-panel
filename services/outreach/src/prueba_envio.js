// =====================================================================
//  ADM · PRUEBA de envío por correo (Resend).
//  Manda UN solo correo de prueba a la propia bandeja de ADM
//  (contact@atlasdigitalmark.com) para comprobar que Resend y el dominio
//  están bien configurados. NO toca la base de datos ni contacta prospectos.
//
//  Uso:  node services/outreach/src/prueba_envio.js
// =====================================================================
const DESTINO = 'contact@atlasdigitalmark.com'; // fijo: solo tu propia bandeja
const FROM = process.env.EMAIL_FROM || 'ADM · Atlas Digital Marketing <contact@atlasdigitalmark.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'contact@atlasdigitalmark.com';

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.error('❌ Falta RESEND_API_KEY (secret del repo).'); process.exit(1); }

  const ahora = new Date().toISOString();
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0f2a3d">✅ Prueba del Motor de Ventas ADM</h2>
      <p>Este es un <b>correo de prueba</b> enviado por el motor a tu propia bandeja para
      confirmar que el envío con Resend funciona de punta a punta.</p>
      <ul>
        <li><b>Remitente:</b> ${FROM}</li>
        <li><b>Responder-a:</b> ${REPLY_TO}</li>
        <li><b>Fecha (UTC):</b> ${ahora}</li>
      </ul>
      <p>Si te llegó este correo, el dominio está verificado y el motor ya puede
      enviar. Si NO te llega, revisa la verificación del dominio en Resend.</p>
      <p style="color:#5b6b78;font-size:12px">Motor de Ventas ADM · atlasdigitalmark.com</p>
    </div>`;

  console.log(`✉️  Enviando prueba a ${DESTINO} desde "${FROM}"...`);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [DESTINO],
      subject: 'PRUEBA · Motor de Ventas ADM funcionando ✅',
      html,
      reply_to: REPLY_TO,
    }),
  });

  const cuerpo = await res.text();
  if (!res.ok) {
    console.error(`❌ Resend respondió ${res.status}: ${cuerpo}`);
    console.error('   → Casi siempre es dominio NO verificado en Resend. Verifica atlasdigitalmark.com (registros DNS) y reintenta.');
    process.exit(1);
  }
  let id = '';
  try { id = JSON.parse(cuerpo).id || ''; } catch {}
  console.log(`✅ Correo de prueba ACEPTADO por Resend. id=${id}`);
  console.log(`   → Revisa la bandeja de ${DESTINO} (y spam) en 1-2 min.`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
