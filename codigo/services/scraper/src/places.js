// =====================================================================
//  ADM · Scraper · cliente de Google Places API (New) — Text Search
//  Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
//  Usa fetch nativo de Node 20+. Sin dependencias externas.
// =====================================================================

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Campos que pedimos (FieldMask). Menos campos = menor costo por request.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'nextPageToken',
].join(',');

/**
 * Busca negocios por texto ("dentista en Chihuahua") con paginación.
 * @param {string} query  texto de búsqueda (giro + ciudad)
 * @param {object} opts   { apiKey, maxPaginas=2, languageCode='es', regionCode='MX' }
 * @returns {Promise<Array>} lista cruda de places
 */
export async function buscarNegocios(query, opts = {}) {
  const {
    apiKey = process.env.GOOGLE_PLACES_API_KEY,
    maxPaginas = 2,
    languageCode = 'es',
    regionCode = 'MX',
  } = opts;

  if (!apiKey) throw new Error('Falta GOOGLE_PLACES_API_KEY en el entorno.');

  const resultados = [];
  let pageToken = null;

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const body = { textQuery: query, languageCode, regionCode, pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detalle = await res.text();
      throw new Error(`Google Places ${res.status}: ${detalle}`);
    }

    const data = await res.json();
    resultados.push(...(data.places ?? []));

    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
    // El token tarda ~2s en activarse.
    await new Promise((r) => setTimeout(r, 2000));
  }

  return resultados;
}

/**
 * Normaliza un "place" de Google al shape de la tabla leads.
 * Aquí calculamos señales baratas (tiene_web, etc.). El scoring fino
 * lo hace el agent-core con Claude Haiku.
 */
export function normalizarPlace(place, { ciudad, verticalId = null, giroBusqueda = null }) {
  const sitio = place.websiteUri ?? null;
  const tieneWeb = Boolean(sitio);
  const numResenas = place.userRatingCount ?? 0;

  return {
    empresa: place.displayName?.text ?? 'Sin nombre',
    giro: place.primaryTypeDisplayName?.text ?? giroBusqueda ?? null,
    vertical_id: verticalId,
    ciudad,
    estado: 'Chihuahua',
    sitio_web: sitio,
    telefono: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    email_general: null, // Google no lo entrega; se enriquece después.
    google_place_id: place.id,
    google_maps_url: place.googleMapsUri ?? null,
    rating_google: place.rating ?? null,
    num_resenas: numResenas,
    tiene_web: tieneWeb,
    web_responsiva: null, // se evalúa en un paso de enriquecimiento posterior
    corre_anuncios: null,
    redes: {},
    sucursales: 1,
    // Hallazgo preliminar (el agente puede reescribirlo mejor):
    hallazgo_clave: !tieneWeb
      ? 'No aparece con sitio web en su ficha de Google'
      : numResenas < 15
        ? `Solo ${numResenas} reseñas en Google, con poca señal de captación`
        : null,
    fuente: 'google_places',
    _businessStatus: place.businessStatus ?? null, // uso interno para filtrar cerrados
  };
}
