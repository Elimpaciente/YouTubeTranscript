addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Only GET requests are allowed'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  const ytUrl = url.searchParams.get('url')
  
  if (!ytUrl || ytUrl.trim() === '') {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'The url parameter is required'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  try {
    new URL(ytUrl)
  } catch (e) {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Invalid URL format'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  if (!ytUrl.includes('youtube.com') && !ytUrl.includes('youtu.be')) {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'URL must be a YouTube video'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
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
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Invalid YouTube video ID'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  try {
    const pageResponse = await fetch(ytUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!pageResponse.ok) {
      throw new Error('Failed to fetch video page');
    }
    const html = await pageResponse.text();
    
    const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (!match) {
      throw new Error('Could not find player response');
    }
    const playerResponse = JSON.parse(match[1]);
    
    const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No captions available');
    }
    
    let captionUrl = captionTracks[0].baseUrl;
    for (let track of captionTracks) {
      if (track.languageCode === 'en') {
        captionUrl = track.baseUrl;
        break;
      }
    }
    
    const captionResponse = await fetch(captionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!captionResponse.ok) {
      throw new Error('Failed to fetch captions');
    }
    const xml = await captionResponse.text();
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const texts = Array.from(doc.querySelectorAll('text')).map(t => {
      let text = t.textContent.trim();
      // Remove any potential timestamp patterns at the start (e.g., 00:00:01.000 )
      text = text.replace(/^\d{2}:\d{2}:\d{2}(\.\d{3})?\s*/, '');
      return text;
    }).filter(t => t);
    
    const transcript = texts.join(' ');
    
    if (!transcript) {
      throw new Error('No transcript text found');
    }
    
    return new Response(JSON.stringify({
      status_code: 200,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      response: transcript
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    })
    
  } catch (error) {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: `Error getting transcript: ${error.message}`
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
