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
      telegram_channel: 'https://t.me/Apisimpacientes',
      message: 'Only GET requests are allowed'
    }, 405, corsHeaders)
  }
  
  const url = new URL(request.url)
  
  if (!url.pathname.startsWith('/summarize')) {
    return jsonResponse({
      status_code: 404,
      message: 'Endpoint not found. Use /summarize',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 404, corsHeaders)
  }
  
  const youtubeUrl = url.searchParams.get('url')
  const language = url.searchParams.get('language')
  
  if (!youtubeUrl) {
    return jsonResponse({
      status_code: 400,
      message: 'The url and language parameters are required',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400, corsHeaders)
  }
  
  if (!youtubeUrl.trim()) {
    return jsonResponse({
      status_code: 400,
      message: 'The url parameter cannot be empty',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400, corsHeaders)
  }
  
  if (!language) {
    return jsonResponse({
      status_code: 400,
      message: 'The language parameter is required (e.g., english, spanish, french)',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400, corsHeaders)
  }
  
  if (!language.trim()) {
    return jsonResponse({
      status_code: 400,
      message: 'The language parameter cannot be empty',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400, corsHeaders)
  }
  
  try {
    const isValidYoutubeUrl = youtubeUrl.includes('youtube.com') || 
                              youtubeUrl.includes('youtu.be')
    
    if (!isValidYoutubeUrl) {
      return jsonResponse({
        status_code: 400,
        message: 'Invalid YouTube URL format',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400, corsHeaders)
    }
    
    const transcriptUrl = `https://yt-transcript.apisimpacientes.workers.dev/transcript?url=${encodeURIComponent(youtubeUrl)}`
    
    const transcriptResponse = await fetch(transcriptUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(30000)
    })
    
    if (!transcriptResponse.ok) {
      return jsonResponse({
        status_code: 400,
        message: 'Failed to fetch YouTube transcript',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400, corsHeaders)
    }
    
    const transcriptData = await transcriptResponse.json()
    
    if (transcriptData.status_code !== 200 || !transcriptData.response) {
      return jsonResponse({
        status_code: 400,
        message: 'No transcript available for this video',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400, corsHeaders)
    }
    
    const transcript = transcriptData.response
    
    const prompt = `Please provide a comprehensive summary of the following YouTube video transcript in ${language}. Include the main topics, key points, and important details:\n\n${transcript}`
    
    const mistralUrl = `https://mistral-ai.apisimpacientes.workers.dev/?message=${encodeURIComponent(prompt)}`
    
    const aiResponse = await fetch(mistralUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(90000)
    })
    
    if (!aiResponse.ok) {
      return jsonResponse({
        status_code: 400,
        message: 'Failed to generate summary',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400, corsHeaders)
    }
    
    const summaryData = await aiResponse.json()
    
    if (!summaryData || summaryData.status_code !== 200 || !summaryData.response) {
      return jsonResponse({
        status_code: 400,
        message: 'Empty response from AI service',
        developer: 'El Impaciente',
        telegram_channel: 'https://t.me/Apisimpacientes'
      }, 400, corsHeaders)
    }
    
    return jsonResponse({
      status_code: 200,
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes',
      language: language,
      response: summaryData.response
    }, 200, { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' })
    
  } catch (error) {
    return jsonResponse({
      status_code: 400,
      message: 'Summarization unavailable',
      developer: 'El Impaciente',
      telegram_channel: 'https://t.me/Apisimpacientes'
    }, 400, corsHeaders)
  }
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
