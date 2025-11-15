// SOLUCIÓN DEFINITIVA usando youtube-caption-extractor
// Este paquete está diseñado específicamente para Cloudflare Workers

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const videoUrl = url.searchParams.get('url');
    const videoId = url.searchParams.get('video_id');

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
      let vid = videoId || extractVideoId(videoUrl);
      
      if (!vid) {
        return new Response(JSON.stringify({
          status_code: 400,
          message: 'URL o video_id requerido',
          developer: 'El Impaciente',
          telegram_channel: 'https://t.me/Apisimpacientes'
        }), { status: 400, headers: corsHeaders });
      }

      // Usar youtube-caption-extractor
      const transcript = await getYouTubeTranscript(vid);

      return new Response(JSON.stringify({
        status_code: 200,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        response: transcript
      }), { status: 200, headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({
        status_code: 400,
        message: error.message || 'No captions available for this video',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }), { status: 400, headers: corsHeaders });
    }
  }
};

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

// Función principal para obtener transcript
async function getYouTubeTranscript(videoID, lang = 'es') {
  try {
    // Intentar primero en español, luego inglés
    const languages = ['es', 'en', 'auto'];
    
    for (const currentLang of languages) {
      try {
        const captions = await fetchCaptions(videoID, currentLang);
        if (captions && captions.length > 0) {
          return captions.map(c => c.text).join(' ');
        }
      } catch (err) {
        continue; // Intentar siguiente idioma
      }
    }
    
    throw new Error('No captions available for this video');
  } catch (error) {
    throw error;
  }
}

// Función para obtener los subtítulos desde YouTube
async function fetchCaptions(videoID, lang) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoID}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch video page');
  }

  const html = await response.text();

  // Extraer captionTracks del HTML
  let captionTracks;
  
  // Método 1: Buscar en ytInitialPlayerResponse
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
  if (playerMatch) {
    try {
      const playerResponse = JSON.parse(playerMatch[1]);
      captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    } catch (e) {}
  }

  // Método 2: Buscar directamente captionTracks
  if (!captionTracks) {
    const captionMatch = html.match(/"captionTracks":\s*(\[.+?\])/);
    if (captionMatch) {
      try {
        captionTracks = JSON.parse(captionMatch[1]);
      } catch (e) {}
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks found');
  }

  // Buscar el idioma solicitado
  let track;
  if (lang === 'auto') {
    track = captionTracks[0]; // Tomar el primero disponible
  } else {
    track = captionTracks.find(t => t.languageCode === lang || t.languageCode?.startsWith(lang));
    if (!track) track = captionTracks[0]; // Fallback al primero
  }

  if (!track || !track.baseUrl) {
    throw new Error('No suitable caption track found');
  }

  // Obtener el XML de los subtítulos
  const captionsResponse = await fetch(track.baseUrl);
  if (!captionsResponse.ok) {
    throw new Error('Failed to fetch captions');
  }

  const xml = await captionsResponse.text();
  return parseXML(xml);
}

// Parser del XML de subtítulos
function parseXML(xml) {
  const textRegex = /<text[^>]*start="([^"]*)"[^>]*dur="([^"]*)"[^>]*>(.*?)<\/text>/gs;
  const captions = [];
  let match;

  while ((match = textRegex.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    const dur = parseFloat(match[2]);
    let text = match[3];
    
    // Decodificar entidades HTML
    text = decodeHTMLEntities(text);
    
    // Limpiar texto
    text = text
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text) {
      captions.push({
        start,
        dur,
        text
      });
    }
  }

  return captions;
}

// Decodificar entidades HTML
function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&#x27;': "'",
    '&#x2F;': '/'
  };
  
  return text.replace(/&[#\w]+;/g, match => entities[match] || match);
}
