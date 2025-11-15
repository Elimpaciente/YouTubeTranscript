/**
 * SOLUCIÓN DEFINITIVA 2025 - Usando Innertube API con Android client
 * Basado en el método más actual que funciona
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const videoUrl = url.searchParams.get('url');
    const videoId = url.searchParams.get('video_id');
    const lang = url.searchParams.get('lang') || 'es';

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const vid = videoId || extractVideoId(videoUrl);
      
      if (!vid) {
        return jsonError('URL o video_id requerido', 400, corsHeaders);
      }

      const transcript = await getYoutubeTranscript(vid, lang);

      return new Response(JSON.stringify({
        status_code: 200,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        response: transcript
      }), { status: 200, headers: corsHeaders });

    } catch (error) {
      console.error('Error:', error);
      return jsonError(error.message || 'No captions available for this video', 400, corsHeaders);
    }
  }
};

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({
    status_code: status,
    message: message,
    developer: 'El Impaciente',
    telegram_channel: 'https://t.me/Apisimpacientes'
  }), { status, headers });
}

function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// PASO 1: Obtener el API Key de Innertube desde el HTML
async function getInnertubeApiKey(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch video page');
  }

  const html = await response.text();
  
  // Buscar INNERTUBE_API_KEY
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!apiKeyMatch) {
    throw new Error('Could not extract API key');
  }

  return apiKeyMatch[1];
}

// PASO 2: Usar Innertube Player API con contexto Android
async function getPlayerResponse(videoId, apiKey) {
  const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
  
  const body = {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.09.37',
        androidSdkVersion: 30,
        hl: 'en',
        gl: 'US',
      }
    },
    videoId: videoId
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '19.09.37'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error('Failed to get player response');
  }

  return await response.json();
}

// PASO 3: Extraer caption tracks del player response
function getCaptionTracks(playerResponse) {
  const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!captions || captions.length === 0) {
    throw new Error('No captions available for this video');
  }

  return captions;
}

// PASO 4: Seleccionar el track apropiado
function selectCaptionTrack(captionTracks, lang) {
  // Intentar encontrar el idioma exacto
  let track = captionTracks.find(t => t.languageCode === lang);
  
  // Si no, buscar uno que empiece con el código de idioma
  if (!track) {
    track = captionTracks.find(t => t.languageCode?.startsWith(lang.split('-')[0]));
  }
  
  // Si aún no, tomar el primero disponible
  if (!track) {
    track = captionTracks[0];
  }

  return track;
}

// PASO 5: Descargar y parsear el XML de subtítulos
async function downloadAndParseTranscript(baseUrl) {
  const response = await fetch(baseUrl);
  
  if (!response.ok) {
    throw new Error('Failed to download transcript');
  }

  const xml = await response.text();
  return parseTranscriptXML(xml);
}

// PASO 6: Parsear el XML
function parseTranscriptXML(xml) {
  const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
  const captions = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    let text = match[3];
    
    // Decodificar entidades HTML
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text) {
      captions.push(text);
    }
  }

  if (captions.length === 0) {
    throw new Error('No text found in transcript');
  }

  return captions.join(' ');
}

// FUNCIÓN PRINCIPAL
async function getYoutubeTranscript(videoId, lang = 'es') {
  try {
    // 1. Obtener API key
    const apiKey = await getInnertubeApiKey(videoId);
    
    // 2. Obtener player response con contexto Android
    const playerResponse = await getPlayerResponse(videoId, apiKey);
    
    // 3. Extraer caption tracks
    const captionTracks = getCaptionTracks(playerResponse);
    
    // 4. Seleccionar el track apropiado
    const selectedTrack = selectCaptionTrack(captionTracks, lang);
    
    // 5. Descargar y parsear
    const transcript = await downloadAndParseTranscript(selectedTrack.baseUrl);
    
    return transcript;
    
  } catch (error) {
    // Si el método Android falla, intentar método alternativo
    try {
      return await getTranscriptFallback(videoId, lang);
    } catch (fallbackError) {
      throw new Error(error.message);
    }
  }
}

// MÉTODO DE RESPALDO (usando el método anterior mejorado)
async function getTranscriptFallback(videoId, lang) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': `${lang},en;q=0.9`,
    }
  });

  const html = await response.text();
  
  // Buscar raw_player_response (método actualizado 2025)
  const match = html.match(/"captions":\s*\{[^}]*"playerCaptionsTracklistRenderer":\s*\{[^}]*"captionTracks":\s*(\[[^\]]+\])/);
  
  if (!match) {
    throw new Error('No captions found in fallback method');
  }

  const captionTracks = JSON.parse(match[1]);
  const selectedTrack = selectCaptionTrack(captionTracks, lang);
  
  return await downloadAndParseTranscript(selectedTrack.baseUrl);
}
