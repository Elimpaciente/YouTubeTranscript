/**
 * SOLUCIÓN DEFINITIVA - Basado en @danielxceron/youtube-transcript
 * Implementación con doble fallback: HTML Scraping + Innertube API
 * Este código combina ambos métodos para máxima estabilidad
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

      const transcript = await fetchTranscriptWithFallback(vid, lang);

      return new Response(JSON.stringify({
        status_code: 200,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        response: transcript
      }), { status: 200, headers: corsHeaders });

    } catch (error) {
      console.error('Error final:', error);
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

const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(RE_YOUTUBE);
  return match ? match[1] : (url.match(/^[a-zA-Z0-9_-]{11}$/) ? url : null);
}

// MÉTODO PRINCIPAL CON FALLBACK
async function fetchTranscriptWithFallback(videoId, lang) {
  try {
    // MÉTODO 1: HTML Scraping (más rápido)
    return await fetchTranscriptFromHTML(videoId, lang);
  } catch (error1) {
    console.log('Método HTML falló, intentando Innertube...');
    try {
      // MÉTODO 2: Innertube API (más confiable)
      return await fetchTranscriptFromInnertube(videoId, lang);
    } catch (error2) {
      console.log('Método Innertube falló, intentando método directo...');
      try {
        // MÉTODO 3: Directo desde ytInitialData
        return await fetchTranscriptDirect(videoId, lang);
      } catch (error3) {
        throw new Error('No captions available for this video');
      }
    }
  }
}

// MÉTODO 1: HTML Scraping
async function fetchTranscriptFromHTML(videoId, lang) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'Accept-Language': lang,
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch video page');
  }

  const body = await response.text();
  
  const splittedHTML = body.split('"captions":');

  if (splittedHTML.length <= 1) {
    throw new Error('No captions in HTML');
  }

  let captions;
  try {
    const captionsJSON = splittedHTML[1].split(',"videoDetails')[0].replace(/\n/g, '');
    captions = JSON.parse(captionsJSON.replace(/\n/g, ''));
  } catch (e) {
    throw new Error('Failed to parse captions');
  }

  if (!captions || !captions.playerCaptionsTracklistRenderer) {
    throw new Error('No playerCaptionsTracklistRenderer');
  }

  const captionTracks = captions.playerCaptionsTracklistRenderer.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks');
  }

  const track = selectTrack(captionTracks, lang);
  return await downloadTranscript(track.baseUrl);
}

// MÉTODO 2: Innertube API
async function fetchTranscriptFromInnertube(videoId, lang) {
  const body = {
    context: {
      client: {
        hl: lang || 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: '2.20231219.04.00',
      }
    },
    videoId: videoId
  };

  const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error('Innertube API failed');
  }

  const data = await response.json();
  
  const segments = data?.actions?.[0]?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
    ?.transcriptSegmentListRenderer?.initialSegments;

  if (!segments || segments.length === 0) {
    throw new Error('No segments in Innertube response');
  }

  const text = segments.map(segment => 
    segment.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text || ''
  ).filter(Boolean).join(' ');

  if (!text) {
    throw new Error('Empty transcript from Innertube');
  }

  return text;
}

// MÉTODO 3: Directo desde ytInitialData
async function fetchTranscriptDirect(videoId, lang) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': lang || 'en',
    }
  });

  const html = await response.text();
  
  // Buscar ytInitialPlayerResponse
  const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
  
  if (!match) {
    throw new Error('No ytInitialPlayerResponse');
  }

  const playerResponse = JSON.parse(match[1]);
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No captions in ytInitialPlayerResponse');
  }

  const track = selectTrack(captionTracks, lang);
  return await downloadTranscript(track.baseUrl);
}

// Seleccionar track apropiado
function selectTrack(tracks, lang) {
  let track = tracks.find(t => t.languageCode === lang);
  
  if (!track) {
    track = tracks.find(t => t.languageCode?.startsWith(lang?.split('-')[0]));
  }
  
  if (!track) {
    track = tracks[0];
  }

  return track;
}

// Descargar y parsear transcript
async function downloadTranscript(baseUrl) {
  const response = await fetch(baseUrl, {
    headers: {
      'User-Agent': USER_AGENT,
    }
  });

  if (!response.ok) {
    throw new Error('Failed to download transcript');
  }

  const xml = await response.text();
  
  const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
  const texts = [];
  let match;

  while ((match = regex.exec(xml)) !== null) {
    let text = match[3];
    
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
      texts.push(text);
    }
  }

  if (texts.length === 0) {
    throw new Error('No text in transcript XML');
  }

  return texts.join(' ');
}
