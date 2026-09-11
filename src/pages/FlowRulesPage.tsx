import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppHeader } from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Flow, FlowStep, FlowStepType, LineChannelListItem } from '../types/database'

const STEP_TYPE_LABEL: Record<string, string> = {
  text: '純文字（說明 + 一個填寫框）',
  buttons: 'Buttons（最多 4 個按鈕）',
  confirm: 'Confirm（2 個確認按鈕）',
  flex: 'Flex Message（自訂）',
  // legacy display
  send_text: '（舊）只傳送說明文字',
  ask_text: '（舊）請使用者輸入文字',
  ask_choice: '（舊）選項',
  ask_date: '（舊）選日期',
  ask_time: '（舊）選時間',
}

const NEW_STEP_TYPES: FlowStepType[] = ['text', 'buttons', 'confirm', 'flex']

export function FlowRulesPage() {
  const [channels, setChannels] = useState<LineChannelListItem[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [steps, setSteps] = useState<FlowStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [flowName, setFlowName] = useState('')
  const [triggerText, setTriggerText] = useState('')
  const [matchMode, setMatchMode] = useState<'exact' | 'contains'>('exact')
  const [channelId, setChannelId] = useState('')

  const [stepKey, setStepKey] = useState('')
  const [stepType, setStepType] = useState<FlowStepType>('text')
  const [promptText, setPromptText] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [choicesText, setChoicesText] = useState('')
  const [confirmA, setConfirmA] = useState('是')
  const [confirmB, setConfirmB] = useState('否')
  const [flexJson, setFlexJson] = useState('')

  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  )

  const channelMap = useMemo(() => {
    const map = new Map<string, LineChannelListItem>()
    for (const c of channels) map.set(c.id, c)
    return map
  }, [channels])

  function channelApplyLabel(channelIdValue: string | null) {
    if (!channelIdValue) return '全部 Channel'
    const ch = channelMap.get(channelIdValue)
    if (!ch) return '未知 Channel（可能已刪除）'
    if (ch.name?.trim()) return ch.name.trim()
    if (ch.is_owner && ch.webhook_key && ch.webhook_key !== '***') return ch.webhook_key
    return '未命名 Channel'
  }

  async function loadFlows() {
    const [{ data: flowRows, error: flowErr }, { data: channelRows, error: channelErr }] =
      await Promise.all([
        supabase.from('flows').select('*').order('created_at', { ascending: false }),
        supabase.from('line_channels_list').select('*').order('name', { ascending: true }),
      ])
    if (flowErr || channelErr) {
      setError(flowErr?.message || channelErr?.message || '載入失敗')
      return
    }
    setFlows(flowRows ?? [])
    setChannels((channelRows as LineChannelListItem[]) ?? [])
    setError(null)
    if (selectedFlowId && flowRows && !flowRows.some((f) => f.id === selectedFlowId)) {
      setSelectedFlowId(null)
    }
  }

  async function loadSteps(flowId: string) {
    const { data, error: stepErr } = await supabase
      .from('flow_steps')
      .select('*')
      .eq('flow_id', flowId)
      .order('sort_order', { ascending: true })
    if (stepErr) {
      setError(stepErr.message)
      return
    }
    setSteps(data ?? [])
  }

  useEffect(() => {
    void loadFlows()
  }, [])

  useEffect(() => {
    if (selectedFlowId) void loadSteps(selectedFlowId)
    else setSteps([])
  }, [selectedFlowId])

  async function createFlow(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { data, error: insertErr } = await supabase
      .from('flows')
      .insert({
        name: flowName.trim(),
        trigger_text: triggerText.trim(),
        match_mode: matchMode,
        channel_id: channelId || null,
        is_active: true,
      })
      .select('*')
      .single()
    setSaving(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    await loadFlows()
    if (data) setSelectedFlowId(data.id)
  }

  async function addStep(e: FormEvent) {
    e.preventDefault()
    if (!selectedFlowId || !promptText.trim()) return
    setSaving(true)
    setError(null)

    const key = stepKey.trim() || `step_${steps.length + 1}`
    let choices: { label: string; value: string }[] = []
    let flexPayload: Record<string, unknown> | null = null

    if (stepType === 'buttons') {
      choices = choicesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map((line) => {
          const [label, value] = line.split('|').map((s) => s.trim())
          return { label: label || line, value: value || label || line }
        })
      if (choices.length < 1) {
        setSaving(false)
        setError('Buttons 至少需要 1 個按鈕，最多 4 個（一行一個）')
        return
      }
    }

    if (stepType === 'confirm') {
      const a = confirmA.trim() || '是'
      const b = confirmB.trim() || '否'
      choices = [
        { label: a.slice(0, 20), value: a },
        { label: b.slice(0, 20), value: b },
      ]
    }

    if (stepType === 'flex') {
      try {
        const parsed = JSON.parse(flexJson) as Record<string, unknown>
        flexPayload = parsed
      } catch {
        setSaving(false)
        setError('Flex JSON 格式錯誤，請貼上有效的 Flex Message contents')
        return
      }
    }

    const { error: insertErr } = await supabase.from('flow_steps').insert({
      flow_id: selectedFlowId,
      step_key: key,
      sort_order: steps.length + 1,
      step_type: stepType,
      prompt_text: promptText.trim(),
      field_key: fieldKey.trim() || null,
      choices,
      flex_json: flexPayload,
    })
    setSaving(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setStepKey('')
    setPromptText('')
    setFieldKey('')
    setChoicesText('')
    setFlexJson('')
    await loadSteps(selectedFlowId)
  }

  async function removeStep(id: string) {
    if (!selectedFlowId || !confirm('刪除此步驟？')) return
    const { error: delErr } = await supabase.from('flow_steps').delete().eq('id', id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await loadSteps(selectedFlowId)
  }

  async function moveStep(id: string, direction: -1 | 1) {
    if (!selectedFlowId) return
    const index = steps.findIndex((s) => s.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= steps.length) return

    const a = steps[index]
    const b = steps[target]
    await Promise.all([
      supabase.from('flow_steps').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('flow_steps').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    // normalize
    const reordered = [...steps]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    await Promise.all(
      reordered.map((s, i) =>
        supabase.from('flow_steps').update({ sort_order: i + 1 }).eq('id', s.id),
      ),
    )
    await loadSteps(selectedFlowId)
  }

  async function toggleFlow(flow: Flow) {
    const { error: updateErr } = await supabase
      .from('flows')
      .update({ is_active: !flow.is_active })
      .eq('id', flow.id)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await loadFlows()
  }

  async function removeFlow(id: string) {
    if (!confirm('刪除此流程與全部步驟？')) return
    const { error: delErr } = await supabase.from('flows').delete().eq('id', id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    if (selectedFlowId === id) setSelectedFlowId(null)
    await loadFlows()
  }

  return (
    <div className="app-shell">
      <AppHeader active="flows" />

      <div className="accounts-layout">
        <section className="accounts-panel">
          <h2>流程列表</h2>
          <p className="muted">設定觸發條件與步驟；每個流程可指定套用的 Channel。</p>

          <form className="channel-form" onSubmit={(e) => void createFlow(e)}>
            <label>
              流程名稱
              <input value={flowName} onChange={(e) => setFlowName(e.target.value)} required />
            </label>
            <label>
              觸發文字（使用者輸入）
              <input value={triggerText} onChange={(e) => setTriggerText(e.target.value)} required />
            </label>
            <label>
              比對方式
              <select
                value={matchMode}
                onChange={(e) => setMatchMode(e.target.value as 'exact' | 'contains')}
              >
                <option value="exact">完全相等</option>
                <option value="contains">包含關鍵字</option>
              </select>
            </label>
            <label>
              套用 Channel（這個流程給誰用）
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">全部 Channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name?.trim() ||
                      (c.is_owner && c.webhook_key !== '***' ? c.webhook_key : '未命名 Channel')}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={saving}>
              {saving ? '儲存中…' : '新增流程'}
            </button>
          </form>

          <ul className="channel-list">
            {flows.map((f) => {
              const selected = f.id === selectedFlowId
              return (
                <li
                  key={f.id}
                  className={selected ? 'channel-item flow-item flow-item-selected' : 'channel-item flow-item'}
                >
                  <button
                    type="button"
                    className={selected ? 'conv-item active' : 'conv-item'}
                    onClick={() => setSelectedFlowId(f.id)}
                    style={{ border: 'none', width: '100%' }}
                  >
                    <span className="flow-item-title-row">
                      <strong>{f.name}</strong>
                      {selected && <span className="badge status-editing">編輯中</span>}
                    </span>
                    <span className="muted">
                      套用：{channelApplyLabel(f.channel_id)} · 觸發「{f.trigger_text}」·{' '}
                      {f.is_active ? '啟用' : '停用'}
                    </span>
                  </button>
                  <div className="channel-actions">
                    <button type="button" className="ghost" onClick={() => void toggleFlow(f)}>
                      {f.is_active ? '停用' : '啟用'}
                    </button>
                    <button type="button" className="ghost" onClick={() => void removeFlow(f.id)}>
                      刪除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="accounts-panel">
          <h2>
            {selectedFlow ? (
              <>
                目前流程：<span className="current-flow-name">{selectedFlow.name}</span>
              </>
            ) : (
              '步驟設定'
            )}
          </h2>
          {!selectedFlow && (
            <div className="empty-state flow-empty">
              請先在左側選擇一個流程
            </div>
          )}

          {selectedFlow && (
            <>
              <p className="flow-apply-banner">
                <strong>正在編輯流程：</strong>
                {selectedFlow.name}
                <br />
                <span className="muted">
                  觸發「{selectedFlow.trigger_text}」· 套用：{channelApplyLabel(selectedFlow.channel_id)}
                </span>
              </p>
              <p className="muted">
                以下步驟屬於上方這個流程。請確認左側已標示「編輯中」，避免改錯流程。
              </p>

              <label>
                變更套用 Channel
                <select
                  value={selectedFlow.channel_id ?? ''}
                  onChange={(e) => {
                    void (async () => {
                      const next = e.target.value || null
                      const { error: updateErr } = await supabase
                        .from('flows')
                        .update({ channel_id: next })
                        .eq('id', selectedFlow.id)
                      if (updateErr) {
                        setError(updateErr.message)
                        return
                      }
                      await loadFlows()
                    })()
                  }}
                >
                  <option value="">全部 Channel</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name?.trim() ||
                        (c.is_owner && c.webhook_key !== '***' ? c.webhook_key : '未命名 Channel')}
                    </option>
                  ))}
                </select>
              </label>

              <ol className="step-list">
                {steps.map((s, idx) => (
                  <li key={s.id} className="schedule-item">
                    <div>
                      <strong>
                        {idx + 1}. [{STEP_TYPE_LABEL[s.step_type] ?? s.step_type}] {s.step_key}
                      </strong>
                    </div>
                    <p>{s.prompt_text}</p>
                    {s.field_key && <p className="muted">存成欄位：{s.field_key}</p>}
                    {(s.step_type === 'buttons' ||
                      s.step_type === 'confirm' ||
                      s.step_type === 'ask_choice') &&
                      Array.isArray(s.choices) && (
                        <p className="muted">
                          按鈕：
                          {(s.choices as { label: string; value: string }[])
                            .map((c) => c.label)
                            .join('、')}
                        </p>
                      )}
                    {s.step_type === 'flex' && <p className="muted">Flex Message（自訂 JSON）</p>}
                    <div className="channel-actions">
                      <button type="button" className="ghost" onClick={() => void moveStep(s.id, -1)}>
                        上移
                      </button>
                      <button type="button" className="ghost" onClick={() => void moveStep(s.id, 1)}>
                        下移
                      </button>
                      <button type="button" className="ghost" onClick={() => void removeStep(s.id)}>
                        刪除
                      </button>
                    </div>
                  </li>
                ))}
              </ol>

              <form className="channel-form" onSubmit={(e) => void addStep(e)}>
                <h3>新增步驟</h3>
                <label>
                  步驟類型
                  <select
                    value={stepType}
                    onChange={(e) => setStepType(e.target.value as FlowStepType)}
                  >
                    {NEW_STEP_TYPES.map((k) => (
                      <option key={k} value={k}>
                        {STEP_TYPE_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  步驟代碼（選填）
                  <input
                    value={stepKey}
                    onChange={(e) => setStepKey(e.target.value)}
                    placeholder="例如 step_1"
                  />
                </label>

                {stepType === 'text' && (
                  <>
                    <label>
                      說明文字（會先傳給使用者）
                      <textarea
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        rows={3}
                        required
                        placeholder="請輸入要顯示的說明，使用者接著會回覆一個填寫框內容"
                      />
                    </label>
                    <label>
                      答案存成欄位名（選填）
                      <input
                        value={fieldKey}
                        onChange={(e) => setFieldKey(e.target.value)}
                        placeholder="例如：備註"
                      />
                    </label>
                  </>
                )}

                {stepType === 'buttons' && (
                  <>
                    <label>
                      按鈕上方說明文字
                      <textarea
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        rows={2}
                        required
                      />
                    </label>
                    <label>
                      按鈕（最多 4 個，一行一個；可用 顯示|值）
                      <textarea
                        value={choicesText}
                        onChange={(e) => setChoicesText(e.target.value)}
                        rows={4}
                        required
                        placeholder={'選項A\n選項B\n選項C\n選項D'}
                      />
                    </label>
                    <label>
                      答案存成欄位名（選填）
                      <input
                        value={fieldKey}
                        onChange={(e) => setFieldKey(e.target.value)}
                        placeholder="例如：選項"
                      />
                    </label>
                  </>
                )}

                {stepType === 'confirm' && (
                  <>
                    <label>
                      確認說明文字
                      <textarea
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        rows={2}
                        required
                        placeholder="例如：確定要送出嗎？"
                      />
                    </label>
                    <label>
                      按鈕 1
                      <input value={confirmA} onChange={(e) => setConfirmA(e.target.value)} required />
                    </label>
                    <label>
                      按鈕 2
                      <input value={confirmB} onChange={(e) => setConfirmB(e.target.value)} required />
                    </label>
                    <label>
                      答案存成欄位名（選填）
                      <input
                        value={fieldKey}
                        onChange={(e) => setFieldKey(e.target.value)}
                        placeholder="例如：確認結果"
                      />
                    </label>
                  </>
                )}

                {stepType === 'flex' && (
                  <>
                    <label>
                      altText（無法顯示 Flex 時的替代文字）
                      <input
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        required
                        placeholder="例如：自訂訊息"
                      />
                    </label>
                    <label>
                      Flex Message contents（JSON）
                      <textarea
                        value={flexJson}
                        onChange={(e) => setFlexJson(e.target.value)}
                        rows={10}
                        required
                        placeholder='{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"Hello"}]}}'
                      />
                    </label>
                    <label>
                      答案存成欄位名（選填）
                      <input
                        value={fieldKey}
                        onChange={(e) => setFieldKey(e.target.value)}
                        placeholder="使用者回覆或 postback 會存這裡"
                      />
                    </label>
                  </>
                )}

                <button type="submit" disabled={saving}>
                  {saving ? '儲存中…' : '加入步驟'}
                </button>
              </form>
            </>
          )}

          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </div>
  )
}
