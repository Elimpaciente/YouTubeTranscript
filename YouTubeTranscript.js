// SOLUCIÓN DEFINITIVA: YouTube Transcript API para Cloudflare Workers
// Basado en ingeniería inversa de APIs funcionales + mejores prácticas

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
        return jsonResponse({
          status_code: 400,
          message: 'URL o video_id requerido',
          developer: 'El Impaciente',
          telegram_channel: 'https://t.me/Apisimpacientes'
        }, 400, corsHeaders);
      }

      // Sistema de múltiples métodos con fallback
      const transcript = await getTranscriptMultiMethod(vid);

      return jsonResponse({
        status_code: 200,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        response: transcript
      }, 200, corsHeaders);

    } catch (error) {
      return jsonResponse({
        status_code: 400,
        message: error.message || 'No captions available for this video',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400, corsHeaders);
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

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

// MÉTODO PRINCIPAL: Probar múltiples estrategias hasta que una funcione
async function getTranscriptMultiMethod(videoId) {
  const methods = [
    () => fetchViaYTInitialData(videoId),
    () => fetchViaInnerTube(videoId),
    () => fetchViaPlayerResponse(videoId),
    () => fetchViaWatchPage(videoId)
  ];

  let errors = [];

  for (const method of methods) {
    try {
      const result = await method();
      if (result && result.length > 0) {
        return result;
      }
    } catch (error) {
      errors.push(error.message);
      continue; // Intentar siguiente método
    }
  }

  throw new Error('No captions available for this video');
}

// MÉTODO 1: Extraer desde ytInitialData (más directo)
async function fetchViaYTInitialData(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://www.youtube.com/'
    }
  });

  if (!response.ok) throw new Error('Failed to fetch video page');

  const html = await response.text();

  // Buscar ytInitialPlayerResponse
  let playerResponse;
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
  if (playerMatch) {
    playerResponse = JSON.parse(playerMatch[1]);
  } else {
    const altMatch = html.match(/"responseContext":\{[^}]+\},"captions":\{[^}]+captionTracks":\[([^\]]+)\]/);
    if (altMatch) {
      playerResponse = JSON.parse(`{"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[${altMatch[1]}]}}}`);
    }
  }

  if (!playerResponse) throw new Error('No player response found');

  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No captions in player response');
  }

  // Priorizar español
  let track = captionTracks.find(t => t.languageCode?.startsWith('es'));
  if (!track) track = captionTracks[0];

  return await fetchAndParseTranscript(track.baseUrl);
}

// MÉTODO 2: YouTube InnerTube API (API oficial interna)
async function fetchViaInnerTube(videoId) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20231219.04.00'
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20231219.04.00',
          hl: 'es'
        }
      },
      params: btoa(`\n\x0b${videoId}`)
    })
  });

  if (!response.ok) throw new Error('InnerTube API failed');

  const data = await response.json();
  const segments = data?.actions?.[0]?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
    ?.transcriptSegmentListRenderer?.initialSegments;

  if (!segments) throw new Error('No transcript in InnerTube response');

  const texts = segments.map(s => 
    s.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text || ''
  ).filter(Boolean);

  if (texts.length === 0) throw new Error('Empty transcript');

  return texts.join(' ');
}

// MÉTODO 3: Usando get_video_info
async function fetchViaPlayerResponse(videoId) {
  const response = await fetch(`https://www.youtube.com/get_video_info?video_id=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const text = await response.text();
  const params = new URLSearchParams(text);
  const playerResponse = JSON.parse(params.get('player_response') || '{}');

  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No captions via get_video_info');
  }

  let track = captionTracks.find(t => t.languageCode?.startsWith('es')) || captionTracks[0];
  
  return await fetchAndParseTranscript(track.baseUrl);
}

// MÉTODO 4: Página watch alternativa
async function fetchViaWatchPage(videoId) {
  const response = await fetch(`https://m.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      'Accept-Language': 'es'
    }
  });

  const html = await response.text();
  
  const match = html.match(/"captionTracks":\s*(\[.+?\])/);
  if (!match) throw new Error('No captions in mobile page');

  const tracks = JSON.parse(match[1]);
  let track = tracks.find(t => t.languageCode?.startsWith('es')) || tracks[0];

  return await fetchAndParseTranscript(track.baseUrl);
}

// Obtener y parsear la transcripción XML
async function fetchAndParseTranscript(baseUrl) {
  const response = await fetch(baseUrl);
  if (!response.ok) throw new Error('Failed to fetch transcript');

  const xml = await response.text();
  return parseXML(xml);
}

function parseXML(xml) {
  const textRegex = /<text[^>]*>(.*?)<\/text>/gs;
  const texts = [];
  let match;

  while ((match = textRegex.exec(xml)) !== null) {
    let text = match[1];
    
    // Decodificar entidades HTML
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text) texts.push(text);
  }

  if (texts.length === 0) throw new Error('No text found in transcript');

  return texts.join(' ');
}

function btoa(str) {
  return Buffer.from(str, 'binary').toString('base64');
}
