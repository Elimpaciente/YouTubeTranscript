addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

async function handleRequest(request) {
  const url = new URL(request.url)
  
  if (!url.pathname.startsWith('/transcript')) {
    return jsonResponse({ success: false, message: 'Endpoint not found. Use /transcript' }, 404)
  }
  
  const youtubeUrl = url.searchParams.get('url')
  
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return jsonResponse({ success: false, message: 'Invalid or missing YouTube URL' }, 400)
  }
  
  try {
    const videoId = extractVideoId(youtubeUrl)
    const transcript = await getYouTubeTranscript(videoId)
    return jsonResponse({ success: true, transcript }, 200)
  } catch (error) {
    return jsonResponse({ success: false, message: 'Transcription unavailable' }, 400)
  }
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/
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

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders }
  })
}
