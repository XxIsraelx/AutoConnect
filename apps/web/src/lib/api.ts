export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  init: (Omit<RequestInit, 'body'> & { token?: string; body?: unknown }) = {},
): Promise<T> {
  const { token, headers, body, ...rest } = init;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...rest,
    body: body !== undefined
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = await res.json();
      // NestJS retorna { message: string } ou { message: string[] }
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message[0];
    } catch {
      // body não é JSON — usa mensagem genérica
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}
