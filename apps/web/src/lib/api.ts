const BASE = '/api';
let token: string | null = localStorage.getItem('humainity_token');

export const setToken = (t: string | null) => {
  token = t;
  if (t) localStorage.setItem('humainity_token', t);
  else localStorage.removeItem('humainity_token');
};
export const getToken = () => token;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.code);
  return body as T;
}

export const api = {
  get:  <T,>(p: string) => request<T>(p),
  post: <T,>(p: string, b?: unknown) => request<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) }),
  put:  <T,>(p: string, b?: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }),
  patch:<T,>(p: string, b?: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(b ?? {}) }),
};
