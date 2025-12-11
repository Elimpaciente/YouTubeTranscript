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
  const urlObj = new URL(url);
  if (urlObj.hostname.includes('youtu.be')) {
    return urlObj.pathname.substring(1);
  }
  if (urlObj.hostname.includes('youtube.com')) {
    return urlObj.searchParams.get('v');
  }
  return null;
}

async function handleRequest(request) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/transcript')) {
    return errorResponse('Endpoint not found. Use /transcript', 404)
  }

  const youtubeUrl = url.searchParams.get('url')
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return errorResponse('Invalid or missing YouTube URL', 400)
  }

  try {
    // **MODIFICACIÓN CLAVE:** Usar la nueva función de YouTranscripts
    const transcript = await getYouTranscript(youtubeUrl) 
    return jsonResponse({ status_code: 200, ...METADATA, response: transcript }, 200, { 'Cache-Control': 'public, max-age=3600' })
  } catch (error) {
    console.error(error.message);
    return errorResponse(`Transcription unavailable: ${error.message}`, 400)
  }
}

/**
 * Obtiene la transcripción en texto plano usando el endpoint de descarga de YouTranscripts.
 * @param {string} youtubeUrl - La URL completa del video de YouTube.
 * @returns {Promise<string>} La transcripción en texto plano.
 */
async function getYouTranscript(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);

  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }

  // Construir la URL de descarga de YouTranscripts para el formato TXT
  const downloadUrl = `https://www.youtranscripts.com/download/${videoId}/txt`;

  const response = await fetch(downloadUrl, {
    method: 'GET', // Es una solicitud GET
    headers: {
      // Headers mínimos para simular una solicitud de navegador
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/plain'
    },
    signal: AbortSignal.timeout(30000)
  })

  if (!response.ok) {
    throw new Error(`Download request failed: ${response.status}`);
  }

  // La respuesta es el texto plano de la transcripción
  const transcriptText = await response.text();

  // YouTranscripts devuelve un archivo de texto. Si el archivo está vacío o es muy corto,
  // podría indicar un error o que no hay transcripción disponible.
  if (transcriptText.length < 50) {
      throw new Error('Transcript content is too short or empty. Check video availability.');
  }

  return transcriptText;
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
