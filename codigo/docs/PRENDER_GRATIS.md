# Prender el Motor de Ventas GRATIS (sin VPS) — 3 pasos

El motor puede correr solo en los **servidores de GitHub (Actions)**, gratis. Ya te dejé el workflow (`.github/workflows/motor.yml`). Solo faltan 3 cosas que **solo tú puedes crear** (son tus cuentas, cuestan $0). Toma ~15 minutos.

## Paso 1 · Base de datos gratis (Supabase)
1. Entra a https://supabase.com → *Start your project* (gratis).
2. Crea un proyecto. Copia el **Connection string** (URI) de *Project Settings → Database* (algo como `postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres`).
3. Carga el esquema: en Supabase → *SQL Editor*, pega y corre, en orden:
   - `db/migrations/001_init.sql`
   - `db/migrations/002_oferta.sql`
   - `db/seeds/001_verticales.sql`
   - `db/seeds/002_secuencias_config.sql`

## Paso 2 · Consigue las llaves (todas con free tier)
- **Resend** (correo): https://resend.com → API Keys. Verifica tu dominio para enviar como `@atlasdigitalmark.com`.
- **Anthropic** (opcional, para IA): https://console.anthropic.com → API Keys. *(Si no la pones, el motor redacta con plantillas, gratis.)*
- **Google Places** (opcional, para prospectar): https://console.cloud.google.com → habilita *Places API (New)* → crea API Key.

## Paso 3 · Pega los secretos en GitHub y enciende
1. En tu repo `ADM1307/adm-panel` (o donde subas este código) → **Settings → Secrets and variables → Actions → New repository secret**. Crea:
   - `DATABASE_URL` = el connection string de Supabase
   - `RESEND_API_KEY` = tu llave de Resend
   - `EMAIL_FROM` = `ADM · Atlas Digital Marketing <hola@atlasdigitalmark.com>`
   - (opcional) `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, `CAL_LINK`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
2. En la pestaña **Actions** del repo, activa los workflows.
3. Abre **Motor de Ventas ADM (gratis)** → **Run workflow** para dispararlo ya. De ahí en adelante corre solo **cada 15 min**.

## Recomendación de arranque
- Semana 1: solo `DATABASE_URL` + `RESEND_API_KEY`. El motor redacta con plantillas (gratis) y manda correo. Deja `human_in_the_loop=true` y aprueba desde el panel.
- Cuando confíes en la calidad: pon `ANTHROPIC_API_KEY`, la variable `USAR_IA=true` (Settings → Variables) y `GOOGLE_PLACES_API_KEY` para prospección automática.

> Nota: subir el archivo `.github/workflows/motor.yml` requiere que tu token/permiso de GitHub incluya **Workflows**. Si al subirlo GitHub lo rechaza, agrega el archivo tú desde la web (botón *Add file → Create new file*) pegando el contenido, o dame un token con permiso de Workflows y lo subo yo.
