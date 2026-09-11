import { useEffect, useState, type FormEvent } from 'react'
import { AppHeader } from '../components/AppHeader'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { LineUser, ScheduledMessage } from '../types/database'

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function SchedulePage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<LineUser[]>([])
  const [scheduled, setScheduled] = useState<(ScheduledMessage & { line_users: LineUser | null })[]>(
    [],
  )
  const [lineUserId, setLineUserId] = useState('')
  const [content, setContent] = useState('')
  const [sendAt, setSendAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    return toLocalInputValue(d)
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [{ data: userRows, error: userErr }, { data: schedRows, error: schedErr }] =
      await Promise.all([
        supabase.from('line_users').select('*').order('display_name', { ascending: true }),
        supabase
          .from('scheduled_messages')
          .select('*, line_users(*)')
          .order('send_at', { ascending: true }),
      ])

    if (userErr || schedErr) {
      setError(userErr?.message || schedErr?.message || '載入失敗')
      return
    }

    setUsers(userRows ?? [])
    setScheduled((schedRows as (ScheduledMessage & { line_users: LineUser | null })[]) ?? [])
    setError(null)

    if (!lineUserId && userRows && userRows.length > 0) {
      setLineUserId(userRows[0].id)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!lineUserId || !content.trim() || !sendAt) return

    setSaving(true)
    setError(null)

    const { error: insertErr } = await supabase.from('scheduled_messages').insert({
      line_user_id: lineUserId,
      content: content.trim(),
      send_at: new Date(sendAt).toISOString(),
      status: 'pending',
      created_by: user?.id ?? null,
    })

    setSaving(false)

    if (insertErr) {
      setError(insertErr.message)
      return
    }

    setContent('')
    await load()
  }

  async function cancelSchedule(id: string) {
    const { error: updateErr } = await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'pending')

    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await load()
  }

  return (
    <div className="app-shell">
      <AppHeader active="schedule" />

      <div className="schedule-layout">
        <form className="schedule-form" onSubmit={(e) => void onSubmit(e)}>
          <h2>新增排程訊息</h2>
          <p className="muted">到時間後由 Supabase 排程自動透過 LINE Push 發送（約每分鐘檢查一次）。</p>

          <label>
            對象
            <select
              value={lineUserId}
              onChange={(e) => setLineUserId(e.target.value)}
              required
            >
              {users.length === 0 && <option value="">尚無 LINE 使用者</option>}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.line_user_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            發送時間
            <input
              type="datetime-local"
              value={sendAt}
              onChange={(e) => setSendAt(e.target.value)}
              required
            />
          </label>

          <label>
            訊息內容
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              required
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={saving || users.length === 0}>
            {saving ? '儲存中…' : '建立排程'}
          </button>
        </form>

        <section className="schedule-list">
          <h2>排程列表</h2>
          {scheduled.length === 0 && <p className="muted">尚無排程</p>}
          <ul>
            {scheduled.map((item) => (
              <li key={item.id} className="schedule-item">
                <div>
                  <strong>{item.line_users?.display_name || item.line_users?.line_user_id || '—'}</strong>
                  <span className={`badge status-${item.status}`}>{item.status}</span>
                </div>
                <p>{item.content}</p>
                <div className="muted">
                  預定：{new Date(item.send_at).toLocaleString('zh-TW')}
                  {item.sent_at ? ` · 已送：${new Date(item.sent_at).toLocaleString('zh-TW')}` : ''}
                  {item.error_message ? ` · 錯誤：${item.error_message}` : ''}
                </div>
                {item.status === 'pending' && (
                  <button type="button" className="ghost" onClick={() => void cancelSchedule(item.id)}>
                    取消
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
