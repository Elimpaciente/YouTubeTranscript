addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS, status: 204 })
  }

  const url = new URL(request.url)
  
  if (!url.pathname.startsWith('/transcript')) {
    return jsonResponse({ success: false, message: 'Endpoint not found. Use /transcript' }, 404)
  }

  const youtubeUrl = url.searchParams.get('url')
  
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return jsonResponse({ success: false, message: 'Invalid or missing YouTube URL' }, 400)
  }

  const isShort = youtubeUrl.includes('/shorts/')

  try {
    let transcript

    if (isShort) {
      // Shorts: SOLO kome.ai (yt-to-text no funciona con Shorts)
      transcript = await getTranscriptKome(youtubeUrl)
    } else {
      // Videos normales: primero yt-to-text, luego kome.ai
      try {
        const videoId = extractVideoId(youtubeUrl)
        transcript = await getYouTubeTranscript(videoId)
      } catch {
        transcript = await getTranscriptKome(youtubeUrl)
      }
    }

    return jsonResponse({ success: true, transcript }, 200)
  } catch (error) {
    return jsonResponse({ success: false, message: 'Transcription unavailable' }, 400)
  }
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  throw new Error('Invalid YouTube URL')
}

async function getYouTubeTranscript(videoId) {
  const response = await fetch('https://yt-to-text.com/api/v1/Subtitles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare Worker)'
    },
    body: JSON.stringify({ video_id: videoId }),
    signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) throw new Error(`API request failed: ${response.status}`)
  const data = await response.json()
  if (!data.data?.transcripts) throw new Error('No transcript available')
  return data.data.transcripts.map(item => item.t).join('\n')
}

async function getTranscriptKome(videoUrl) {
  const response = await fetch('https://kome.ai/api/transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json, text/plain, */*'
    },
    body: JSON.stringify({
      video_id: videoUrl,
      format: true
    }),
    signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) throw new Error(`API request failed: ${response.status}`)
  const data = await response.json()
  if (!data.transcript) throw new Error('No transcript available')
  return data.transcript
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders }
  })
}
