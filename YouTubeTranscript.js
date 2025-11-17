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
  const videoIdParam = url.searchParams.get('video_id')
  
  if (!youtubeUrl && !videoIdParam) {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      message: 'The url or video_id parameter is required'
    }, 400, corsHeaders)
  }
  
  let videoId = videoIdParam
  
  if (youtubeUrl && !videoId) {
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
      if (youtubeUrl.includes('youtube.com/watch?v=')) {
        videoId = new URL(youtubeUrl).searchParams.get('v')
      } else if (youtubeUrl.includes('youtu.be/')) {
        videoId = new URL(youtubeUrl).pathname.slice(1).split('?')[0]
      } else if (youtubeUrl.includes('youtube.com/shorts/')) {
        videoId = new URL(youtubeUrl).pathname.split('/shorts/')[1].split('?')[0]
      } else if (youtubeUrl.includes('youtube.com/embed/')) {
        videoId = new URL(youtubeUrl).pathname.split('/embed/')[1].split('?')[0]
      } else if (youtubeUrl.includes('youtube.com/v/')) {
        videoId = new URL(youtubeUrl).pathname.split('/v/')[1].split('?')[0]
      } else if (youtubeUrl.includes('m.youtube.com/watch?v=')) {
        videoId = new URL(youtubeUrl).searchParams.get('v')
      } else {
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
    } catch (e) {
      return jsonResponse({
        status_code: 400,
        developer: 'El Impaciente',
        credits: 'Ashlynn Repository',
        telegram_channels: {
          el_impaciente: 'https://t.me/Apisimpacientes',
          ashlynn_repository: 'https://t.me/Ashlynn_Repository'
        },
        message: 'Could not parse YouTube URL'
      }, 400, corsHeaders)
    }
  }
  
  if (!videoId || videoId.trim() === '') {
    return jsonResponse({
      status_code: 400,
      developer: 'El Impaciente',
      credits: 'Ashlynn Repository',
      telegram_channels: {
        el_impaciente: 'https://t.me/Apisimpacientes',
        ashlynn_repository: 'https://t.me/Ashlynn_Repository'
      },
      message: 'Could not extract video ID from URL'
    }, 400, corsHeaders)
  }
  
  try {
    const transcript = await getKomeTranscript(videoId)
    
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
      message: 'Transcription unavailable',
      details: error.message || 'Could not retrieve transcript for this video'
    }, 400, corsHeaders)
  }
}

async function getKomeTranscript(videoId) {
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
      video_id: videoId,
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
