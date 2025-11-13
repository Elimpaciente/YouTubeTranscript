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
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  
  const youtubeUrl = url.searchParams.get('url')
  
  if (!youtubeUrl || youtubeUrl.trim() === '') {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'The url parameter is required'
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  
  if (!youtubeUrl.includes('youtube.com/watch?v=') && !youtubeUrl.includes('youtu.be/')) {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Invalid YouTube URL format'
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  
  try {
    let videoId
    if (youtubeUrl.includes('youtube.com/watch?v=')) {
      videoId = new URL(youtubeUrl).searchParams.get('v')
    } else if (youtubeUrl.includes('youtu.be/')) {
      videoId = new URL(youtubeUrl).pathname.slice(1).split('?')[0]
    }
    
    if (!videoId || videoId.trim() === '') {
      return new Response(JSON.stringify({
        status_code: 400,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        message: 'Could not extract video ID from URL'
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    
    const transcript = await getYouTubeTranscript(videoId)
    const fullText = transcript.map(item => item.text).join(' ')
    
    return new Response(JSON.stringify({
      status_code: 200,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      response: fullText
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      }
    })
    
  } catch (error) {
    return new Response(JSON.stringify({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: error.message || 'Error processing request'
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

async function getYouTubeTranscript(videoId, language = 'en') {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  const keyResponse = await fetch(videoUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!keyResponse.ok) {
    throw new Error('Failed to access video page')
  }
  
  const html = await keyResponse.text()
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  if (!apiKeyMatch) {
    throw new Error('INNERTUBE_API_KEY not found')
  }
  
  const apiKey = apiKeyMatch[1]
  
  const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`
  const clientVersions = ["20.45.34", "20.45.32"]
  let playerResponse
  
  for (const version of clientVersions) {
    const playerBody = {
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: version
        }
      },
      videoId: videoId
    }
    
    try {
      const response = await fetch(playerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(playerBody),
        signal: AbortSignal.timeout(30000)
      })
      
      if (response.ok) {
        playerResponse = await response.json()
        break
      }
    } catch (err) {
      continue
    }
  }
  
  if (!playerResponse || !playerResponse.captions) {
    throw new Error('No captions available for this video')
  }
  
  const captionsData = playerResponse.captions
  const tracks = captionsData.playerCaptionsTracklistRenderer?.captionTracks || []
  
  if (tracks.length === 0) {
    throw new Error('No caption tracks available')
  }
  
  let track = tracks.find(t => t.languageCode === language)
  if (!track) {
    track = tracks[0]
  }
  
  let baseUrl = track.baseUrl.replace(/&fmt=\w+/, '')
  const captionsResponse = await fetch(baseUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!captionsResponse.ok) {
    throw new Error('Failed to fetch captions')
  }
  
  const captionsXml = await captionsResponse.text()
  const transcript = parseCaptionsXml(captionsXml)
  
  if (transcript.length === 0) {
    throw new Error('No transcript found')
  }
  
  return transcript
}

function parseCaptionsXml(xmlContent) {
  const captions = []
  const pattern = /<text start="([^"]+)" dur="([^"]+)">([^<]+)<\/text>/g
  
  let match
  while ((match = pattern.exec(xmlContent)) !== null) {
    const startTime = parseFloat(match[1])
    const duration = parseFloat(match[2])
    let text = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim()
    
    if (text && !text.includes('[BLANK_AUDIO]')) {
      captions.push({
        startTime,
        duration,
        text
      })
    }
  }
  
  return captions
}
