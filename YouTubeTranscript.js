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
      version: "2.0.1",  // Actualizado para reflejar el fix
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
    console.error('DEBUG: Error en handleTranscriptRequest:', error.message);  // Log para debug
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
    console.log('DEBUG: Iniciando getYouTubeTranscript para videoId:', videoId, 'language:', language);
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
      console.log('DEBUG: Fallback a track default:', track.languageCode)
    } else {
      console.log('DEBUG: Track encontrado para language:', language)
    }
    
    let baseUrl = track.baseUrl
    baseUrl = baseUrl.replace(/&fmt=\w+/, '')
    console.log('DEBUG: Fetching captions XML:', baseUrl)
    const captionsXml = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text())
    
    const transcript = parseCaptionsXml(captionsXml)
    transcript.language = track.languageCode
    
    if (transcript.length === 0) {
      throw new Error('No se pudieron extraer fragmentos de subtítulos')
    }
    
    console.log('DEBUG: Transcripción exitosa - Fragments:', transcript.length)
    return transcript
    
  } catch (error) {
    console.error('DEBUG: Error en getYouTubeTranscript:', error.message)
    throw new Error(`Error al extraer transcripción: ${error.message}`)
  }
}

async function getInnertubeApiKey(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  console.log('DEBUG: Fetching API Key from:', videoUrl)
  
  const response = await fetch(videoUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  })
  
  if (!response.ok) {
    console.error('DEBUG: GET API Key falló - Código:', response.status)
    throw new Error('No se pudo acceder a la página del video')
  }
  
  const html = await response.text()
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  
  if (!apiKeyMatch) {
    console.error('DEBUG: No se encontró INNERTUBE_API_KEY en HTML')
    throw new Error('No se encontró INNERTUBE_API_KEY en la página del video')
  }
  
  console.log('DEBUG: API Key obtenida (primeros 10 chars):', apiKeyMatch[1].substring(0, 10) + '...')
  return apiKeyMatch[1]
}

async function getPlayerResponse(videoId, apiKey) {
  const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`
  console.log('DEBUG: Iniciando POST a Player URL:', playerUrl)
  
  // Versión actualizada a noviembre 2025
  const clientVersions = ["20.45.34", "20.45.32"];  // Fallback si la primera falla
  let lastError;
  
  for (const version of clientVersions) {
    const playerBody = {
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: version  // ¡Aquí el cambio clave!
        }
      },
      videoId: videoId
    }
    
    console.log('DEBUG: Probando clientVersion:', version)
    
    try {
      const response = await fetch(playerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(playerBody)
      })
      
      console.log('DEBUG: POST código HTTP:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('DEBUG: POST error body (primeros 200 chars):', errorText.substring(0, 200))
        lastError = new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}...`)
        continue;  // Prueba la siguiente versión
      }
      
      const data = await response.json()
      console.log('DEBUG: PlayerResponse OK - Tiene captions?', !!data.captions)
      return data;
      
    } catch (err) {
      console.error('DEBUG: Excepción en POST con version', version, ':', err.message)
      lastError = err;
    }
  }
  
  // Si todas fallan
  throw lastError || new Error('Error al obtener respuesta del reproductor con versiones disponibles')
}

function parseCaptionsXml(xmlContent) {
  console.log('DEBUG: Parsing XML de captions (longitud:', xmlContent.length, ')')
  const captions = []
  const pattern = /<text start="([^"]+)" dur="([^"]+)">([^<]+)<\/text>/g
  
  let match
  let count = 0
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
      count++
    }
  }
  
  console.log('DEBUG: Parsing completado - Fragments válidos:', count)
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
