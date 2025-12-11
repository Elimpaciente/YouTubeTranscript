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
 * Extrae el ID del video de una URL de YouTube
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
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url)
  
  if (!url.pathname.startsWith('/transcript')) {
    return errorResponse('Endpoint not found. Use /transcript?url=YOUTUBE_URL', 404)
  }

  const youtubeUrl = url.searchParams.get('url')
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return errorResponse('Invalid or missing YouTube URL', 400)
  }

  try {
    const transcript = await getYouTranscript(youtubeUrl) 
    return jsonResponse({ 
      status_code: 200, 
      ...METADATA, 
      video_id: extractVideoId(youtubeUrl),
      response: transcript 
    }, 200, { 'Cache-Control': 'public, max-age=3600' })
  } catch (error) {
    console.error('Transcription error:', error.message);
    return errorResponse(`Transcription unavailable: ${error.message}`, 400)
  }
}

/**
 * Obtiene la transcripción mediante web scraping de YouTranscripts
 */
async function getYouTranscript(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);

  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }

  const transcriptPageUrl = `https://www.youtranscripts.com/es/transcript/${videoId}/`;

  const response = await fetch(transcriptPageUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Referer': 'https://www.youtranscripts.com/',
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Video transcript not found. The video may not have captions available.');
    }
    throw new Error(`Failed to fetch transcript page: HTTP ${response.status}`);
  }

  const htmlText = await response.text();

  // Verificar si la página indica que no hay transcripción disponible
  if (htmlText.includes('No transcript found') || 
      htmlText.includes('Transcripción no disponible') ||
      htmlText.includes('no captions')) {
    throw new Error('This video does not have captions/transcripts available.');
  }

  // Método 1: Buscar usando marcadores de texto (más confiable)
  let transcript = extractByMarkers(htmlText);
  
  // Método 2 (fallback): Buscar usando patrones HTML
  if (!transcript) {
    transcript = extractByHTMLPattern(htmlText);
  }

  if (!transcript) {
    throw new Error('Could not extract transcript from page. The page structure may have changed.');
  }

  return transcript;
}

/**
 * Extrae la transcripción usando marcadores de texto
 */
function extractByMarkers(html) {
  // Marcadores exactos según el HTML de YouTranscripts
  const startMarker = 'Descargar TranscripciónFormato: txt, docx, pdf, srt, csv';
  const endMarker = 'Volver Arriba';

  let startIndex = html.indexOf(startMarker);
  if (startIndex === -1) {
    // Intentar con variaciones del marcador
    const altStartMarkers = [
      'Descargar Transcripción',
      'Download Transcript',
      'Formato: txt, docx, pdf'
    ];
    
    for (const marker of altStartMarkers) {
      startIndex = html.indexOf(marker);
      if (startIndex !== -1) {
        startIndex += marker.length;
        break;
      }
    }
    
    if (startIndex === -1) {
      return null;
    }
  } else {
    startIndex += startMarker.length;
  }

  const endIndex = html.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    return null;
  }

  let rawTranscript = html.substring(startIndex, endIndex);
  
  // Validar que el contenido extraído tiene sentido
  if (rawTranscript.length < 20 || !rawTranscript.includes('<')) {
    return null;
  }

  return cleanTranscript(rawTranscript);
}

/**
 * Extrae la transcripción buscando patrones HTML comunes
 */
function extractByHTMLPattern(html) {
  // Buscar divs o elementos que contengan la transcripción
  const patterns = [
    /<div[^>]*class="[^"]*transcript[^"]*"[^>]*>(.*?)<\/div>/is,
    /<div[^>]*id="[^"]*transcript[^"]*"[^>]*>(.*?)<\/div>/is,
    /<article[^>]*>(.*?)<\/article>/is,
    /<main[^>]*>(.*?)<\/main>/is
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanTranscript(match[1]);
      if (cleaned.length > 100) { // Verificar que tenga contenido significativo
        return cleaned;
      }
    }
  }

  return null;
}

/**
 * Limpia el texto extraído de etiquetas HTML y caracteres no deseados
 */
function cleanTranscript(text) {
  let cleaned = text
    // Eliminar scripts y estilos completos
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    // Eliminar comentarios HTML
    .replace(/<!--.*?-->/gs, '')
    // Convertir <br>, <br/>, <br /> en saltos de línea
    .replace(/<br\s*\/?>/gi, '\n')
    // Convertir </p> en salto de línea para mantener párrafos
    .replace(/<\/p>/gi, '\n')
    // Eliminar todas las demás etiquetas HTML
    .replace(/<[^>]*>/g, ' ')
    // Eliminar marcadores de música/aplausos en múltiples idiomas
    .replace(/\[Música\]|\[Aplausos\]|\[Music\]|\[Applause\]|\[♪\]|\[música\]/gi, '')
    // Decodificar entidades HTML comunes
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    // Eliminar múltiples saltos de línea consecutivos (máximo 2)
    .replace(/\n{3,}/g, '\n\n')
    // Reemplazar múltiples espacios con uno solo
    .replace(/ {2,}/g, ' ')
    // Eliminar espacios al inicio y final de cada línea
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    // Eliminar espacios al inicio y final del texto completo
    .trim();

  // Validación final: asegurar que tengamos contenido significativo
  if (cleaned.length < 50) {
    return null;
  }

  return cleaned;
}

function errorResponse(message, status) {
  return jsonResponse({ 
    status_code: status, 
    ...METADATA, 
    error: message 
  }, status)
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 
      'Content-Type': 'application/json; charset=utf-8', 
      ...CORS, 
      ...extraHeaders 
    }
  })
}
