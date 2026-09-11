import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

type Props = {
  active: 'inbox' | 'schedule' | 'accounts' | 'flows'
}

export function AppHeader({ active }: Props) {
  const { signOut } = useAuth()

  return (
    <header className="topbar">
      <div className="brand">LINE 管理者後台</div>
      <nav>
        <Link to="/" className={active === 'inbox' ? 'nav-active' : undefined}>
          對話
        </Link>
        <Link to="/schedule" className={active === 'schedule' ? 'nav-active' : undefined}>
          排程發送
        </Link>
        <Link to="/flows" className={active === 'flows' ? 'nav-active' : undefined}>
          流程控制
        </Link>
        <Link to="/accounts" className={active === 'accounts' ? 'nav-active' : undefined}>
          帳號管理
        </Link>
      </nav>
      <button type="button" className="ghost" onClick={() => void signOut()}>
        登出
      </button>
    </header>
  )
}
