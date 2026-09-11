import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

export type LineChannel = {
  id: string
  name: string
  webhook_key: string
  channel_access_token: string
  channel_secret: string
  is_active: boolean
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  })
}

export function corsPreflight() {
  return new Response('ok', {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

export function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

export async function getChannelByWebhookKey(webhookKey: string): Promise<LineChannel | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('line_channels')
    .select('*')
    .eq('webhook_key', webhookKey)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data as LineChannel | null
}

export async function getChannelById(channelId: string): Promise<LineChannel | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('line_channels')
    .select('*')
    .eq('id', channelId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data as LineChannel | null
}

export async function verifyLineSignature(
  body: string,
  signature: string | null,
  channelSecret: string,
): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const digest = btoa(String.fromCharCode(...new Uint8Array(mac)))
  return digest === signature
}

export async function linePushText(
  lineUserId: string,
  text: string,
  accessToken: string,
) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text }],
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`LINE push failed (${res.status}): ${raw}`)
  }
  return raw ? JSON.parse(raw) : {}
}

export async function lineReplyText(
  replyToken: string,
  text: string,
  accessToken: string,
) {
  return lineReplyMessages(replyToken, [{ type: 'text', text }], accessToken)
}

export async function lineReplyMessages(
  replyToken: string,
  messages: Record<string, unknown>[],
  accessToken: string,
) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`LINE reply failed (${res.status}): ${raw}`)
  }
  return raw ? JSON.parse(raw) : {}
}

export async function linePushMessages(
  lineUserId: string,
  messages: Record<string, unknown>[],
  accessToken: string,
) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages,
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`LINE push failed (${res.status}): ${raw}`)
  }
  return raw ? JSON.parse(raw) : {}
}

export async function fetchLineProfile(lineUserId: string, accessToken: string) {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return await res.json() as {
    userId: string
    displayName?: string
    pictureUrl?: string
    statusMessage?: string
  }
}

export async function upsertIncomingMessage(params: {
  channelId: string
  accessToken: string
  lineUserId: string
  content: string
  messageType?: string
  lineMessageId?: string | null
}) {
  const supabase = getServiceClient()
  const profile = await fetchLineProfile(params.lineUserId, params.accessToken)
  const now = new Date().toISOString()

  const existing = await supabase
    .from('line_users')
    .select('*')
    .eq('channel_id', params.channelId)
    .eq('line_user_id', params.lineUserId)
    .maybeSingle()

  let userRow = existing.data
  if (userRow) {
    const updated = await supabase
      .from('line_users')
      .update({
        display_name: profile?.displayName ?? userRow.display_name,
        picture_url: profile?.pictureUrl ?? userRow.picture_url,
        status_message: profile?.statusMessage ?? userRow.status_message,
        last_interaction_at: now,
        updated_at: now,
      })
      .eq('id', userRow.id)
      .select('*')
      .single()
    if (updated.error || !updated.data) throw updated.error ?? new Error('Failed to update line_users')
    userRow = updated.data
  } else {
    const inserted = await supabase
      .from('line_users')
      .insert({
        channel_id: params.channelId,
        line_user_id: params.lineUserId,
        display_name: profile?.displayName ?? null,
        picture_url: profile?.pictureUrl ?? null,
        status_message: profile?.statusMessage ?? null,
        last_interaction_at: now,
        updated_at: now,
      })
      .select('*')
      .single()
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error('Failed to insert line_users')
    userRow = inserted.data
  }

  const { data: conversationId, error: convFnErr } = await supabase.rpc('ensure_conversation', {
    p_line_user_uuid: userRow.id,
  })

  let convId = conversationId as string | null
  if (convFnErr || !convId) {
    const existingConv = await supabase
      .from('conversations')
      .select('id')
      .eq('line_user_id', userRow.id)
      .maybeSingle()
    convId = existingConv.data?.id ?? null
    if (!convId) {
      const inserted = await supabase
        .from('conversations')
        .insert({ line_user_id: userRow.id })
        .select('id')
        .single()
      if (inserted.error || !inserted.data) throw inserted.error ?? new Error('conversation insert failed')
      convId = inserted.data.id
    }
  }

  const { data: message, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convId,
      line_user_id: userRow.id,
      direction: 'in',
      content: params.content,
      message_type: params.messageType ?? 'text',
      line_message_id: params.lineMessageId ?? null,
      status: 'received',
    })
    .select('*')
    .single()
  if (msgErr) throw msgErr

  await supabase
    .from('conversations')
    .update({
      last_message_at: now,
      last_message_preview: params.content.slice(0, 120),
      updated_at: now,
    })
    .eq('id', convId)

  return { user: userRow, conversationId: convId, message }
}

export async function recordOutgoingMessage(params: {
  lineUserUuid: string
  content: string
  status: 'sent' | 'failed'
}) {
  const supabase = getServiceClient()
  const now = new Date().toISOString()

  const { data: conversationId, error: convFnErr } = await supabase.rpc('ensure_conversation', {
    p_line_user_uuid: params.lineUserUuid,
  })

  let convId = conversationId as string | null
  if (convFnErr || !convId) {
    const existing = await supabase
      .from('conversations')
      .select('id')
      .eq('line_user_id', params.lineUserUuid)
      .maybeSingle()
    convId = existing.data?.id ?? null
    if (!convId) {
      const inserted = await supabase
        .from('conversations')
        .insert({ line_user_id: params.lineUserUuid })
        .select('id')
        .single()
      if (inserted.error || !inserted.data) throw inserted.error ?? new Error('conversation insert failed')
      convId = inserted.data.id
    }
  }

  const { data: message, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convId,
      line_user_id: params.lineUserUuid,
      direction: 'out',
      content: params.content,
      message_type: 'text',
      status: params.status,
    })
    .select('*')
    .single()
  if (msgErr) throw msgErr

  await supabase
    .from('conversations')
    .update({
      last_message_at: now,
      last_message_preview: params.content.slice(0, 120),
      updated_at: now,
    })
    .eq('id', convId)

  return message
}
