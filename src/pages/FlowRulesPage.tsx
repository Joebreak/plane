import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppHeader } from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { Flow, FlowStep, FlowStepType, LineChannel } from '../types/database'

const STEP_TYPE_LABEL: Record<FlowStepType, string> = {
  send_text: '只傳送說明文字',
  ask_text: '請使用者輸入文字',
  ask_choice: '請使用者選項（假別等）',
  ask_date: '請使用者選日期（LINE 日期表）',
  ask_time: '請使用者選時間（LINE 時間表）',
}

export function FlowRulesPage() {
  const [channels, setChannels] = useState<LineChannel[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [steps, setSteps] = useState<FlowStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [flowName, setFlowName] = useState('請假申請')
  const [triggerText, setTriggerText] = useState('請假')
  const [matchMode, setMatchMode] = useState<'exact' | 'contains'>('exact')
  const [channelId, setChannelId] = useState('')

  const [stepKey, setStepKey] = useState('')
  const [stepType, setStepType] = useState<FlowStepType>('ask_date')
  const [promptText, setPromptText] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [choicesText, setChoicesText] = useState('特休\n事假\n病假')

  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  )

  async function loadFlows() {
    const [{ data: flowRows, error: flowErr }, { data: channelRows, error: channelErr }] =
      await Promise.all([
        supabase.from('flows').select('*').order('created_at', { ascending: false }),
        supabase.from('line_channels').select('*').order('name', { ascending: true }),
      ])
    if (flowErr || channelErr) {
      setError(flowErr?.message || channelErr?.message || '載入失敗')
      return
    }
    setFlows(flowRows ?? [])
    setChannels(channelRows ?? [])
    setError(null)
    if (!selectedFlowId && flowRows && flowRows.length > 0) {
      setSelectedFlowId(flowRows[0].id)
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
    const choices =
      stepType === 'ask_choice'
        ? choicesText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [label, value] = line.split('|').map((s) => s.trim())
              return { label: label || line, value: value || label || line }
            })
        : []

    const { error: insertErr } = await supabase.from('flow_steps').insert({
      flow_id: selectedFlowId,
      step_key: key,
      sort_order: steps.length + 1,
      step_type: stepType,
      prompt_text: promptText.trim(),
      field_key: fieldKey.trim() || null,
      choices,
    })
    setSaving(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setStepKey('')
    setPromptText('')
    setFieldKey('')
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

  function seedLeaveTemplate() {
    setFlowName('請假申請')
    setTriggerText('請假')
    setMatchMode('exact')
    setStepType('ask_date')
    setPromptText('請選擇請假日期')
    setFieldKey('日期')
    setStepKey('date')
    setChoicesText('特休\n事假\n病假')
  }

  return (
    <div className="app-shell">
      <AppHeader active="flows" />

      <div className="accounts-layout">
        <section className="accounts-panel">
          <h2>流程列表</h2>
          <p className="muted">例如觸發「請假」後，依序問日期 → 時間 → 假別。全部在此後台設定。</p>

          <form className="channel-form" onSubmit={(e) => void createFlow(e)}>
            <button type="button" className="ghost" onClick={seedLeaveTemplate}>
              帶入請假範例欄位
            </button>
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
              套用 Channel
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">全部 Channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.webhook_key}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={saving}>
              {saving ? '儲存中…' : '新增流程'}
            </button>
          </form>

          <ul className="channel-list">
            {flows.map((f) => (
              <li key={f.id} className="channel-item">
                <button
                  type="button"
                  className={f.id === selectedFlowId ? 'conv-item active' : 'conv-item'}
                  onClick={() => setSelectedFlowId(f.id)}
                  style={{ border: 'none', width: '100%' }}
                >
                  <strong>{f.name}</strong>
                  <span className="muted">
                    觸發「{f.trigger_text}」· {f.is_active ? '啟用' : '停用'}
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
            ))}
          </ul>
        </section>

        <section className="accounts-panel">
          <h2>步驟設定 {selectedFlow ? `／ ${selectedFlow.name}` : ''}</h2>
          {!selectedFlow && <p className="muted">請先建立或選擇左側流程。</p>}

          {selectedFlow && (
            <>
              <p className="muted">
                使用者在 LINE 輸入「{selectedFlow.trigger_text}」後，會依下列步驟詢問。過程中可輸入「取消」中止。
              </p>

              <ol className="step-list">
                {steps.map((s, idx) => (
                  <li key={s.id} className="schedule-item">
                    <div>
                      <strong>
                        {idx + 1}. [{STEP_TYPE_LABEL[s.step_type]}] {s.step_key}
                      </strong>
                    </div>
                    <p>{s.prompt_text}</p>
                    {s.field_key && <p className="muted">存成欄位：{s.field_key}</p>}
                    {s.step_type === 'ask_choice' && Array.isArray(s.choices) && (
                      <p className="muted">
                        選項：{(s.choices as { label: string; value: string }[]).map((c) => c.label).join('、')}
                      </p>
                    )}
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
                    {(Object.keys(STEP_TYPE_LABEL) as FlowStepType[]).map((k) => (
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
                    placeholder="例如 date / time / leave_type"
                  />
                </label>
                <label>
                  對使用者顯示的提示
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={3}
                    required
                    placeholder="例如：請選擇請假日期"
                  />
                </label>
                <label>
                  答案存成欄位名（選填）
                  <input
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                    placeholder="例如：日期、時間、假別"
                  />
                </label>
                {stepType === 'ask_choice' && (
                  <label>
                    選項（一行一個；可用 顯示|值）
                    <textarea
                      value={choicesText}
                      onChange={(e) => setChoicesText(e.target.value)}
                      rows={4}
                    />
                  </label>
                )}
                <button type="submit" disabled={saving}>
                  {saving ? '儲存中…' : '加入步驟'}
                </button>
              </form>

              <div className="muted" style={{ marginTop: '1rem' }}>
                請假範例建議步驟：
                <br />1) 選日期（ask_date，欄位：日期）
                <br />2) 選時間（ask_time，欄位：時間）
                <br />3) 選假別（ask_choice，欄位：假別，選項特休/事假/病假）
              </div>
            </>
          )}

          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </div>
  )
}
