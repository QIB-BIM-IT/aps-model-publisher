import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import GlobalDashboard from './pages/GlobalDashboard.jsx';
import PlanningPage from './pages/PlanningPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

function Root() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/login" replace />} />
          <Route path="login" element={<Login />} />
          <Route path="callback" element={<AuthCallback />} />
          {/* ✅ Vue d'ensemble = page par défaut après login */}
          <Route
            path="dashboard"
            element={
              <ProtectedRoute>
                <GlobalDashboard />
              </ProtectedRoute>
            }
          />

          {/* ✅ Page de planification */}
          <Route
            path="planning"
            element={
              <ProtectedRoute>
                <PlanningPage />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
