// Shared HTTP helpers for Netlify Functions (v2 / Web-standard Request & Response).

export class HttpError extends Error {
  constructor(
    public status: number,
    public publicMessage: string,
  ) {
    super(publicMessage);
  }
}

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...extra } });
}

/** Structured log line. Never pass secrets, tokens or PII here. */
export function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}) {
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, message, ...fields }));
}

type Handler = (req: Request) => Promise<Response>;

/**
 * Wraps a handler: enforces the allowed method, converts HttpError to a clean
 * JSON error and hides every other error behind a generic 500 (details are
 * logged server-side only).
 */
export function route(method: 'GET' | 'POST', fn: Handler): Handler {
  return async (req) => {
    if (req.method !== method) {
      return json(405, { error: 'Method not allowed' }, { Allow: method });
    }
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.publicMessage });
      log('error', 'unhandled function error', {
        name: err instanceof Error ? err.name : 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
      return json(500, { error: 'Something went wrong. Please try again.' });
    }
  };
}

/** Reads and size-limits a JSON body. */
export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
