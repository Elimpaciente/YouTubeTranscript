addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const METADATA = {
  developer: 'El Impaciente',
  credits: 'Ashlynn Repository',
  telegram_channels: {
    el_impaciente: 'https://t.me/Apisimpacientes',
    ashlynn_repository: 'https://t.me/Ashlynn_Repository'
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

/**
 * Extrae el ID del video de una URL de YouTube.
 * Soporta formatos como:
 * - https://youtu.be/JPFFoYAWkrQ
 * - https://www.youtube.com/watch?v=JPFFoYAWkrQ
 */
function extractVideoId(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtu.be')) {
      return urlObj.pathname.substring(1);
    }
    if (urlObj.hostname.includes('youtube.com')) {
      return urlObj.searchParams.get('v');
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function handleRequest(request) {
  // Manejar solicitudes OPTIONS para CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url)
  if (!url.pathname.startsWith('/transcript')) {
    return errorResponse('Endpoint not found. Use /transcript', 404)
  }

  const youtubeUrl = url.searchParams.get('url')
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return errorResponse('Invalid or missing YouTube URL', 400)
  }

  try {
    // **MODIFICACIÓN CLAVE:** Usando la función de Web Scraping para TubeTranscript.com
    const transcript = await getTubeTranscript(youtubeUrl) 
    return jsonResponse({ status_code: 200, ...METADATA, response: transcript }, 200, { 'Cache-Control': 'public, max-age=3600' })
  } catch (error) {
    console.error(error.message);
    return errorResponse(`Transcription unavailable: ${error.message}`, 400)
  }
}

/**
 * Obtiene la transcripción analizando el HTML de la página de resultados de TubeTranscript.com.
 * Este método es el resultado de la ingeniería inversa.
 * @param {string} youtubeUrl - La URL completa del video de YouTube.
 * @returns {Promise<string>} La transcripción en texto plano.
 */
async function getTubeTranscript(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);

  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }

  // 1. URL de la página de resultados (donde el texto está incrustado)
  const transcriptPageUrl = `https://www.tubetranscript.com/en/watch?v=${videoId}`;

  const response = await fetch(transcriptPageUrl, {
    method: 'GET',
    headers: {
      // Simular un agente de usuario para evitar bloqueos
      'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare Worker)', 
      'Accept': 'text/html'
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch transcript page: ${response.status}`);
  }

  const htmlText = await response.text();

  // 2. Análisis de la cadena HTML para encontrar el texto de la transcripción.
  // Buscamos el texto que está entre los marcadores de los botones de descarga.
  const startMarker = 'Copy with timestamps';
  const endMarker = 'Copy'; 

  let startIndex = htmlText.indexOf(startMarker);
  if (startIndex === -1) {
      throw new Error('Could not find transcript start marker in HTML.');
  }
  
  // Ajustar el inicio para saltar el marcador
  startIndex += startMarker.length;

  const endIndex = htmlText.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
      throw new Error('Could not find transcript end marker in HTML.');
  }

  let rawTranscript = htmlText.substring(startIndex, endIndex);

  // 3. Limpieza del texto: eliminar etiquetas HTML, saltos de línea excesivos y marcadores.
  rawTranscript = rawTranscript
    .replace(/<[^>]*>/g, '') // Eliminar todas las etiquetas HTML
    .replace(/\[Música\]|\[Aplausos\]|\[Música\]/g, '') // Eliminar marcadores de música/aplausos
    .replace(/\s+/g, ' ') // Reemplazar múltiples espacios con uno solo
    .trim();

  if (rawTranscript.length < 50) {
      throw new Error('Transcript content is too short or empty after parsing. Check video availability.');
  }

  return rawTranscript;
}

function errorResponse(message, status) {
  return jsonResponse({ status_code: status, ...METADATA, message }, status)
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders }
  })
}
