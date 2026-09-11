import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { InboxPage } from './pages/InboxPage'
import { SchedulePage } from './pages/SchedulePage'
import { AccountsPage } from './pages/AccountsPage'
import { FlowRulesPage } from './pages/FlowRulesPage'
import './App.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={basename === '/' ? undefined : basename}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<InboxPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/flows" element={<FlowRulesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
