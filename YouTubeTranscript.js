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
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  const keyResponse = await fetch(videoUrl, {
    headers: { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(45000)
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
  
  // Updated client versions
  const clientVersions = ["19.09.37", "19.09.36", "18.11.34", "17.31.35"]
  let playerResponse
  
  for (const version of clientVersions) {
    const playerBody = {
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: version,
          androidSdkVersion: 30,
          userAgent: `com.google.android.youtube/${version} (Linux; U; Android 11) gzip`
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
    
    try {
      const response = await fetch(playerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `com.google.android.youtube/${version} (Linux; U; Android 11) gzip`,
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': version
        },
        body: JSON.stringify(playerBody),
        signal: AbortSignal.timeout(45000)
      })
      
      if (response.ok) {
        playerResponse = await response.json()
        if (playerResponse.captions) {
          break
        }
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
    track = tracks.find(t => t.languageCode.startsWith(language.split('-')[0]))
  }
  if (!track) {
    track = tracks[0]
  }
  
  // Use JSON format instead of XML for better reliability
  let captionsUrl = track.baseUrl
  if (!captionsUrl.includes('fmt=json3')) {
    captionsUrl = captionsUrl.replace(/&fmt=\w+/, '') + '&fmt=json3'
  }
  
  const captionsResponse = await fetch(captionsUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(45000)
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
