addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  if (request.method !== 'GET') {
    return jsonResponse({
      status_code: 400,
      message: 'Only GET requests are allowed',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }
  
  const youtubeUrl = url.searchParams.get('url')
  const videoIdParam = url.searchParams.get('video_id')
  const language = url.searchParams.get('language') || 'en'
  
  if (!youtubeUrl && !videoIdParam) {
    return jsonResponse({
      status_code: 400,
      message: 'The url or video_id parameter is required',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }
  
  let videoId = videoIdParam
  
  if (youtubeUrl && !videoId) {
    if (!youtubeUrl.trim()) {
      return jsonResponse({
        status_code: 400,
        message: 'The url parameter cannot be empty',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400)
    }
    
    try {
      videoId = extractVideoId(youtubeUrl)
    } catch (e) {
      return jsonResponse({
        status_code: 400,
        message: 'Could not parse YouTube URL',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400)
    }
  }
  
  if (!videoId || videoId.trim() === '') {
    return jsonResponse({
      status_code: 400,
      message: 'Could not extract video ID from URL',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }
  
  try {
    const transcript = await getYouTubeTranscript(videoId, language)
    const fullText = transcript.map(item => item.text).join(' ')
    
    return jsonResponse({
      status_code: 200,
      response: fullText,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 200, { 'Cache-Control': 'public, max-age=3600' })
    
  } catch (error) {
    return jsonResponse({
      status_code: 400,
      message: error.message || 'Error processing request',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }
}

function extractVideoId(url) {
  // Múltiples patrones para extraer video ID
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/ // ID directo
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }
  
  throw new Error('Invalid YouTube URL format')
}

async function getYouTubeTranscript(videoId, language = 'en') {
  // Intentar múltiples métodos en orden
  const methods = [
    () => getTranscriptMethod1(videoId, language),
    () => getTranscriptMethod2(videoId, language),
    () => getTranscriptMethod3(videoId, language)
  ]
  
  let lastError = null
  
  for (const method of methods) {
    try {
      const result = await method()
      if (result && result.length > 0) {
        return result
      }
    } catch (error) {
      lastError = error
      continue
    }
  }
  
  throw new Error(lastError?.message || 'No captions available for this video')
}

// Método 1: API de YouTube con múltiples clients
async function getTranscriptMethod1(videoId, language) {
  const clients = [
    { name: "WEB", version: "2.20241111.09.00" },
    { name: "ANDROID", version: "19.09.37" },
    { name: "IOS", version: "19.09.3" }
  ]
  
  for (const client of clients) {
    try {
      // Primero obtener la API key
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
      const pageResponse = await fetch(videoUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(15000)
      })
      
      if (!pageResponse.ok) continue
      
      const html = await pageResponse.text()
      
      // Buscar API key con múltiples patrones
      let apiKey = null
      const apiKeyPatterns = [
        /"INNERTUBE_API_KEY":"([^"]+)"/,
        /"innertubeApiKey":"([^"]+)"/,
        /INNERTUBE_API_KEY["\s:]+["']([^"']+)['"]/
      ]
      
      for (const pattern of apiKeyPatterns) {
        const match = html.match(pattern)
        if (match && match[1]) {
          apiKey = match[1]
          break
        }
      }
      
      if (!apiKey) continue
      
      const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`
      const playerBody = {
        context: {
          client: {
            clientName: client.name,
            clientVersion: client.version,
            hl: language
          }
        },
        videoId: videoId
      }
      
      const playerResponse = await fetch(playerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(playerBody),
        signal: AbortSignal.timeout(15000)
      })
      
      if (!playerResponse.ok) continue
      
      const playerData = await playerResponse.json()
      
      if (!playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        continue
      }
      
      const tracks = playerData.captions.playerCaptionsTracklistRenderer.captionTracks
      let track = tracks.find(t => t.languageCode === language) || tracks[0]
      
      if (!track) continue
      
      const captionsUrl = track.baseUrl.replace(/&fmt=\w+/, '')
      const captionsResponse = await fetch(captionsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000)
      })
      
      if (!captionsResponse.ok) continue
      
      const captionsXml = await captionsResponse.text()
      const transcript = parseCaptionsXml(captionsXml)
      
      if (transcript.length > 0) {
        return transcript
      }
    } catch (error) {
      continue
    }
  }
  
  throw new Error('Method 1 failed')
}

// Método 2: Endpoint alternativo de timedtext
async function getTranscriptMethod2(videoId, language) {
  const langs = [language, 'en', 'es']
  
  for (const lang of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=srv3`
      
      const response = await fetch(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0',
          'Accept-Language': `${lang},en;q=0.9`
        },
        signal: AbortSignal.timeout(15000)
      })
      
      if (!response.ok) continue
      
      const xml = await response.text()
      
      if (xml.includes('<?xml')) {
        const transcript = parseCaptionsXml(xml)
        if (transcript.length > 0) {
          return transcript
        }
      }
    } catch (error) {
      continue
    }
  }
  
  throw new Error('Method 2 failed')
}

// Método 3: Embed player endpoint
async function getTranscriptMethod3(videoId, language) {
  try {
    const embedUrl = `https://www.youtube.com/embed/${videoId}`
    const response = await fetch(embedUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.youtube.com/'
      },
      signal: AbortSignal.timeout(15000)
    })
    
    if (!response.ok) throw new Error('Embed page failed')
    
    const html = await response.text()
    
    // Buscar captionsUrl en el embed
    const captionUrlMatch = html.match(/"captionTracks":\[{"baseUrl":"([^"]+)"/i)
    if (!captionUrlMatch) throw new Error('No caption URL found')
    
    const captionsUrl = captionUrlMatch[1].replace(/\\u0026/g, '&')
    const captionsResponse = await fetch(captionsUrl, {
      signal: AbortSignal.timeout(15000)
    })
    
    if (!captionsResponse.ok) throw new Error('Captions fetch failed')
    
    const xml = await captionsResponse.text()
    const transcript = parseCaptionsXml(xml)
    
    if (transcript.length > 0) {
      return transcript
    }
  } catch (error) {
    throw new Error('Method 3 failed')
  }
  
  throw new Error('Method 3 failed')
}

function parseCaptionsXml(xmlContent) {
  const captions = []
  
  // Múltiples patrones para diferentes formatos de XML
  const patterns = [
    /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]+)<\/text>/g,
    /<text start="([^"]+)"[^>]*dur="([^"]+)"[^>]*>([^<]+)<\/text>/g,
    /<text[^>]*start="([^"]+)"[^>]*>([^<]+)<\/text>/g
  ]
  
  for (const pattern of patterns) {
    const matches = [...xmlContent.matchAll(pattern)]
    if (matches.length > 0) {
      for (const match of matches) {
        const startTime = parseFloat(match[1])
        const duration = match[2] ? parseFloat(match[2]) : 0
        let text = (match[3] || match[2])
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'")
          .replace(/\n/g, ' ')
          .replace(/<[^>]+>/g, '')
          .trim()
        
        if (text && !text.includes('[') && text.length > 0) {
          captions.push({
            startTime,
            duration,
            text
          })
        }
      }
      
      if (captions.length > 0) break
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
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders
    }
  })
}
