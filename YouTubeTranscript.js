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
      let vid = videoId;
      if (!vid && videoUrl) {
        vid = extractVideoId(videoUrl);
      }

      if (!vid) {
        return new Response(JSON.stringify({
          status_code: 400,
          message: 'URL o video_id requerido',
          developer: 'El Impaciente',
          telegram_channel: 'https://t.me/Apisimpacientes'
        }), { status: 400, headers: corsHeaders });
      }

      // Usar múltiples estrategias en paralelo
      const transcript = await getTranscriptRobust(vid);

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

async function getTranscriptRobust(videoId) {
  // Intentar todos los métodos en paralelo para mayor velocidad
  const methods = [
    fetchTranscriptYTInnerTube(videoId),
    fetchTranscriptDirect(videoId),
    fetchTranscriptEmbed(videoId)
  ];

  // Promise.any retorna el primero que tenga éxito
  try {
    return await Promise.any(methods);
  } catch (error) {
    throw new Error('No captions available for this video');
  }
}

// Método 1: YouTube InnerTube API (más confiable)
async function fetchTranscriptYTInnerTube(videoId) {
  const apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // API key pública de YouTube
  
  const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20231219.04.00'
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20231219.04.00',
          hl: 'es',
          gl: 'US'
        }
      },
      params: btoa(`\n\x0b${videoId}`)
    })
  });

  if (!response.ok) throw new Error('InnerTube failed');

  const data = await response.json();
  const transcriptData = data?.actions?.[0]?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
    ?.transcriptSegmentListRenderer?.initialSegments;

  if (!transcriptData) throw new Error('No transcript in InnerTube');

  const texts = transcriptData.map(segment => 
    segment.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text || ''
  ).filter(Boolean);

  if (texts.length === 0) throw new Error('Empty transcript');

  return texts.join(' ');
}

// Método 2: Directo desde HTML
async function fetchTranscriptDirect(videoId) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { 
    headers,
    cf: { cacheTtl: 300 } // Cache por 5 minutos
  });

  const html = await response.text();

  // Buscar en ytInitialPlayerResponse
  let match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s);
  if (!match) {
    match = html.match(/"captions":\s*({.+?}),/s);
  }

  if (!match) throw new Error('No player response');

  const playerData = JSON.parse(match[1]);
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No captions in HTML');
  }

  // Priorizar español
  let caption = captionTracks.find(c => c.languageCode?.startsWith('es'));
  if (!caption) caption = captionTracks[0];

  const transcriptUrl = caption.baseUrl;
  const transcriptResponse = await fetch(transcriptUrl);
  const xml = await transcriptResponse.text();

  return parseXMLTranscript(xml);
}

// Método 3: Usando embed
async function fetchTranscriptEmbed(videoId) {
  const response = await fetch(`https://www.youtube.com/embed/${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'Referer': 'https://www.youtube.com/'
    }
  });

  const html = await response.text();
  
  // Extraer configuración del player
  const match = html.match(/"captionTracks":\s*(\[.+?\])/);
  if (!match) throw new Error('No captions in embed');

  const captions = JSON.parse(match[1]);
  let caption = captions.find(c => c.languageCode?.startsWith('es')) || captions[0];

  const transcriptResponse = await fetch(caption.baseUrl);
  const xml = await transcriptResponse.text();

  return parseXMLTranscript(xml);
}

function parseXMLTranscript(xml) {
  const textRegex = /<text[^>]*>(.*?)<\/text>/gs;
  const texts = [];
  let match;

  while ((match = textRegex.exec(xml)) !== null) {
    let text = match[1];
    
    // Decodificar entidades HTML
    text = text.replace(/&amp;/g, '&')
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

  if (texts.length === 0) throw new Error('No text in transcript');

  return texts.join(' ');
}

// Helper para btoa (base64)
function btoa(str) {
  return Buffer.from(str, 'binary').toString('base64');
}
