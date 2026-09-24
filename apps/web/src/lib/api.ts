export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Erro de validação de um campo, no formato que o ZodFilter da API devolve. */
export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * Erros por campo vindos de `{ errors: [{ field, message }] }`.
     * Sem isto o formulário só conseguia exibir "Validation failed", sem
     * indicar ao usuário qual campo corrigir.
     */
    public readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Baixa um arquivo da API (CSV, por ora) sem sair da página.
 *
 * Não dá para usar `api()`: ela termina em `res.json()`, e a resposta aqui é
 * `text/csv`. E não dá para usar um `<a href>` simples: a rota exige o header
 * `Authorization`, que uma navegação do navegador não carrega — o resultado
 * seria um arquivo com "Unauthorized" dentro.
 */
export async function baixarArquivo(
  path: string,
  nomeSugerido: string,
  token?: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // resposta não é JSON — mensagem genérica serve
    }
    throw new ApiError(res.status, message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeSugerido;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sem o revoke o blob fica na memória da aba até o recarregamento.
  URL.revokeObjectURL(url);
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
    let fieldErrors: FieldError[] = [];
    try {
      const body = await res.json();
      // NestJS retorna { message: string } ou { message: string[] }
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message[0];

      // ZodFilter acrescenta { errors: [{ field, message }] }
      if (Array.isArray(body.errors)) {
        fieldErrors = body.errors.filter(
          (e: unknown): e is FieldError =>
            typeof e === 'object' && e !== null &&
            typeof (e as FieldError).field === 'string' &&
            typeof (e as FieldError).message === 'string',
        );
      }
    } catch {
      // body não é JSON — usa mensagem genérica
    }
    throw new ApiError(res.status, message, fieldErrors);
  }

  return res.json() as Promise<T>;
}
