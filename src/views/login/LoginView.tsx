import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { setToken } from "../../lib/auth";
import { ApiError, apiRequest } from "../../lib/api";

type LoginResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
  };
};

export function LoginView() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo.admin@pas.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await apiRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(response.accessToken);
      navigate("/policies", { replace: true });
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setError(requestError.message);
      } else {
        setError("Unable to log in right now.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <form className="card" onSubmit={handleSubmit}>
        <h1>PAS Login</h1>
        <p className="hint">Demo credentials are pre-filled for local development.</p>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
