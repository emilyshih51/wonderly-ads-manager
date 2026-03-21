/** Shared fetch helper for TanStack Query hooks. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }

    // Parse error body for a message (e.g. "rate limit")
    let message = `API error: ${res.status}`;

    try {
      const body = await res.json();

      if (body?.error) message = typeof body.error === 'string' ? body.error : message;
    } catch {
      // ignore parse failures
    }

    throw new Error(message);
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
