# Desplegar el Panel de Control en tu VPS (Caddy + Docker)

Alternativa real a Vercel/Netlify: el panel vive en **tu propio servidor**, junto al resto del Motor de Ventas, con **HTTPS automático** (Let's Encrypt) y opción de **contraseña**. Es la forma recomendada porque el panel maneja datos de prospectos y tu lista `do_not_contact` (LFPDPPP): no debe quedar en una URL pública abierta.

## Requisitos
- Un VPS (Hetzner, Contabo, DigitalOcean…) con **Docker** y **docker compose**.
- Puertos **80** y **443** abiertos.
- Para HTTPS con dominio: un registro **A** apuntando a la IP del VPS (ej. `panel.atlasdigitalmark.com → 203.0.113.10`).

## Pasos (5 minutos)

```bash
# En tu VPS, dentro de la carpeta del proyecto:
cd deploy
cp .env.example .env
nano .env                 # pon tu PANEL_DOMAIN

./deploy.sh               # valida la config, copia el panel y levanta Caddy
```

Al terminar tendrás:
- **https://tu-dominio** — con certificado automático (si el DNS ya apunta al VPS).
- **http://IP-DE-TU-VPS:8080** — acceso inmediato para probar sin dominio.

## Ponerle contraseña (recomendado en producción)

```bash
# 1) Genera el hash de tu contraseña:
docker run --rm caddy:2.8 caddy hash-password --plaintext 'TU_PASSWORD'

# 2) Pega el hash en .env  ->  PANEL_PASSWORD_HASH=...
# 3) Descomenta el bloque basic_auth en el Caddyfile.
# 4) Reinicia:
docker compose up -d
```

## Apuntar un subdominio bonito
En tu proveedor de DNS crea un registro **A**:
```
Tipo: A   Nombre: panel   Valor: <IP-de-tu-VPS>   TTL: auto
```
Así el panel queda en `https://panel.atlasdigitalmark.com`.

## Integrarlo con el resto del sistema (opcional)
Puedes correr este `docker compose` aparte, o fusionar el servicio `panel` en el
`docker-compose.yml` de la raíz (donde ya están Postgres y n8n) para levantar todo junto.
Cuando el panel evolucione a la app **Next.js** (Módulo 7 del BUILD_PLAN), Caddy puede
hacerle *reverse proxy* en vez de servir el HTML estático:

```
panel.atlasdigitalmark.com {
    reverse_proxy dashboard:3000
}
```

## Comandos útiles
```bash
docker compose logs -f panel     # ver logs
docker compose restart panel     # reiniciar
docker compose down              # bajar
```

## ¿No usas Docker? (alternativa con Caddy nativo o nginx)
- **Caddy nativo:** instala Caddy, copia `site/index.html` a `/var/www/adm-panel/` y usa el
  mismo `Caddyfile` (cambia `root * /srv` por tu ruta). Arranca con `caddy run`.
- **nginx:** sirve `site/` como estático y pon HTTPS con Certbot. Basic auth con `htpasswd`.
