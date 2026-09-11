import {
  corsPreflight,
  getChannelByWebhookKey,
  jsonResponse,
  upsertIncomingMessage,
  verifyLineSignature,
} from '../_shared/line.ts'
import { handleFlowIncoming, handleFlowPostback } from '../_shared/flow.ts'

type LineEvent = {
  type: string
  replyToken?: string
  source?: { userId?: string; type?: string }
  message?: {
    id?: string
    type?: string
    text?: string
  }
  postback?: {
    data?: string
    params?: {
      date?: string
      time?: string
      datetime?: string
    }
  }
  timestamp?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const url = new URL(req.url)
  const webhookKey = url.searchParams.get('key')?.trim()
  if (!webhookKey) {
    return jsonResponse({ error: 'Missing webhook key. Use ?key=YOUR_WEBHOOK_KEY' }, 400)
  }

  const channel = await getChannelByWebhookKey(webhookKey)
  if (!channel) return jsonResponse({ error: 'Unknown or inactive webhook key' }, 404)

  const rawBody = await req.text()
  const signature = req.headers.get('x-line-signature')
  const ok = await verifyLineSignature(rawBody, signature, channel.channel_secret)
  if (!ok) return jsonResponse({ error: 'Invalid signature' }, 401)

  let payload: { events?: LineEvent[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const events = payload.events ?? []

  for (const event of events) {
    const lineUserId = event.source?.userId
    if (!lineUserId) continue

    try {
      if (event.type === 'message' && event.message) {
        const messageType = event.message.type ?? 'text'
        let content = ''
        if (messageType === 'text') {
          content = event.message.text ?? ''
        } else {
          content = `[${messageType}]`
        }
        if (!content) continue

        const saved = await upsertIncomingMessage({
          channelId: channel.id,
          accessToken: channel.channel_access_token,
          lineUserId,
          content,
          messageType,
          lineMessageId: event.message.id ?? null,
        })

        if (messageType === 'text') {
          await handleFlowIncoming({
            channel,
            lineUserId,
            lineUserUuid: saved.user.id,
            text: content,
            replyToken: event.replyToken,
          })
        }
      } else if (event.type === 'postback' && event.postback) {
        const saved = await upsertIncomingMessage({
          channelId: channel.id,
          accessToken: channel.channel_access_token,
          lineUserId,
          content: `[選擇] ${event.postback.params?.date || event.postback.params?.time || event.postback.data || ''}`,
          messageType: 'postback',
          lineMessageId: null,
        })

        await handleFlowPostback({
          channel,
          lineUserId,
          lineUserUuid: saved.user.id,
          data: event.postback.data ?? '',
          paramsDate: event.postback.params?.date,
          paramsTime: event.postback.params?.time,
          paramsDatetime: event.postback.params?.datetime,
          replyToken: event.replyToken,
        })
      } else if (event.type === 'follow') {
        await upsertIncomingMessage({
          channelId: channel.id,
          accessToken: channel.channel_access_token,
          lineUserId,
          content: '[使用者加入好友]',
          messageType: 'system',
          lineMessageId: null,
        })
      } else if (event.type === 'unfollow') {
        await upsertIncomingMessage({
          channelId: channel.id,
          accessToken: channel.channel_access_token,
          lineUserId,
          content: '[使用者封鎖或取消好友]',
          messageType: 'system',
          lineMessageId: null,
        })
      }
    } catch (err) {
      console.error('Failed to process LINE event', err)
    }
  }

  return jsonResponse({ ok: true })
})
