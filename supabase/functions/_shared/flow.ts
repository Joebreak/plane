import {
  getServiceClient,
  linePushMessages,
  lineReplyMessages,
  recordOutgoingMessage,
  type LineChannel,
} from './line.ts'

export type FlowChoice = { label: string; value: string }

export type FlowStepType =
  | 'text'
  | 'buttons'
  | 'confirm'
  | 'flex'
  // legacy (still readable)
  | 'send_text'
  | 'ask_text'
  | 'ask_choice'
  | 'ask_date'
  | 'ask_time'

export type FlowStep = {
  id: string
  flow_id: string
  step_key: string
  sort_order: number
  step_type: FlowStepType
  prompt_text: string
  field_key: string | null
  choices: FlowChoice[] | null
  flex_json?: Record<string, unknown> | null
}

export type FlowDef = {
  id: string
  channel_id: string | null
  name: string
  trigger_text: string
  match_mode: 'exact' | 'contains'
  is_active: boolean
}

export type FlowSession = {
  id: string
  line_user_id: string
  channel_id: string
  flow_id: string
  current_step_key: string | null
  answers: Record<string, string>
  status: 'active' | 'completed' | 'cancelled'
}

function previewOfMessages(messages: Record<string, unknown>[]) {
  const first = messages[0]
  if (!first) return ''
  if (typeof first.text === 'string') return first.text
  if (first.type === 'template' || first.type === 'flex') return String(first.altText ?? '[訊息]')
  return '[訊息]'
}

function messageActions(choices: FlowChoice[], limit: number) {
  return choices.slice(0, limit).map((c) => ({
    type: 'message',
    label: c.label.slice(0, 20),
    text: c.value.slice(0, 300),
  }))
}

export function buildStepMessages(step: FlowStep): Record<string, unknown>[] {
  const choices = step.choices ?? []

  if (step.step_type === 'buttons' || step.step_type === 'ask_choice') {
    const actions = messageActions(choices, 4)
    if (actions.length === 0) {
      return [{ type: 'text', text: step.prompt_text }]
    }
    return [
      {
        type: 'template',
        altText: step.prompt_text,
        template: {
          type: 'buttons',
          text: step.prompt_text.slice(0, 160),
          actions,
        },
      },
    ]
  }

  if (step.step_type === 'confirm') {
    const actions = messageActions(choices, 2)
    while (actions.length < 2) {
      actions.push({
        type: 'message',
        label: actions.length === 0 ? '是' : '否',
        text: actions.length === 0 ? '是' : '否',
      })
    }
    return [
      {
        type: 'template',
        altText: step.prompt_text,
        template: {
          type: 'confirm',
          text: step.prompt_text.slice(0, 240),
          actions,
        },
      },
    ]
  }

  if (step.step_type === 'flex') {
    const contents = step.flex_json
    if (!contents || typeof contents !== 'object') {
      return [{ type: 'text', text: step.prompt_text || '（Flex 尚未設定）' }]
    }
    return [
      {
        type: 'flex',
        altText: step.prompt_text || '訊息',
        contents,
      },
    ]
  }

  if (step.step_type === 'ask_date') {
    return [
      {
        type: 'template',
        altText: step.prompt_text,
        template: {
          type: 'buttons',
          text: step.prompt_text.slice(0, 160),
          actions: [
            {
              type: 'datetimepicker',
              label: '選擇日期',
              data: `flow_step=${step.step_key}&mode=date`,
              mode: 'date',
            },
          ],
        },
      },
    ]
  }

  if (step.step_type === 'ask_time') {
    return [
      {
        type: 'template',
        altText: step.prompt_text,
        template: {
          type: 'buttons',
          text: step.prompt_text.slice(0, 160),
          actions: [
            {
              type: 'datetimepicker',
              label: '選擇時間',
              data: `flow_step=${step.step_key}&mode=time`,
              mode: 'time',
            },
          ],
        },
      },
    ]
  }

  // text / ask_text / send_text
  return [{ type: 'text', text: step.prompt_text }]
}

function isChoiceStep(step: FlowStep) {
  return (
    step.step_type === 'buttons' ||
    step.step_type === 'confirm' ||
    step.step_type === 'ask_choice'
  )
}

function isTextAnswerStep(step: FlowStep) {
  return (
    step.step_type === 'text' ||
    step.step_type === 'ask_text' ||
    step.step_type === 'flex' ||
    step.step_type === 'ask_date' ||
    step.step_type === 'ask_time' ||
    step.step_type === 'send_text'
  )
}

async function loadSteps(flowId: string): Promise<FlowStep[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('flow_steps')
    .select('*')
    .eq('flow_id', flowId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data as FlowStep[]) ?? []
}

async function findTriggerFlow(channelId: string, text: string): Promise<FlowDef | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('flows')
    .select('*')
    .eq('is_active', true)
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .order('created_at', { ascending: true })
  if (error) throw error

  const incoming = text.trim()
  for (const flow of (data as FlowDef[]) ?? []) {
    const trigger = flow.trigger_text.trim()
    if (!trigger) continue
    if (flow.match_mode === 'exact' && incoming === trigger) return flow
    if (flow.match_mode === 'contains' && incoming.includes(trigger)) return flow
  }
  return null
}

async function getActiveSession(lineUserUuid: string): Promise<FlowSession | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('flow_sessions')
    .select('*')
    .eq('line_user_id', lineUserUuid)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as FlowSession | null
}

async function sendBotMessages(params: {
  channel: LineChannel
  lineUserId: string
  lineUserUuid: string
  replyToken?: string
  messages: Record<string, unknown>[]
}) {
  if (params.replyToken) {
    await lineReplyMessages(params.replyToken, params.messages, params.channel.channel_access_token)
  } else {
    await linePushMessages(params.lineUserId, params.messages, params.channel.channel_access_token)
  }
  await recordOutgoingMessage({
    lineUserUuid: params.lineUserUuid,
    content: previewOfMessages(params.messages),
    status: 'sent',
  })
}

async function presentStep(params: {
  channel: LineChannel
  lineUserId: string
  lineUserUuid: string
  sessionId: string
  steps: FlowStep[]
  startFrom: FlowStep
  replyToken?: string
  answers?: Record<string, string>
}) {
  const supabase = getServiceClient()
  const messages: Record<string, unknown>[] = []
  let cursor: FlowStep | undefined = params.startFrom
  let lastAsk: FlowStep | undefined

  while (cursor) {
    messages.push(...buildStepMessages(cursor))
    if (cursor.step_type === 'send_text') {
      const i = params.steps.findIndex((s) => s.step_key === cursor!.step_key)
      cursor = params.steps[i + 1]
      if (!cursor) {
        await supabase
          .from('flow_sessions')
          .update({
            status: 'completed',
            current_step_key: null,
            answers: params.answers ?? {},
          })
          .eq('id', params.sessionId)
        break
      }
      continue
    }
    lastAsk = cursor
    await supabase
      .from('flow_sessions')
      .update({ current_step_key: cursor.step_key })
      .eq('id', params.sessionId)
    break
  }

  if (messages.length === 0 && lastAsk) {
    messages.push(...buildStepMessages(lastAsk))
  }

  if (messages.length > 0) {
    await sendBotMessages({
      channel: params.channel,
      lineUserId: params.lineUserId,
      lineUserUuid: params.lineUserUuid,
      replyToken: params.replyToken,
      messages: messages.slice(0, 5),
    })
  }
}

export async function handleFlowIncoming(params: {
  channel: LineChannel
  lineUserId: string
  lineUserUuid: string
  text: string
  replyToken?: string
}) {
  const supabase = getServiceClient()
  const incoming = params.text.trim()

  // Cancel keyword
  if (incoming === '取消' || incoming.toLowerCase() === 'cancel') {
    const active = await getActiveSession(params.lineUserUuid)
    if (active) {
      await supabase
        .from('flow_sessions')
        .update({ status: 'cancelled', current_step_key: null })
        .eq('id', active.id)
      await sendBotMessages({
        channel: params.channel,
        lineUserId: params.lineUserId,
        lineUserUuid: params.lineUserUuid,
        replyToken: params.replyToken,
        messages: [{ type: 'text', text: '已取消目前流程。' }],
      })
      return true
    }
  }

  const session = await getActiveSession(params.lineUserUuid)
  if (session) {
    const steps = await loadSteps(session.flow_id)
    const current = steps.find((s) => s.step_key === session.current_step_key)
    if (!current) {
      await supabase.from('flow_sessions').update({ status: 'cancelled' }).eq('id', session.id)
      return false
    }

    if (isChoiceStep(current)) {
      const choices = current.choices ?? []
      const matched = choices.find(
        (c) => c.value === incoming || c.label === incoming,
      )
      if (!matched) {
        await sendBotMessages({
          channel: params.channel,
          lineUserId: params.lineUserId,
          lineUserUuid: params.lineUserUuid,
          replyToken: params.replyToken,
          messages: buildStepMessages(current),
        })
        return true
      }
      await saveAnswerAndContinue({
        channel: params.channel,
        lineUserId: params.lineUserId,
        lineUserUuid: params.lineUserUuid,
        session,
        steps,
        current,
        answer: matched.value,
        replyToken: params.replyToken,
      })
      return true
    }

    if (isTextAnswerStep(current)) {
      await saveAnswerAndContinue({
        channel: params.channel,
        lineUserId: params.lineUserId,
        lineUserUuid: params.lineUserUuid,
        session,
        steps,
        current,
        answer: incoming,
        replyToken: params.replyToken,
      })
      return true
    }

    await saveAnswerAndContinue({
      channel: params.channel,
      lineUserId: params.lineUserId,
      lineUserUuid: params.lineUserUuid,
      session,
      steps,
      current,
      answer: incoming,
      replyToken: params.replyToken,
    })
    return true
  }

  // Start new flow by trigger
  const flow = await findTriggerFlow(params.channel.id, incoming)
  if (!flow) return false

  const steps = await loadSteps(flow.id)
  if (steps.length === 0) {
    await sendBotMessages({
      channel: params.channel,
      lineUserId: params.lineUserId,
      lineUserUuid: params.lineUserUuid,
      replyToken: params.replyToken,
      messages: [{ type: 'text', text: `已觸發「${flow.name}」，但尚未設定步驟。` }],
    })
    return true
  }

  const { data: created, error } = await supabase
    .from('flow_sessions')
    .insert({
      line_user_id: params.lineUserUuid,
      channel_id: params.channel.id,
      flow_id: flow.id,
      current_step_key: steps[0].step_key,
      answers: {},
      status: 'active',
    })
    .select('*')
    .single()
  if (error || !created) throw error ?? new Error('create session failed')

  await presentStep({
    channel: params.channel,
    lineUserId: params.lineUserId,
    lineUserUuid: params.lineUserUuid,
    sessionId: created.id,
    steps,
    startFrom: steps[0],
    replyToken: params.replyToken,
  })
  return true
}

export async function handleFlowPostback(params: {
  channel: LineChannel
  lineUserId: string
  lineUserUuid: string
  data: string
  paramsDate?: string
  paramsTime?: string
  paramsDatetime?: string
  replyToken?: string
}) {
  const session = await getActiveSession(params.lineUserUuid)
  if (!session) return false

  const steps = await loadSteps(session.flow_id)
  const current = steps.find((s) => s.step_key === session.current_step_key)
  if (!current) return false

  let answer = ''
  if (current.step_type === 'ask_date') {
    answer = params.paramsDate || params.paramsDatetime || ''
  } else if (current.step_type === 'ask_time') {
    answer = params.paramsTime || params.paramsDatetime || ''
  } else if (current.step_type === 'flex') {
    answer = params.paramsDate || params.paramsTime || params.paramsDatetime || params.data || ''
  } else {
    return false
  }
  if (!answer) return false

  await saveAnswerAndContinue({
    channel: params.channel,
    lineUserId: params.lineUserId,
    lineUserUuid: params.lineUserUuid,
    session,
    steps,
    current,
    answer,
    replyToken: params.replyToken,
  })
  return true
}

async function saveAnswerAndContinue(params: {
  channel: LineChannel
  lineUserId: string
  lineUserUuid: string
  session: FlowSession
  steps: FlowStep[]
  current: FlowStep
  answer: string
  replyToken?: string
}) {
  const supabase = getServiceClient()
  const answers = { ...(params.session.answers ?? {}) }
  if (params.current.field_key) {
    answers[params.current.field_key] = params.answer
  }

  const idx = params.steps.findIndex((s) => s.step_key === params.current.step_key)
  const next = idx >= 0 ? params.steps[idx + 1] : undefined

  if (!next) {
    await supabase
      .from('flow_sessions')
      .update({
        status: 'completed',
        current_step_key: null,
        answers,
      })
      .eq('id', params.session.id)

    const summaryLines = Object.entries(answers).map(([k, v]) => `・${k}：${v}`)
    await sendBotMessages({
      channel: params.channel,
      lineUserId: params.lineUserId,
      lineUserUuid: params.lineUserUuid,
      replyToken: params.replyToken,
      messages: [
        {
          type: 'text',
          text:
            summaryLines.length > 0
              ? `已完成填寫，資料如下：\n${summaryLines.join('\n')}`
              : '已完成流程，謝謝。',
        },
      ],
    })
    return
  }

  await supabase
    .from('flow_sessions')
    .update({
      current_step_key: next.step_key,
      answers,
    })
    .eq('id', params.session.id)

  await presentStep({
    channel: params.channel,
    lineUserId: params.lineUserId,
    lineUserUuid: params.lineUserUuid,
    sessionId: params.session.id,
    steps: params.steps,
    startFrom: next,
    replyToken: params.replyToken,
    answers,
  })
}
