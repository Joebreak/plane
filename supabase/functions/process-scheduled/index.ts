import {
  corsPreflight,
  getChannelById,
  getServiceClient,
  jsonResponse,
  linePushText,
  recordOutgoingMessage,
} from '../_shared/line.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = Deno.env.get('CRON_SECRET')
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const headerSecret = req.headers.get('x-cron-secret')

  const authorized =
    (serviceKey && bearer === serviceKey) ||
    (cronSecret && (bearer === cronSecret || headerSecret === cronSecret))

  if (!authorized) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()

  const { data: due, error } = await supabase
    .from('scheduled_messages')
    .select('*, line_users(*)')
    .eq('status', 'pending')
    .lte('send_at', nowIso)
    .order('send_at', { ascending: true })
    .limit(50)

  if (error) return jsonResponse({ error: error.message }, 500)

  const results: Array<{ id: string; status: string; error?: string }> = []

  for (const item of due ?? []) {
    const lineUser = item.line_users as {
      id: string
      line_user_id: string
      channel_id: string | null
    } | null

    if (!lineUser?.line_user_id) {
      await supabase
        .from('scheduled_messages')
        .update({ status: 'failed', error_message: 'Missing line user' })
        .eq('id', item.id)
      results.push({ id: item.id, status: 'failed', error: 'Missing line user' })
      continue
    }

    if (!lineUser.channel_id) {
      await supabase
        .from('scheduled_messages')
        .update({ status: 'failed', error_message: 'LINE user has no channel' })
        .eq('id', item.id)
      results.push({ id: item.id, status: 'failed', error: 'LINE user has no channel' })
      continue
    }

    try {
      const channel = await getChannelById(lineUser.channel_id)
      if (!channel) throw new Error('Channel not found or inactive')

      await linePushText(lineUser.line_user_id, item.content, channel.channel_access_token)
      await recordOutgoingMessage({
        lineUserUuid: lineUser.id,
        content: item.content,
        status: 'sent',
      })
      await supabase
        .from('scheduled_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', item.id)
      results.push({ id: item.id, status: 'sent' })
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err)
      await supabase
        .from('scheduled_messages')
        .update({ status: 'failed', error_message: messageText })
        .eq('id', item.id)
      results.push({ id: item.id, status: 'failed', error: messageText })
    }
  }

  return jsonResponse({ ok: true, processed: results.length, results })
})
