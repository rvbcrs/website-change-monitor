import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google';
import Dashboard from './Dashboard'
import Editor from './Editor'
import Layout from './Layout'
import Settings from './Settings'
import MonitorDetails from './MonitorDetails'
import StatusPage from './StatusPage'
import Login from './Login'
import Register from './Register'
import Users from './Users'
import VerifyEmail from './pages/VerifyEmail'
import { ToastProvider } from './contexts/ToastContext'
import { DialogProvider } from './contexts/DialogContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'

const ProtectedRoute = ({ children }) => {
    const { token, loading } = useAuth();
    if (loading) return <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-[#8b949e]">Loading...</div>;
    if (!token) return <Navigate to="/login" />;
    return children;
};

// Route for "public" pages checks if logged in -> redirect to dashboard (optional but nice)
const PublicRoute = ({ children }) => {
    const { token, loading } = useAuth();
    if (loading) return null;
    if (token) return <Navigate to="/" />;
    return children;
};

function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <AuthProvider>
          <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || "GOOGLE_CLIENT_ID_PLACEHOLDER"}>
            <Router>
                <Routes>
                <Route path="/status" element={<StatusPage />} />
                <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
                <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
                <Route path="/verify" element={<PublicRoute><VerifyEmail /></PublicRoute>} />
                
                <Route path="*" element={
                    <ProtectedRoute>
                    <Layout>
                        <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/new" element={<Editor />} />
                        <Route path="/edit/:id" element={<Editor />} />
                        <Route path="/monitor/:id" element={<MonitorDetails />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/users" element={<Users />} />
                        </Routes>
                    </Layout>
                    </ProtectedRoute>
                } />
                </Routes>
            </Router>
          </GoogleOAuthProvider>
        </AuthProvider>
      </DialogProvider>
    </ToastProvider>
  )
}

export default App
