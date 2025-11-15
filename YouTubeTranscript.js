/**
 * SOLUCIÓN DEFINITIVA - Basado en youtube-transcript de Kakulukian
 * Código adaptado específicamente para Cloudflare Workers
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

      const transcript = await fetchTranscript(vid, lang);

      return new Response(JSON.stringify({
        status_code: 200,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        response: transcript
      }), { status: 200, headers: corsHeaders });

    } catch (error) {
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

// Constantes
const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

function extractVideoId(url) {
  if (!url) return null;
  
  const match = url.match(RE_YOUTUBE);
  return match ? match[1] : url.match(/^[a-zA-Z0-9_-]{11}$/) ? url : null;
}

async function fetchTranscript(videoId, lang) {
  // Paso 1: Obtener la página del video
  const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'Accept-Language': lang,
      'User-Agent': USER_AGENT,
    },
  });

  if (!videoPageResponse.ok) {
    throw new Error('Failed to fetch video page');
  }

  const videoPageBody = await videoPageResponse.text();

  // Paso 2: Extraer información de captions
  const splittedHTML = videoPageBody.split('"captions":');

  if (splittedHTML.length <= 1) {
    if (videoPageBody.includes('class="g-recaptcha"')) {
      throw new Error('Too many requests - CAPTCHA required');
    }
    if (!videoPageBody.includes('"playabilityStatus":')) {
      throw new Error('Video unavailable');
    }
    throw new Error('Transcripts disabled for this video');
  }

  // Paso 3: Parsear JSON de captions
  let captions;
  try {
    const captionsJSON = splittedHTML[1].split(',"videoDetails')[0].replace(/\n/g, '');
    captions = JSON.parse(captionsJSON)?.playerCaptionsTracklistRenderer;
  } catch (e) {
    throw new Error('Failed to parse captions data');
  }

  if (!captions) {
    throw new Error('Captions not found');
  }

  if (!captions.captionTracks || captions.captionTracks.length === 0) {
    throw new Error('No captions available for this video');
  }

  // Paso 4: Seleccionar el track de idioma correcto
  let selectedTrack = captions.captionTracks.find(track => track.languageCode === lang);
  
  // Si no hay en el idioma solicitado, buscar español o el primero disponible
  if (!selectedTrack) {
    selectedTrack = captions.captionTracks.find(track => track.languageCode?.startsWith('es')) 
                 || captions.captionTracks[0];
  }

  if (!selectedTrack || !selectedTrack.baseUrl) {
    throw new Error('No suitable caption track found');
  }

  // Paso 5: Obtener el transcript XML
  const transcriptURL = selectedTrack.baseUrl;
  const transcriptResponse = await fetch(transcriptURL, {
    headers: {
      'Accept-Language': lang,
      'User-Agent': USER_AGENT,
    },
  });

  if (!transcriptResponse.ok) {
    throw new Error('Failed to fetch transcript');
  }

  const transcriptBody = await transcriptResponse.text();

  // Paso 6: Parsear el XML y extraer texto
  const results = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT)];
  
  if (results.length === 0) {
    throw new Error('No transcript text found');
  }

  // Convertir a texto limpio
  const fullText = results.map(result => {
    let text = result[3];
    
    // Decodificar entidades HTML
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n/g, ' ')
      .trim();
    
    return text;
  }).filter(Boolean).join(' ');

  return fullText;
}
