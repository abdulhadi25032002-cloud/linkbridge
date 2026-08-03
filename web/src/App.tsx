import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.js';
import { Spinner } from './components/Spinner.js';
import Layout from './components/Layout.js';
import LoginPage from './pages/LoginPage.js';
import RegisterPage from './pages/RegisterPage.js';
import DashboardPage from './pages/DashboardPage.js';
import RemotePage from './pages/RemotePage.js';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="devices/:deviceId" element={<RemotePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
