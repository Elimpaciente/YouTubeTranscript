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
  
  // Endpoints disponibles
  if (url.pathname === '/' || url.pathname === '') {
    return new Response(getUsageHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS }
    });
  }

  if (!url.pathname.startsWith('/transcript') && !url.pathname.startsWith('/html')) {
    return errorResponse('Endpoint not found. Use /transcript or /html', 404)
  }

  const youtubeUrl = url.searchParams.get('url')
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return errorResponse('Invalid or missing YouTube URL', 400)
  }

  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    return errorResponse('Could not extract video ID from URL', 400);
  }

  try {
    // Modo HTML: Devuelve el HTML completo
    if (url.pathname.startsWith('/html')) {
      const html = await fetchYouTranscriptHTML(videoId);
      
      // Si se solicita modo raw, devolver HTML directo
      if (url.searchParams.get('raw') === 'true') {
        return new Response(html, {
          headers: { 
            'Content-Type': 'text/html; charset=utf-8',
            ...CORS 
          }
        });
      }
      
      // Modo JSON: devolver HTML como string en JSON
      return jsonResponse({ 
        status_code: 200, 
        ...METADATA, 
        video_id: videoId,
        html_content: html,
        html_length: html.length
      }, 200);
    }
    
    // Modo Transcript: Extrae y limpia la transcripción
    if (url.pathname.startsWith('/transcript')) {
      const transcript = await getYouTranscript(videoId);
      return jsonResponse({ 
        status_code: 200, 
        ...METADATA, 
        video_id: videoId,
        response: transcript,
        length: transcript.length
      }, 200, { 'Cache-Control': 'public, max-age=3600' });
    }

  } catch (error) {
    console.error('Error:', error.message);
    return errorResponse(`Error: ${error.message}`, 400)
  }
}

/**
 * Obtiene el HTML completo de la página de YouTranscripts
 */
async function fetchYouTranscriptHTML(videoId) {
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
    throw new Error(`Failed to fetch page: HTTP ${response.status}`);
  }

  return await response.text();
}

/**
 * Obtiene la transcripción limpia
 */
async function getYouTranscript(videoId) {
  const htmlText = await fetchYouTranscriptHTML(videoId);

  // Verificar si hay transcripción disponible
  if (htmlText.includes('No transcript found') || 
      htmlText.includes('Transcripción no disponible') ||
      htmlText.includes('no captions')) {
    throw new Error('This video does not have captions/transcripts available.');
  }

  // Método 1: Buscar usando marcadores de texto
  let transcript = extractByMarkers(htmlText);
  
  // Método 2 (fallback): Buscar usando patrones HTML
  if (!transcript) {
    transcript = extractByHTMLPattern(htmlText);
  }

  if (!transcript) {
    throw new Error('Could not extract transcript. Try using /html endpoint to inspect the page structure.');
  }

  return transcript;
}

/**
 * Extrae la transcripción usando marcadores de texto
 */
function extractByMarkers(html) {
  const startMarker = 'Descargar TranscripciónFormato: txt, docx, pdf, srt, csv';
  const endMarker = 'Volver Arriba';

  let startIndex = html.indexOf(startMarker);
  if (startIndex === -1) {
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
  
  if (rawTranscript.length < 20) {
    return null;
  }

  return cleanTranscript(rawTranscript);
}

/**
 * Extrae la transcripción buscando patrones HTML
 */
function extractByHTMLPattern(html) {
  const patterns = [
    /<div[^>]*class="[^"]*transcript[^"]*"[^>]*>(.*?)<\/div>/is,
    /<article[^>]*>(.*?)<\/article>/is,
    /<main[^>]*>(.*?)<\/main>/is
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanTranscript(match[1]);
      if (cleaned && cleaned.length > 100) {
        return cleaned;
      }
    }
  }

  return null;
}

/**
 * Limpia el texto extraído
 */
function cleanTranscript(text) {
  let cleaned = text
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[Música\]|\[Aplausos\]|\[Music\]|\[Applause\]|\[♪\]/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();

  if (cleaned.length < 50) {
    return null;
  }

  return cleaned;
}

/**
 * Página de uso/documentación
 */
function getUsageHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube Transcript API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6; 
      color: #333; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { 
      max-width: 900px; 
      margin: 0 auto; 
      background: white; 
      padding: 40px;
      border-radius: 15px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 { 
      color: #667eea; 
      margin-bottom: 10px;
      font-size: 2.5em;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 1.1em;
    }
    h2 { 
      color: #764ba2; 
      margin: 30px 0 15px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }
    .endpoint { 
      background: #f8f9fa; 
      padding: 15px;
      border-radius: 8px;
      margin: 15px 0;
      border-left: 4px solid #667eea;
    }
    .endpoint h3 {
      color: #764ba2;
      margin-bottom: 10px;
    }
    code { 
      background: #2d2d2d; 
      color: #f8f8f2;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
    }
    pre { 
      background: #2d2d2d; 
      color: #f8f8f2;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .example { 
      background: #e3f2fd;
      padding: 15px;
      border-radius: 8px;
      margin: 15px 0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #eee;
      text-align: center;
      color: #666;
    }
    .badge {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      margin: 5px 5px 5px 0;
    }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎬 YouTube Transcript API</h1>
    <p class="subtitle">Extrae transcripciones de videos de YouTube fácilmente</p>

    <h2>📋 Endpoints Disponibles</h2>

    <div class="endpoint">
      <h3>1. Obtener Transcripción Limpia</h3>
      <p><code>GET /transcript?url=YOUTUBE_URL</code></p>
      <p>Devuelve la transcripción procesada y limpia en formato JSON.</p>
      <div class="example">
        <strong>Ejemplo:</strong><br>
        <code>/transcript?url=https://youtu.be/JPFFoYAWkrQ</code>
      </div>
    </div>

    <div class="endpoint">
      <h3>2. Obtener HTML Completo (JSON)</h3>
      <p><code>GET /html?url=YOUTUBE_URL</code></p>
      <p>Devuelve el HTML completo de la página en formato JSON para análisis.</p>
      <div class="example">
        <strong>Ejemplo:</strong><br>
        <code>/html?url=https://youtu.be/JPFFoYAWkrQ</code>
      </div>
    </div>

    <div class="endpoint">
      <h3>3. Obtener HTML Raw</h3>
      <p><code>GET /html?url=YOUTUBE_URL&raw=true</code></p>
      <p>Devuelve el HTML completo directamente (sin JSON wrapper).</p>
      <div class="example">
        <strong>Ejemplo:</strong><br>
        <code>/html?url=https://youtu.be/JPFFoYAWkrQ&raw=true</code>
      </div>
    </div>

    <h2>🎯 Formatos de URL Soportados</h2>
    <div class="example">
      <span class="badge">✓ youtu.be</span>
      <span class="badge">✓ youtube.com/watch</span>
      <br><br>
      <code>https://youtu.be/JPFFoYAWkrQ</code><br>
      <code>https://www.youtube.com/watch?v=JPFFoYAWkrQ</code>
    </div>

    <h2>📝 Ejemplo de Respuesta</h2>
    <pre>{
  "status_code": 200,
  "developer": "El Impaciente",
  "video_id": "JPFFoYAWkrQ",
  "response": "Transcripción del video...",
  "length": 1234
}</pre>

    <h2>⚠️ Códigos de Error</h2>
    <div class="example">
      <strong>400:</strong> URL inválida o video sin transcripción<br>
      <strong>404:</strong> Endpoint no encontrado<br>
      <strong>500:</strong> Error interno del servidor
    </div>

    <div class="footer">
      <p><strong>Desarrollado por:</strong> ${METADATA.developer}</p>
      <p><strong>Créditos:</strong> ${METADATA.credits}</p>
      <p>
        <a href="${METADATA.telegram_channels.el_impaciente}" target="_blank">📱 Canal Telegram</a> | 
        <a href="${METADATA.telegram_channels.ashlynn_repository}" target="_blank">📦 Repository</a>
      </p>
    </div>
  </div>
</body>
</html>`;
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
