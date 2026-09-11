import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppHeader } from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import type { AdminProfile, LineChannel } from '../types/database'

function maskToken(token: string) {
  if (token.length <= 10) return '••••••••'
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

export function AccountsPage() {
  const [admins, setAdmins] = useState<AdminProfile[]>([])
  const [channels, setChannels] = useState<LineChannel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [webhookKey, setWebhookKey] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [channelSecret, setChannelSecret] = useState('')

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

  const webhookBase = useMemo(
    () => (supabaseUrl ? `${supabaseUrl}/functions/v1/line-webhook` : ''),
    [supabaseUrl],
  )

  async function load() {
    const [{ data: adminRows, error: adminErr }, { data: channelRows, error: channelErr }] =
      await Promise.all([
        supabase.from('admin_profiles').select('*').order('created_at', { ascending: true }),
        supabase.from('line_channels').select('*').order('created_at', { ascending: false }),
      ])

    if (adminErr || channelErr) {
      setError(adminErr?.message || channelErr?.message || '載入失敗')
      return
    }

    setAdmins(adminRows ?? [])
    setChannels(channelRows ?? [])
    setError(null)
  }

  useEffect(() => {
    void load()
  }, [])

  async function onAddChannel(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const { error: insertErr } = await supabase.from('line_channels').insert({
      name: name.trim() || webhookKey.trim(),
      webhook_key: webhookKey.trim(),
      channel_access_token: accessToken.trim(),
      channel_secret: channelSecret.trim(),
      is_active: true,
    })

    setSaving(false)

    if (insertErr) {
      setError(insertErr.message)
      return
    }

    setName('')
    setWebhookKey('')
    setAccessToken('')
    setChannelSecret('')
    await load()
  }

  async function toggleActive(channel: LineChannel) {
    const { error: updateErr } = await supabase
      .from('line_channels')
      .update({ is_active: !channel.is_active })
      .eq('id', channel.id)

    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await load()
  }

  async function removeChannel(id: string) {
    if (!confirm('確定刪除此 Channel key？')) return
    const { error: deleteErr } = await supabase.from('line_channels').delete().eq('id', id)
    if (deleteErr) {
      setError(deleteErr.message)
      return
    }
    await load()
  }

  return (
    <div className="app-shell">
      <AppHeader active="accounts" />

      <div className="accounts-layout">
        <section className="accounts-panel">
          <h2>管理者帳號</h2>
          <p className="muted">僅供查看。後台不可新增管理者；請到 Supabase Authentication 建立使用者。</p>
          {admins.length === 0 && <p className="muted">尚無管理者資料</p>}
          <ul className="admin-list">
            {admins.map((a) => (
              <li key={a.id}>
                <strong>{a.display_name || a.email || a.id}</strong>
                <span className="muted">{a.email}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="accounts-panel">
          <h2>LINE Channel Keys</h2>
          <p className="muted">
            可新增多組。產生的「Webhook網址」請貼到 LINE Developers → Messaging API → Webhook URL。
            對應 Channel Access Token / Channel Secret 存在資料庫。
          </p>

          <form className="channel-form" onSubmit={(e) => void onAddChannel(e)}>
            <label>
              名稱（選填）
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：客服官方帳號" />
            </label>
            <label>
              Webhook Key
              <input
                value={webhookKey}
                onChange={(e) => setWebhookKey(e.target.value)}
                placeholder="英數、底線、連字號，3–64 字"
                pattern="[a-zA-Z0-9_-]{3,64}"
                required
              />
            </label>
            <label>
              Channel Access Token
              <input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                required
              />
            </label>
            <label>
              Channel Secret（驗簽用）
              <input
                value={channelSecret}
                onChange={(e) => setChannelSecret(e.target.value)}
                required
              />
            </label>
            {webhookBase && webhookKey.trim() && (
              <div className="webhook-preview">
                <strong>Webhook網址（貼到 LINE）：</strong>
                <code>
                  {webhookBase}?key={webhookKey.trim()}
                </code>
              </div>
            )}
            <button type="submit" disabled={saving}>
              {saving ? '儲存中…' : '加入 Key'}
            </button>
          </form>

          {error && <p className="error">{error}</p>}

          <ul className="channel-list">
            {channels.map((c) => (
              <li key={c.id} className="channel-item">
                <div className="channel-item-head">
                  <strong>{c.name || c.webhook_key}</strong>
                  <span className={`badge ${c.is_active ? 'status-sent' : 'status-cancelled'}`}>
                    {c.is_active ? '啟用' : '停用'}
                  </span>
                </div>
                <div className="muted">
                  Key：<code>{c.webhook_key}</code>
                </div>
                {webhookBase && (
                  <div className="webhook-preview">
                    <strong>Webhook網址：</strong>
                    <code>
                      {webhookBase}?key={c.webhook_key}
                    </code>
                  </div>
                )}
                <div className="muted">Token：{maskToken(c.channel_access_token)}</div>
                <div className="channel-actions">
                  <button type="button" className="ghost" onClick={() => void toggleActive(c)}>
                    {c.is_active ? '停用' : '啟用'}
                  </button>
                  <button type="button" className="ghost" onClick={() => void removeChannel(c.id)}>
                    刪除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
