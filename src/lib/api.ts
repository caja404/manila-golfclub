export class ApiError extends Error {}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status}).`);
  return body as T;
}

export const api = {
  get: <T,>(path: string) => fetch(`/api${path}`).then((r) => handle<T>(r)),
  post: <T = unknown,>(path: string, body: unknown = {}) =>
    fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
};
