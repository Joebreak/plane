import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppHeader } from '../components/AppHeader'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { AdminProfile, LineChannelListItem } from '../types/database'

export function AccountsPage() {
  const { user } = useAuth()
  const [admins, setAdmins] = useState<AdminProfile[]>([])
  const [channels, setChannels] = useState<LineChannelListItem[]>([])
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
        supabase.from('line_channels_list').select('*').order('created_at', { ascending: false }),
      ])

    if (adminErr || channelErr) {
      setError(adminErr?.message || channelErr?.message || '載入失敗')
      return
    }

    setAdmins(adminRows ?? [])
    setChannels((channelRows as LineChannelListItem[]) ?? [])
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
      created_by: user?.id ?? null,
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

  async function toggleActive(channel: LineChannelListItem) {
    const { error: rpcErr } = await supabase.rpc('set_line_channel_active', {
      p_id: channel.id,
      p_active: !channel.is_active,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    await load()
  }

  async function removeChannel(id: string) {
    if (!confirm('確定刪除此 Channel key？')) return
    const { error: rpcErr } = await supabase.rpc('delete_line_channel', {
      p_id: id,
    })
    if (rpcErr) {
      setError(rpcErr.message)
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
            只有「建立者」看得到 Key 與 Webhook網址；其他人只看得到名稱（其餘顯示 ***）。
            停用／刪除不限制，所有管理者都能操作。
          </p>

          <form className="channel-form" onSubmit={(e) => void onAddChannel(e)}>
            <label>
              顯示名稱
              <span className="field-hint">後台列表用，方便辨識是哪個官方帳號（例如：客服 LINE、人資請假）</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：客服 LINE" required />
            </label>
            <label>
              Webhook Key（識別碼）
              <span className="field-hint">
                每個 Channel 請設不同的識別碼，會加在網址 <code>?key=</code> 後面，用來分辨訊息來自哪一組。
                建議用英文縮寫，例如 <code>cs</code>、<code>hr_leave</code>（英數、底線、連字號，3–64 字）
              </span>
              <input
                value={webhookKey}
                onChange={(e) => setWebhookKey(e.target.value)}
                placeholder="例如：cs 或 hr_leave"
                pattern="[a-zA-Z0-9_-]{3,64}"
                required
              />
            </label>
            <label>
              Channel Access Token
              <span className="field-hint">LINE Developers → Messaging API → Channel access token</span>
              <input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                required
              />
            </label>
            <label>
              Channel Secret
              <span className="field-hint">LINE Developers → Basic settings → Channel secret（用來驗真，勿與 Token 搞混）</span>
              <input
                value={channelSecret}
                onChange={(e) => setChannelSecret(e.target.value)}
                required
              />
            </label>
            {webhookBase && webhookKey.trim() && (
              <div className="webhook-preview">
                <strong>Webhook網址（貼到該官方帳號的 LINE Webhook）：</strong>
                <code>
                  {webhookBase}?key={webhookKey.trim()}
                </code>
                <div className="field-hint">不同 Key = 不同網址，請對應貼到正確的 LINE Channel。</div>
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
                  <strong>{c.name || (c.is_owner ? c.webhook_key : '未命名 Channel')}</strong>
                  <span className={`badge ${c.is_active ? 'status-sent' : 'status-cancelled'}`}>
                    {c.is_active ? '啟用' : '停用'}
                  </span>
                </div>

                {c.is_owner ? (
                  <>
                    <div className="muted">
                      識別 Key：<code>{c.webhook_key}</code>
                      <span className="field-hint inline-hint">（用來分辨不同 Channel）</span>
                    </div>
                    {webhookBase && (
                      <div className="webhook-preview">
                        <strong>Webhook網址：</strong>
                        <code>
                          {webhookBase}?key={c.webhook_key}
                        </code>
                      </div>
                    )}
                    <div className="muted">Token：{c.channel_access_token}</div>
                  </>
                ) : (
                  <>
                    <div className="muted">
                      Key：<code>***</code>
                    </div>
                    <div className="webhook-preview">
                      <strong>Webhook網址：</strong>
                      <code>***</code>
                    </div>
                    <div className="muted">Token：***</div>
                  </>
                )}

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
