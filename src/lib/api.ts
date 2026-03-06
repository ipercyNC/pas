const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const fallbackMessage = `HTTP ${response.status}`;
    try {
      const errorBody = (await response.json()) as {
        error?: { message?: string };
      };
      throw new ApiError(errorBody.error?.message ?? fallbackMessage, response.status);
    } catch {
      throw new ApiError(fallbackMessage, response.status);
    }
  }

  return (await response.json()) as T;
}

export { API_BASE_URL };
