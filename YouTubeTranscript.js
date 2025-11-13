addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })
  }
  
  if (request.method !== 'GET') {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Only GET requests are allowed'
    }, 400)
  }
  
  const path = url.pathname
  
  // Root endpoint - API info
  if (path === '/' || path === '') {
    return jsonResponse({
      name: "YouTube Transcript API",
      version: "2.0.1",
      developer: "El Impaciente",
      telegram_channel: "https://t.me/Apisimpacientes",
      description: "Extrae transcripciones de videos de YouTube",
      endpoints: {
        "GET /transcript": "Obtiene la transcripción de un video (requiere parámetros: url o video_id, opcional: language)",
        "GET /health": "Verifica el estado de la API"
      },
      examples: [
        "/transcript?url=https://www.youtube.com/watch?v=VIDEO_ID",
        "/transcript?url=https://youtu.be/VIDEO_ID",
        "/transcript?video_id=VIDEO_ID&language=es"
      ]
    }, 200)
  }
  
  // Health check endpoint
  if (path === '/health') {
    return jsonResponse({
      status: "ok",
      message: "API funcionando correctamente",
      timestamp: new Date().toISOString()
    }, 200)
  }
  
  // Transcript endpoint
  if (path === '/transcript') {
    return await handleTranscriptRequest(url)
  }
  
  // 404 for unknown endpoints
  return jsonResponse({
    status_code: 404,
    developer: 'El Impaciente',
    telegram_channel: 'https://t.me/Apisimpacientes',
    message: 'Endpoint not found. Use /transcript or visit / for API info'
  }, 404)
}

async function handleTranscriptRequest(url) {
  const youtubeUrl = url.searchParams.get('url')
  const videoIdParam = url.searchParams.get('video_id')
  const language = url.searchParams.get('language') || 'en'
  
  let videoId = videoIdParam
  
  // Extract video ID from URL if provided
  if (youtubeUrl && !videoId) {
    if (!youtubeUrl.trim()) {
      return jsonResponse({
        status_code: 400,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        message: 'The url parameter cannot be empty'
      }, 400)
    }
    
    try {
      if (youtubeUrl.includes('youtube.com/watch?v=')) {
        videoId = new URL(youtubeUrl).searchParams.get('v')
      } else if (youtubeUrl.includes('youtu.be/')) {
        videoId = new URL(youtubeUrl).pathname.slice(1).split('?')[0]
      } else {
        return jsonResponse({
          status_code: 400,
          developer: 'El Impaciente',
          telegram_channel: 'https://t.me/Apisimpacientes',
          message: 'Invalid YouTube URL format. Use youtube.com/watch?v= or youtu.be/ format'
        }, 400)
      }
    } catch (e) {
      return jsonResponse({
        status_code: 400,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        message: 'Could not parse YouTube URL'
      }, 400)
    }
  }
  
  if (!videoId || videoId.trim() === '') {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'The url or video_id parameter is required',
      examples: [
        '/transcript?url=https://www.youtube.com/watch?v=VIDEO_ID',
        '/transcript?video_id=VIDEO_ID'
      ]
    }, 400)
  }
  
  try {
    const transcript = await getYouTubeTranscript(videoId, language)
    const fullText = transcript.map(item => item.text).join(' ')
    
    return jsonResponse({
      status_code: 200,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      response: fullText
    }, 200, { 'Cache-Control': 'public, max-age=3600' })
    
  } catch (error) {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: error.message || 'Error processing request',
      video_id: videoId
    }, 400)
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
  
  transcript.language = track.languageCode
  
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
