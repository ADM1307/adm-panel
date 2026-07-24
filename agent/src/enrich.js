// =====================================================================
//  ADM · Enriquecedor de contactos (sin IA · GRATIS).
//  Para leads que YA tienen sitio web pero les falta correo, entra a su
//  página (inicio + /contacto) y saca un correo de negocio publicado.
//  Así el motor puede enviar por email sin pagar ninguna fuente de datos.
//
//  No inventa correos: solo usa los que el propio negocio publica en su web
//  (contacto de negocio, uso legítimo B2B). El opt-out y el aviso de
//  privacidad viajan en cada mensaje, como marca la LFPDPPP.
//
//  Uso:  node src/enrich.js [--limite=300] [--timeout=8000]
// =====================================================================
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 150);
const TIMEOUT = Number(args.timeout ?? 6000);
const CONCURRENCIA = Number(args.concurrencia ?? 6);

// Nuestro propio dominio: JAMÁS asignar el correo de ADM como si fuera del lead
// (muchos sitios de clientes que ADM construyó traen contact@atlasdigitalmark.com).
const DOMINIO_PROPIO = 'atlasdigitalmark.com';

// Correos "basura" por prefijo (local-part) que NO son un contacto de negocio.
const JUNK_LOCAL = /^(no-?reply|no_reply|newsletter|mailer-daemon|postmaster|abuse|donotreply|bounce|notifications?|wordpress|user|usuario|nombre|correo|tucorreo|email|mail|ejemplo|example|sample|prueba|test|demo)$/i;
// Dominios placeholder / propio: se comparan EXACTO (no como substring, para no
// tumbar gmail.com u hotmail.com que contienen "mail.com").
const DOM_EXACTOS = new Set([
  DOMINIO_PROPIO, 'email.com', 'mail.com', 'correo.com', 'domain.com', 'dominio.com',
  'yourdomain.com', 'yoursite.com', 'tudominio.com', 'test.com', 'example.com',
  'example.org', 'example.net', 'localhost', 'sentry.io', 'sentry.com',
]);
// Autoridades, redes y plataformas: se bloquean por sufijo de dominio.
const DOM_SUFIJOS = [
  'inai.org.mx', 'gob.mx', 'google.com', 'googlemail.com', 'gstatic.com',
  'facebook.com', 'fb.com', 'fbcdn.net', 'instagram.com', 'whatsapp.com',
  'twitter.com', 'x.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
  'wordpress.com', 'wordpress.org', 'wix.com', 'wixpress.com', 'squarespace.com',
  'godaddy.com', 'schema.org', 'w3.org', 'sentry.io',
];
// Prefijos que suelen ser el contacto correcto de un negocio.
const BUENOS = /^(contacto|contact|ventas|hola|info|informacion|administracion|admin|atencion|citas|reservaciones|reservas|recepcion|gerencia|direccion)@/i;

/** ¿Es un correo utilizable como contacto real del lead? */
export function correoValido(e, dominio = null) {
  if (!e) return false;
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return false;
  if (e.startsWith('+') || e.includes('..')) return false;
  const [local, dom] = e.split('@');
  if (JUNK_LOCAL.test(local)) return false;
  if (DOM_EXACTOS.has(dom)) return false;
  if (dom === DOMINIO_PROPIO || dom.endsWith('.' + DOMINIO_PROPIO)) return false;
  if (DOM_SUFIJOS.some((s) => dom === s || dom.endsWith('.' + s))) return false;
  return true;
}

/** Saca correos válidos de un HTML. Devuelve lista ordenada por calidad. */
export function extraerEmails(html, dominio = null) {
  if (!html) return [];
  const set = new Set();
  const push = (raw) => {
    if (!raw) return;
    let e = raw.toLowerCase().trim().replace(/^mailto:/, '').replace(/[?#].*$/, '').replace(/\.$/, '');
    e = decodeURIComponent(e.replace(/%40/gi, '@'));
    if (!correoValido(e, dominio)) return;
    set.add(e);
  };
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) push(m[1]);
  for (const m of html.matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)) push(m[0]);

  const d = (dominio || '').replace(/^www\./, '');
  return [...set].sort((a, b) => {
    // 1) mismo dominio que el sitio, 2) prefijo de negocio, 3) alfabético
    const domA = d && (a.endsWith('@' + d) || a.endsWith('.' + d)) ? 1 : 0;
    const domB = d && (b.endsWith('@' + d) || b.endsWith('.' + d)) ? 1 : 0;
    if (domA !== domB) return domB - domA;
    const buenoA = BUENOS.test(a) ? 1 : 0;
    const buenoB = BUENOS.test(b) ? 1 : 0;
    if (buenoA !== buenoB) return buenoB - buenoA;
    return a.localeCompare(b);
  });
}

/** Saca un teléfono de enlaces tel: (respaldo para WhatsApp). */
export function extraerTelefono(html) {
  if (!html) return null;
  for (const m of html.matchAll(/tel:([+\d][\d\s().\-]{6,})/gi)) {
    const d = m[1].replace(/[^\d]/g, '');
    if (d.length >= 10) return d;
  }
  return null;
}

function dominioDe(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

async function fetchTexto(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ADM-Motor-Ventas/1.0 (+contact@atlasdigitalmark.com)' },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/html|text|xml/.test(ct)) return null;
    return (await res.text()).slice(0, 600000);
  } catch { return null; }
  finally { clearTimeout(t); }
}

/** Entra al sitio del lead y regresa {emails, telefono}. */
export async function enriquecerSitio(sitioWeb, timeoutMs = TIMEOUT) {
  const base = /^https?:\/\//i.test(sitioWeb) ? sitioWeb : 'https://' + sitioWeb;
  const dom = dominioDe(base);
  // Rutas típicas de contacto. NO usamos /aviso-de-privacidad: suele traer el
  // correo del INAI o del hosting, no del negocio.
  const rutas = ['', '/contacto', '/contact', '/contactanos', '/nosotros'];
  const emails = new Set();
  let telefono = null;
  for (const r of rutas) {
    let u;
    try { u = new URL(r, base).href; } catch { continue; }
    const html = await fetchTexto(u, timeoutMs);
    if (!html) continue;
    for (const e of extraerEmails(html, dom)) emails.add(e);
    if (!telefono) telefono = extraerTelefono(html);
    if (emails.size) break; // ya encontramos correo; no seguimos gastando requests
  }
  return { dom, emails: [...emails], telefono };
}

/** Limpia correos malos que ya estaban guardados (dominio propio, INAI,
 *  placeholders, redes) para que se puedan volver a enriquecer bien. */
async function sanitizar() {
  const { rows } = await pool.query(`SELECT id, email_general FROM leads WHERE email_general IS NOT NULL AND email_general <> ''`);
  const malos = rows.filter((r) => !correoValido(String(r.email_general).toLowerCase()));
  for (const m of malos) {
    await pool.query(`UPDATE leads SET email_general = NULL WHERE id = $1`, [m.id]);
  }
  if (malos.length) console.log(`🧹 Limpiados ${malos.length} correos inválidos previos (dominio propio / autoridades / placeholders).`);
  return malos.length;
}

/** Corre tareas con concurrencia limitada. */
async function enParalelo(items, limite, fn) {
  const cola = [...items.entries()];
  const workers = Array.from({ length: Math.min(limite, cola.length) }, async () => {
    while (cola.length) {
      const [i, item] = cola.shift();
      await fn(item, i);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const limpiados = await sanitizar();

  const { rows: leads } = await pool.query(`
    SELECT id, empresa, sitio_web, telefono
    FROM leads
    WHERE sitio_web IS NOT NULL AND sitio_web <> ''
      AND (email_general IS NULL OR email_general = '')
    ORDER BY score DESC NULLS LAST, creado_en ASC
    LIMIT $1`, [LIMITE]);

  console.log(`🔎 Enriqueciendo ${leads.length} leads con sitio web (buscando correo, ${CONCURRENCIA} en paralelo)...`);
  let conEmail = 0, conTel = 0, sinNada = 0;

  await enParalelo(leads, CONCURRENCIA, async (l) => {
    let r;
    try { r = await enriquecerSitio(l.sitio_web); }
    catch (e) { sinNada++; return; }

    const email = r.emails[0] || null;
    const tel = (!l.telefono && r.telefono) ? r.telefono : null;
    if (!email && !tel) { sinNada++; return; }

    await pool.query(`
      UPDATE leads
      SET email_general = COALESCE($2, email_general),
          telefono      = COALESCE(telefono, $3),
          actualizado_en = now()
      WHERE id = $1`, [l.id, email, tel]);

    if (email) {
      conEmail++;
      await pool.query(
        `INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1,'contacto_enriquecido','agente_ia',$2)`,
        [l.id, { email, fuente: 'sitio_web', dominio: r.dom }]);
      console.log(`  ✓ ${l.empresa} → ${email}`);
    }
    if (tel) conTel++;
  });

  const resumen = `limpiados=${limpiados} con_email=${conEmail} con_tel=${conTel} sin_dato=${sinNada} (de ${leads.length})`;
  console.log(`✅ Enriquecido — ${resumen}`);
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen)
     VALUES ('enriquecimiento','ok', now(), now(), $1, $2)`, [conEmail, resumen]);
  await pool.end();
}

// Corre solo al ejecutarse directamente (no al importarlo para pruebas).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
}
