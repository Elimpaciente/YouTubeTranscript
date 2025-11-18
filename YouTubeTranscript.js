addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
      status: 204
    })
  }

  if (request.method !== 'GET') {
    return jsonResponse({
      status_code: 405,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      message: 'Only GET requests are allowed'
    }, 405, corsHeaders)
  }
  
  const url = new URL(request.url)
  const youtubeUrl = url.searchParams.get('url')
  
  if (!youtubeUrl) {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      message: 'The url parameter is required'
    }, 400, corsHeaders)
  }
  
  if (!youtubeUrl.trim()) {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      message: 'The url parameter cannot be empty'
    }, 400, corsHeaders)
  }
  
  try {
    const isValidYoutubeUrl = youtubeUrl.includes('youtube.com') || 
                              youtubeUrl.includes('youtu.be')
    
    if (!isValidYoutubeUrl) {
      return jsonResponse({
        status_code: 400,
        developer: 'El Impaciente',
        credits: 'Ashlynn Repository',
        telegram_channels: {
          el_impaciente: 'https://t.me/Apisimpacientes',
          ashlynn_repository: 'https://t.me/Ashlynn_Repository'
        },
        message: 'Invalid YouTube URL format'
      }, 400, corsHeaders)
    }
    
    const transcript = await getKomeTranscript(youtubeUrl)
    
    return jsonResponse({
      status_code: 200,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      response: transcript
    }, 200, { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' })
    
  } catch (error) {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      message: 'Transcription unavailable'
    }, 400, corsHeaders)
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
    body: JSON.stringify({
      video_id: youtubeUrl,
      format: true
    }),
    signal: AbortSignal.timeout(30000)
  })

  if (!response.ok) {
    throw new Error(`API request failed with status: ${response.status}`)
  }

  const data = await response.json()

  if (!data.transcript) {
    throw new Error('No transcript available for this video')
  }

  return data.transcript
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  })
}
