/** Shared fetch helper for TanStack Query hooks. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }

    throw new Error(`API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/** POST helper for mutations. */
export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** PUT helper for mutations. */
export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** DELETE helper for mutations. */
export async function apiDelete<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: 'DELETE' });
}
