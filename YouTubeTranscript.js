addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})
const METADATA = {
  developer: 'El Impaciente',
  credits: 'Ashlynn Repository',
  telegram_channels: {
    el_impaciente: 'https://t.me/Apisimpacientes',
    ashlynn_repository: 'https://t.me/Ashlynn_Repository'
  }
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
async function handleRequest(request) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/transcript')) {
    return errorResponse('Endpoint not found. Use /transcript', 404)
  }
  const youtubeUrl = url.searchParams.get('url')
  if (!youtubeUrl?.trim() || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
    return errorResponse('Invalid or missing YouTube URL', 400)
  }
  try {
    const transcript = await getKomeTranscript(youtubeUrl)
    return jsonResponse({ status_code: 200, ...METADATA, response: transcript }, 200, { 'Cache-Control': 'public, max-age=3600' })
  } catch (error) {
    return errorResponse('Transcription unavailable', 400)
  }
}
async function getKomeTranscript(youtubeUrl) {
  const response = await fetch('https://kome.ai/api/transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://kome.ai',
      'Referer': 'https://kome.ai/tools/youtube-transcript-generator',
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json, text/plain, */*'
    },
    body: JSON.stringify({ video_id: youtubeUrl, format: true }),
    signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.transcript) {
    throw new Error('No transcript available')
  }
  return data.transcript
}
function errorResponse(message, status) {
  return jsonResponse({ status_code: status, ...METADATA, message }, status)
}
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders }
  })
}
