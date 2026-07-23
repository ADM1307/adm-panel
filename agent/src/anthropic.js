// =====================================================================
//  ADM · Cliente mínimo de la API de Anthropic (Claude) con fetch nativo.
//  Sin SDK: menos dependencias, más fácil de auto-hospedar.
//  Modelos por rol (configurables por env):
//    MODELO_RAPIDO  → calificar/clasificar (Haiku)
//    MODELO_REDACTOR→ redactar/responder   (Sonnet)
// =====================================================================
const API_URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export const MODELOS = {
  rapido: process.env.MODELO_RAPIDO ?? 'claude-haiku-4-5',
  redactor: process.env.MODELO_REDACTOR ?? 'claude-sonnet-4-5',
};

/**
 * Llama a Claude y devuelve el texto de la respuesta.
 * @param {object} o { system, prompt, modelo, maxTokens, temperature }
 */
export async function claude({ system, prompt, modelo = MODELOS.rapido, maxTokens = 1024, temperature = 0.4 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY en el entorno.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.content?.map((b) => b.text).join('') ?? '';
}

/** Igual que claude() pero exige y parsea una respuesta JSON. */
export async function claudeJSON(opts) {
  const texto = await claude(opts);
  // Extrae el primer bloque {...} por si el modelo agrega texto alrededor.
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Respuesta sin JSON: ${texto.slice(0, 200)}`);
  return JSON.parse(match[0]);
}
