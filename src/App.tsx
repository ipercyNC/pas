import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { clearToken, getToken } from "./lib/auth";
import { ApiError, apiRequest } from "./lib/api";
import { LoginView } from "./views/login/LoginView";
import { PoliciesView } from "./views/policies/PoliciesView";
import { TimeMachineView } from "./views/time-machine/TimeMachineView";

type SessionResponse = {
  authenticated: boolean;
};

function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsAuthorized(false);
      setIsValidating(false);
      return;
    }

    const validate = async () => {
      try {
        await apiRequest<SessionResponse>("/api/auth/session", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        setIsAuthorized(true);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearToken();
        }
        setIsAuthorized(false);
      } finally {
        setIsValidating(false);
      }
    };

    void validate();
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  if (isValidating) {
    return (
      <main className="auth-shell">
        <div className="card">
          <p>Validating session...</p>
        </div>
      </main>
    );
  }

  if (!isAuthorized) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <main className="shell">
      <nav className="nav">
        <NavLink to="/policies" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          Policies
        </NavLink>
        <NavLink to="/time-machine" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          Time Machine
        </NavLink>
        <button type="button" className="ghost" onClick={handleLogout}>
          Logout
        </button>
      </nav>
      <section className="content">
        <Routes>
          <Route path="/policies" element={<PoliciesView />} />
          <Route path="/time-machine" element={<TimeMachineView />} />
          <Route path="*" element={<Navigate to="/policies" replace />} />
        </Routes>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}
