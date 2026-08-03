const TOKEN_KEY = 'linkbridge.accessToken';
const REFRESH_KEY = 'linkbridge.refreshToken';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(path, { ...options, headers });

  // Single retry with a rotated token on 401.
  if (res.status === 401 && token) {
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
    const ok = await refreshPromise;
    if (ok) {
      const newToken = getAccessToken();
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
      res = await fetch(path, { ...options, headers: retryHeaders });
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore body parse errors */
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  login: (username: string, password: string) =>
    api<import('./types.js').AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    api<import('./types.js').AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => api<import('./types.js').User>('/api/auth/me'),
  devices: () => api<{ devices: import('./types.js').Device[] }>('/api/devices'),
  createPairing: () =>
    api<import('./types.js').PairingPayload>('/api/devices/pair', { method: 'POST' }),
  renameDevice: (id: string, name: string) =>
    api<{ device: import('./types.js').Device }>(`/api/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  unpairDevice: (id: string) =>
    api<{ ok: boolean }>(`/api/devices/${id}`, { method: 'DELETE' }),
  createSession: (deviceId: string, kind: import('./types.js').SessionKind) =>
    api<{ session: import('./types.js').RemoteSession }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ deviceId, kind }),
    }),
  sessions: (deviceId?: string) =>
    api<{ sessions: import('./types.js').RemoteSession[] }>(
      deviceId ? `/api/sessions?deviceId=${deviceId}` : '/api/sessions',
    ),
  sessionDetail: (sessionId: string) =>
    api<{ session: import('./types.js').RemoteSession; turn: import('./types.js').TurnCredentials }>(
      `/api/sessions/${sessionId}`,
    ),
  endSession: (sessionId: string) =>
    api<{ ok: boolean }>(`/api/sessions/${sessionId}`, { method: 'DELETE' }),
  logout: async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await api('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        /* best-effort server-side revocation */
      }
    }
    clearTokens();
  },
};
