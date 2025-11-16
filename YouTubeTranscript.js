addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

async function handleRequest(request) {
  const url = new URL(request.url)

  if (request.method !== 'GET') {
    return jsonResponse({
      status_code: 400,
      message: 'Only GET requests are allowed',
      developer: 'El Impaciente (Fixed by Grok)',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }

  const youtubeUrl = url.searchParams.get('url')
  const videoIdParam = url.searchParams.get('video_id')
  const language = url.searchParams.get('language') || 'en'

  if (!youtubeUrl && !videoIdParam) {
    return jsonResponse({
      status_code: 400,
      message: 'url or video_id parameter is required',
      developer: 'El Impaciente (Fixed by Grok)',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }

  let videoId = videoIdParam

  // Extract video ID from URL
  if (youtubeUrl && !videoId) {
    if (!youtubeUrl.trim()) {
      return jsonResponse({
        status_code: 400,
        message: 'url parameter cannot be empty',
        developer: 'El Impaciente (Fixed by Grok)',
        telegram_channel: 'https://t.me/Apisimpacientes'
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
          message: 'Invalid YouTube URL format',
          developer: 'El Impaciente (Fixed by Grok)',
          telegram_channel: 'https://t.me/Apisimpacientes'
        }, 400)
      }
    } catch (e) {
      return jsonResponse({
        status_code: 400,
        message: 'Failed to parse YouTube URL',
        developer: 'El Impaciente (Fixed by Grok)',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400)
    }
  }

  if (!videoId || videoId.trim() === '') {
    return jsonResponse({
      status_code: 400,
      message: 'Could not extract video ID',
      developer: 'El Impaciente (Fixed by Grok)',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 24000) // 24 seconds max

  try {
    const transcript = await getYouTubeTranscript(videoId, language, controller.signal)
    const fullText = transcript.map(t => t.text).join(' ')

    clearTimeout(timeout)
    return jsonResponse({
      status_code: 200,
      video_id: videoId,
      language: transcript.language || language,
      response: fullText,
      developer: 'El Impaciente (Fixed by Grok)',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 200, { 'Cache-Control': 'public, max-age=3600' })

  } catch (error) {
    clearTimeout(timeout)
    return jsonResponse({
      status_code: 400,
      message: error.message || 'Failed to get transcript',
      developer: 'El Impaciente (Fixed by Grok)',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400)
  }
}

// =============================
// FIXED & OPTIMIZED Transcript Logic
// =============================
async function getYouTubeTranscript(videoId, language = 'en', signal) {
  const apiKey = await fetchApiKey(videoId, signal)
  const tracks = await fetchCaptionTracks(videoId, apiKey, signal)

  let track = tracks.find(t => t.languageCode === language) ||
              tracks.find(t => t.kind === 'asr') ||
              tracks[0]

  if (!track) throw new Error('No caption track available')

  const transcript = await fetchTranscriptXml(track.baseUrl, signal)
  transcript.language = track.languageCode
  return transcript
}

async function fetchApiKey(videoId, signal) {
  const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': UA },
    signal
  })
  if (!resp.ok) throw new Error('Video page not accessible')
  const html = await resp.text()
  const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  if (!match) throw new Error('API key not found')
  return match[1]
}

async function fetchCaptionTracks(videoId, apiKey, signal) {
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20251116.01.00' // Latest working version
      }
    },
    videoId
  }

  const resp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA
    },
    body: JSON.stringify(body),
    signal
  })

  if (!resp.ok) throw new Error('Failed to fetch player data')
  const data = await resp.json()

  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!tracks?.length) throw new Error('No subtitles available')
  return tracks
}

async function fetchTranscriptXml(baseUrl, signal) {
  const url = new URL(baseUrl)
  url.searchParams.delete('fmt')
  url.searchParams.set('fmt', 'xml') // Force XML

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': UA },
    signal
  })

  if (!resp.ok) throw new Error('Failed to download subtitles')
  const xml = await resp.text()
  return parseCaptionsXml(xml)
}

function parseCaptionsXml(xml) {
  const captions = []
  const regex = /<text start="([^"]+)" dur="([^"]+)">([^<]+)<\/text>/g
  let match

  while ((match = regex.exec(xml)) !== null) {
    let text = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim()

    if (text && !text.includes('[BLANK_AUDIO]') && !text.includes('[Music]')) {
      captions.push({
        startTime: parseFloat(match[1]),
        duration: parseFloat(match[2]),
        text
      })
    }
  }

  if (captions.length === 0) throw new Error('No readable text in subtitles')
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
