addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  if (request.method !== 'GET') {
    return jsonResponse({
      status_code: 400,
      message: 'Only GET requests are allowed'
    }, 400)
  }
  
  const ytUrl = url.searchParams.get('url')
  
  if (!ytUrl || ytUrl.trim() === '') {
    return jsonResponse({
      status_code: 400,
      message: 'The url parameter is required'
    }, 400)
  }
  
  try {
    new URL(ytUrl)
  } catch (e) {
    return jsonResponse({
      status_code: 400,
      message: 'Invalid URL format'
    }, 400)
  }
  
  if (!ytUrl.includes('youtube.com') && !ytUrl.includes('youtu.be')) {
    return jsonResponse({
      status_code: 400,
      message: 'URL must be a YouTube video'
    }, 400)
  }
  
  let videoId;
  try {
    if (ytUrl.includes('youtu.be/')) {
      videoId = ytUrl.split('youtu.be/')[1].split(/[?#]/)[0];
    } else {
      const urlObj = new URL(ytUrl);
      videoId = urlObj.searchParams.get('v');
    }
    if (!videoId || videoId.length < 11) {
      throw new Error();
    }
  } catch (e) {
    return jsonResponse({
      status_code: 400,
      message: 'Invalid YouTube video ID'
    }, 400)
  }
  
  try {
    const pageResponse = await fetch(ytUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(30000)
    });
    if (!pageResponse.ok) {
      throw new Error('Failed to fetch video page');
    }
    const html = await pageResponse.text();
    
    // Improved regex to capture full player response (non-greedy until matching })
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      throw new Error('Could not find player response');
    }
    const playerResponse = JSON.parse(match[1]);
    
    const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No captions available');
    }
    
    const language = url.searchParams.get('language') || 'en';
    let captionUrl = captionTracks[0].baseUrl;
    for (let track of captionTracks) {
      if (track.languageCode === language) {
        captionUrl = track.baseUrl;
        break;
      }
    }
    
    const captionResponse = await fetch(captionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(30000)
    });
    if (!captionResponse.ok) {
      throw new Error('Failed to fetch captions');
    }
    const xml = await captionResponse.text();
    
    // Improved XML parsing: extract text with timestamps and clean
    const texts = [];
    const textMatches = xml.match(/<text start="[^"]+" dur="[^"]+">([^<]+)<\/text>/g);
    if (textMatches) {
      textMatches.forEach(match => {
        let text = match.replace(/<text[^>]*>([^<]+)<\/text>/, '$1').trim();
        // Remove potential [BLANK_AUDIO] or empty
        if (text && !text.includes('[BLANK_AUDIO]')) {
          texts.push(text);
        }
      });
    }
    
    const transcript = texts.join(' ');
    
    if (!transcript) {
      throw new Error('No transcript text found');
    }
    
    return jsonResponse({
      status_code: 200,
      response: transcript,
      language: language,
      video_id: videoId
    }, 200, { 'Cache-Control': 'public, max-age=3600' })
    
  } catch (error) {
    const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');
    
    return jsonResponse({
      status_code: 400,
      message: isTimeout ? 'Request timeout. Please try again' : `Error getting transcript: ${error.message}`
    }, 400)
  }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders
    }
  })
}
