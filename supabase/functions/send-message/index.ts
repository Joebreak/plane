import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  corsPreflight,
  getChannelById,
  jsonResponse,
  linePushText,
  recordOutgoingMessage,
} from '../_shared/line.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) return jsonResponse({ error: 'Unauthorized' }, 401)

  let body: { line_user_id?: string; line_user_uuid?: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const content = body.content?.trim()
  if (!content) {
    return jsonResponse({ error: 'content is required' }, 400)
  }

  const service = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let lineUserQuery = service.from('line_users').select('*')
  if (body.line_user_uuid) {
    lineUserQuery = lineUserQuery.eq('id', body.line_user_uuid)
  } else if (body.line_user_id) {
    lineUserQuery = lineUserQuery.eq('line_user_id', body.line_user_id.trim())
  } else {
    return jsonResponse({ error: 'line_user_uuid or line_user_id is required' }, 400)
  }

  const { data: lineUser, error: findErr } = await lineUserQuery.maybeSingle()

  if (findErr) return jsonResponse({ error: findErr.message }, 500)
  if (!lineUser) return jsonResponse({ error: 'LINE user not found' }, 404)
  if (!lineUser.channel_id) {
    return jsonResponse({ error: 'LINE user is not linked to a channel' }, 400)
  }

  const channel = await getChannelById(lineUser.channel_id)
  if (!channel) return jsonResponse({ error: 'Channel not found or inactive' }, 404)

  try {
    await linePushText(lineUser.line_user_id, content, channel.channel_access_token)
    const message = await recordOutgoingMessage({
      lineUserUuid: lineUser.id,
      content,
      status: 'sent',
    })
    return jsonResponse({ ok: true, message })
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err)
    try {
      await recordOutgoingMessage({
        lineUserUuid: lineUser.id,
        content,
        status: 'failed',
      })
    } catch {
      // ignore secondary failure
    }
    return jsonResponse({ error: messageText }, 502)
  }
})
