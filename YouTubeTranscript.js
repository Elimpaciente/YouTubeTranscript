addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

/**
 * Extrae el ID del video de una URL de YouTube.
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
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const url = new URL(request.url);
  
  // Validar el endpoint
  if (!url.pathname.startsWith('/transcript')) {
    return new Response('Endpoint not found. Use /transcript?url=...', { status: 404 });
  }

  const youtubeUrl = url.searchParams.get('url');
  
  // Validar la URL de YouTube
  if (!youtubeUrl || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return new Response('Invalid or missing YouTube URL parameter.', { status: 400 });
  }

  try {
    const transcript = await getTranscriptFromAPI(youtubeUrl);
    
    // Devolver la transcripción en texto plano con encabezados CORS
    return new Response(transcript, { 
      status: 200, 
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      } 
    });
  } catch (error) {
    console.error(error);
    return new Response(`Transcription unavailable: ${error.message}`, { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
}

/**
 * Llama a la API de ingeniería inversa para obtener la transcripción.
 */
async function getTranscriptFromAPI(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);

  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }

  // Endpoint de la API de ingeniería inversa
  const apiURL = "https://yt-to-text.com/api/v1/Subtitles";

  const response = await fetch(apiURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Se recomienda incluir un User-Agent para evitar ser bloqueado
      "User-Agent": "Mozilla/5.0 (compatible; Cloudflare Worker)"
    },
    body: JSON.stringify({ video_id: videoId }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`API request failed with status: ${response.status}`);
  }

  const data = await response.json();

  // Lógica de extracción: Acceder al array de transcripciones y concatenar el campo 't'
  if (!data.data || !data.data.transcripts || data.data.transcripts.length === 0) {
    throw new Error('No transcript available from the API.');
  }

  // Convertir el array de objetos de transcripción a texto plano
  const transcriptText = data.data.transcripts.map(item => item.t).join(' ');

  return transcriptText;
}
