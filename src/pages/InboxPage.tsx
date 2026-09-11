import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppHeader } from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { ConversationWithUser, Message } from '../types/database'

export function InboxPage() {
  const [conversations, setConversations] = useState<ConversationWithUser[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  )

  const loadConversations = useCallback(async () => {
    setLoadingList(true)
    const { data, error: err } = await supabase
      .from('conversations')
      .select('*, line_users(*)')
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (err) {
      setError(err.message)
    } else {
      setConversations((data as ConversationWithUser[]) ?? [])
      setError(null)
    }
    setLoadingList(false)
  }, [])

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true)
    const { data, error: err } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (err) {
      setError(err.message)
    } else {
      setMessages(data ?? [])
    }
    setLoadingMessages(false)
  }, [])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    void loadMessages(selectedId)
  }, [selectedId, loadMessages])

  useEffect(() => {
    const channel = supabase
      .channel('admin-inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          void loadConversations()
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as Message
          if (row.conversation_id === selectedId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev
              return [...prev, row]
            })
          }
          void loadConversations()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [selectedId, loadConversations])

  async function sendReply(e: FormEvent) {
    e.preventDefault()
    if (!selected?.line_users || !draft.trim()) return

    setSending(true)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('send-message', {
      body: {
        line_user_uuid: selected.line_users.id,
        line_user_id: selected.line_users.line_user_id,
        content: draft.trim(),
      },
    })

    setSending(false)

    if (fnError) {
      setError(fnError.message)
      return
    }

    if (data?.error) {
      setError(String(data.error))
      return
    }

    setDraft('')
    if (selectedId) void loadMessages(selectedId)
    void loadConversations()
  }

  return (
    <div className="app-shell">
      <AppHeader active="inbox" />

      <div className="inbox-layout">
        <aside className="conversation-list">
          <div className="panel-title">對話列表</div>
          {loadingList && <p className="muted pad">載入中…</p>}
          {!loadingList && conversations.length === 0 && (
            <p className="muted pad">尚無對話。請先設定 LINE webhook，讓使用者傳訊息進來。</p>
          )}
          <ul>
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === selectedId ? 'conv-item active' : 'conv-item'}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="conv-name">
                    {c.line_users?.display_name || c.line_users?.line_user_id || '未知使用者'}
                  </span>
                  <span className="conv-preview">{c.last_message_preview || '—'}</span>
                  <span className="conv-time">
                    {c.last_message_at
                      ? new Date(c.last_message_at).toLocaleString('zh-TW')
                      : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="message-panel">
          {!selected && <div className="empty-state">選擇左側對話以查看訊息</div>}
          {selected && (
            <>
              <div className="message-header">
                <strong>
                  {selected.line_users?.display_name || selected.line_users?.line_user_id}
                </strong>
                {selected.line_users?.picture_url && (
                  <img
                    src={selected.line_users.picture_url}
                    alt=""
                    className="avatar"
                    width={32}
                    height={32}
                  />
                )}
              </div>
              <div className="message-list">
                {loadingMessages && <p className="muted">載入訊息…</p>}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={m.direction === 'out' ? 'bubble out' : 'bubble in'}
                  >
                    <div className="bubble-content">{m.content}</div>
                    <div className="bubble-meta">
                      {m.direction === 'out' ? '已送出' : '收到'} ·{' '}
                      {new Date(m.created_at).toLocaleString('zh-TW')}
                      {m.status === 'failed' ? ' · 失敗' : ''}
                    </div>
                  </div>
                ))}
              </div>
              <form className="composer" onSubmit={(e) => void sendReply(e)}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="輸入要回覆的訊息…"
                  rows={2}
                  required
                />
                <button type="submit" disabled={sending || !draft.trim()}>
                  {sending ? '發送中…' : '發送'}
                </button>
              </form>
            </>
          )}
          {error && <p className="error pad">{error}</p>}
        </section>
      </div>
    </div>
  )
}
