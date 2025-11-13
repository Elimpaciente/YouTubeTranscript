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
      if (youtubeUrl.includes('youtube.com/watch?v=')) {
        videoId = new URL(youtubeUrl).searchParams.get('v')
      } else if (youtubeUrl.includes('youtu.be/')) {
        videoId = new URL(youtubeUrl).pathname.slice(1).split('?')[0]
      } else if (youtubeUrl.includes('youtube.com/shorts/')) {
        videoId = new URL(youtubeUrl).pathname.split('/')[2]
      } else {
        return jsonResponse({
          status_code: 400,
          message: 'Invalid YouTube URL format',
          developer: 'El Impaciente',
          telegram_channel: 'https://t.me/Apisimpacientes'
        }, 400)
      }
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

async function getYouTubeTranscript(videoId, language = 'en') {
  // Try multiple methods to get transcripts
  const methods = [
    () => getTranscriptViaInnerTube(videoId, language),
    () => getTranscriptViaDirectUrl(videoId, language)
  ]
  
  let lastError
  for (const method of methods) {
    try {
      return await method()
    } catch (error) {
      lastError = error
      continue
    }
  }
  
  throw lastError
}

async function getTranscriptViaInnerTube(videoId, language) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  
  // Rotate User-Agents to avoid detection
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  ]
  
  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)]
  
  const keyResponse = await fetch(videoUrl, {
    headers: { 
      'User-Agent': randomUA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none'
    },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!keyResponse.ok) {
    throw new Error('Failed to access video page')
  }
  
  const html = await keyResponse.text()
  
  // Extract API key
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  if (!apiKeyMatch) {
    throw new Error('INNERTUBE_API_KEY not found')
  }
  
  const apiKey = apiKeyMatch[1]
  
  // Try with multiple client versions
  const clients = [
    { name: "WEB", version: "2.20240304.00.00" },
    { name: "ANDROID", version: "19.09.37" },
    { name: "ANDROID", version: "18.11.34" },
    { name: "IOS", version: "19.09.3" }
  ]
  
  for (const client of clients) {
    try {
      const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`
      
      const playerBody = {
        context: {
          client: {
            clientName: client.name,
            clientVersion: client.version,
            ...(client.name === "ANDROID" && {
              androidSdkVersion: 30,
              userAgent: `com.google.android.youtube/${client.version} (Linux; U; Android 11) gzip`
            }),
            ...(client.name === "IOS" && {
              deviceMake: "Apple",
              deviceModel: "iPhone14,5",
              userAgent: `com.google.ios.youtube/${client.version} (iPhone14,5; U; CPU iOS 15_6 like Mac OS X)`
            })
          }
        },
        videoId: videoId,
        params: "CgIQBg==",
        playbackContext: {
          contentPlaybackContext: {
            html5Preference: "HTML5_PREF_WANTS"
          }
        },
        contentCheckOk: true,
        racyCheckOk: true
      }
      
      const response = await fetch(playerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': randomUA,
          'X-YouTube-Client-Name': client.name === "ANDROID" ? '3' : client.name === "IOS" ? '5' : '1',
          'X-YouTube-Client-Version': client.version,
          'Origin': 'https://www.youtube.com',
          'Referer': videoUrl
        },
        body: JSON.stringify(playerBody),
        signal: AbortSignal.timeout(30000)
      })
      
      if (response.ok) {
        const playerResponse = await response.json()
        if (playerResponse.captions) {
          return await extractTranscript(playerResponse, language, randomUA)
        }
      }
    } catch (err) {
      continue
    }
  }
  
  throw new Error('No captions available for this video')
}

async function getTranscriptViaDirectUrl(videoId, language) {
  // Alternative: try to get captions directly via timedtext API
  const baseUrl = `https://www.youtube.com/api/timedtext`
  const params = new URLSearchParams({
    v: videoId,
    lang: language,
    fmt: 'json3'
  })
  
  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!response.ok) {
    throw new Error('Direct caption fetch failed')
  }
  
  const data = await response.json()
  return parseCaptionsJson(data)
}

async function extractTranscript(playerResponse, language, userAgent) {
  const captionsData = playerResponse.captions
  const tracks = captionsData.playerCaptionsTracklistRenderer?.captionTracks || []
  
  if (tracks.length === 0) {
    throw new Error('No caption tracks available')
  }
  
  let track = tracks.find(t => t.languageCode === language)
  if (!track) {
    track = tracks.find(t => t.languageCode.startsWith(language.split('-')[0]))
  }
  if (!track) {
    track = tracks[0]
  }
  
  let captionsUrl = track.baseUrl
  if (!captionsUrl.includes('fmt=json3')) {
    captionsUrl = captionsUrl.replace(/&fmt=\w+/, '') + '&fmt=json3'
  }
  
  const captionsResponse = await fetch(captionsUrl, {
    headers: { 
      'User-Agent': userAgent,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(30000)
  })
  
  if (!captionsResponse.ok) {
    throw new Error('Failed to fetch captions')
  }
  
  const contentType = captionsResponse.headers.get('content-type')
  let transcript
  
  if (contentType && contentType.includes('json')) {
    const captionsJson = await captionsResponse.json()
    transcript = parseCaptionsJson(captionsJson)
  } else {
    const captionsXml = await captionsResponse.text()
    transcript = parseCaptionsXml(captionsXml)
  }
  
  if (transcript.length === 0) {
    throw new Error('No transcript found')
  }
  
  transcript.language = track.languageCode
  return transcript
}

function parseCaptionsJson(jsonData) {
  const captions = []
  
  if (!jsonData.events) {
    return captions
  }
  
  for (const event of jsonData.events) {
    if (!event.segs) continue
    
    const startTime = event.tStartMs / 1000
    const duration = event.dDurationMs / 1000
    
    let text = event.segs
      .map(seg => seg.utf8 || '')
      .join('')
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

function parseCaptionsXml(xmlContent) {
  const captions = []
  const pattern = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/text>/g
  
  let match
  while ((match = pattern.exec(xmlContent)) !== null) {
    const startTime = parseFloat(match[1])
    const duration = parseFloat(match[2])
    let text = match[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
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
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders
    }
  })
}
