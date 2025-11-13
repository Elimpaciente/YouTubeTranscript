addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  if (request.method !== 'GET') {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Only GET requests are allowed'
    }, 400)
  }
  
  const path = url.pathname
  if (path === '/' || path === '') {
    return jsonResponse({
      name: "YouTube Transcript API",
      version: "2.0.0",
      developer: "El Impaciente",
      telegram_channel: "https://t.me/Apisimpacientes",
      description: "Extrae transcripciones de videos de YouTube",
      endpoints: {
        "GET /transcript": "Obtiene la transcripción de un video (requiere parámetros: url o video_id, opcional: language)",
        "GET /health": "Verifica el estado de la API"
      },
      examples: [
        "/transcript?url=https://www.youtube.com/watch?v=VIDEO_ID",
        "/transcript?video_id=VIDEO_ID&language=es"
      ]
    }, 200)
  }
  
  if (path === '/health') {
    return jsonResponse({
      status: "ok",
      message: "API funcionando correctamente",
      timestamp: new Date().toISOString()
    }, 200)
  }
  
  if (path === '/transcript') {
    return await handleTranscriptRequest(url)
  }
  
  return jsonResponse({
    status_code: 404,
    message: 'Endpoint not found'
  }, 404)
}

async function handleTranscriptRequest(url) {
  const youtubeUrl = url.searchParams.get('url')
  const videoIdParam = url.searchParams.get('video_id')
  const language = url.searchParams.get('language') || 'en'
  
  let videoId = videoIdParam
  if (youtubeUrl && !videoId) {
    try {
      const urlObj = new URL(youtubeUrl)
      if (urlObj.hostname.includes('youtube.com')) {
        videoId = urlObj.searchParams.get('v')
      } else if (urlObj.hostname.includes('youtu.be')) {
        videoId = urlObj.pathname.slice(1).split('?')[0]
      }
    } catch (e) {
      return jsonResponse({
        status_code: 400,
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes',
        message: 'Invalid YouTube URL format'
      }, 400)
    }
  }
  
  if (!videoId || videoId.trim() === '') {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'The url or video_id parameter is required'
    }, 400)
  }
  
  try {
    const transcript = await getYouTubeTranscript(videoId, language)
    const fullText = transcript.map(item => item.text).join(' ')
    
    return jsonResponse({
      status_code: 200,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      video_id: videoId,
      language: transcript.language || language,
      fragment_count: transcript.length,
      response: fullText,
      fragments: transcript
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
  try {
    const apiKey = await getInnertubeApiKey(videoId)
    const playerResponse = await getPlayerResponse(videoId, apiKey)
    if (!playerResponse.captions) {
      throw new Error('No se encontraron subtítulos para este video')
    }
    
    const captionsData = playerResponse.captions
    const tracks = captionsData.playerCaptionsTracklistRenderer?.captionTracks || []
    
    if (tracks.length === 0) {
      throw new Error('No hay pistas de subtítulos disponibles')
    }
    
    let track = tracks.find(t => t.languageCode === language)
    if (!track) {
      track = tracks[0]
    }
    
    let baseUrl = track.baseUrl
    baseUrl = baseUrl.replace(/&fmt=\w+/, '')
    const captionsXml = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text())
    
    const transcript = parseCaptionsXml(captionsXml)
    transcript.language = track.languageCode
    
    if (transcript.length === 0) {
      throw new Error('No se pudieron extraer fragmentos de subtítulos')
    }
    
    return transcript
    
  } catch (error) {
    throw new Error(`Error al extraer transcripción: ${error.message}`)
  }
}

async function getInnertubeApiKey(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  
  const response = await fetch(videoUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  })
  
  if (!response.ok) {
    throw new Error('No se pudo acceder a la página del video')
  }
  
  const html = await response.text()
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  
  if (!apiKeyMatch) {
    throw new Error('No se encontró INNERTUBE_API_KEY en la página del video')
  }
  
  return apiKeyMatch[1]
}

async function getPlayerResponse(videoId, apiKey) {
  const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`
  
  const playerBody = {
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "20.10.38"
      }
    },
    videoId: videoId
  }
  
  const response = await fetch(playerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(playerBody)
  })
  
  if (!response.ok) {
    throw new Error('Error al obtener respuesta del reproductor')
  }
  
  return await response.json()
}

function parseCaptionsXml(xmlContent) {
  const captions = []
  const pattern = /<text start="([^"]+)" dur="([^"]+)">([^<]+)<\/text>/g
  
  let match
  while ((match = pattern.exec(xmlContent)) !== null) {
    const startTime = parseFloat(match[1])
    const duration = parseFloat(match[2])
    let text = match[3]
    text = text
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