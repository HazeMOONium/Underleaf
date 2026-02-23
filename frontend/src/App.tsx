import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/auth'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import EditorPage from './pages/EditorPage'
import InviteAcceptPage from './pages/InviteAcceptPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  return token ? <>{children}</> : <Navigate to="/login" />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/project/:projectId"
        element={
          <PrivateRoute>
            <EditorPage />
          </PrivateRoute>
        }
      />
      {/* Public route — invite preview works without login */}
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}

export default App
