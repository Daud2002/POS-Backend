/**
 * The store server's line to the cloud API. Plain fetch with a timeout; every
 * failure surfaces as CloudUnreachable or CloudError so the sync loop can
 * tell "no internet, try later" from "the cloud said no".
 */
export class CloudUnreachable extends Error {}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Timed<T> {
  body: T;
  /** Request start and end, for measuring this PC's clock against the cloud's. */
  sentAt: number;
  receivedAt: number;
}

export class CloudClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credential: string | null,
    private readonly timeoutMs = 30_000,
  ) {}

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }

  /** The bootstrap stream, read whole: NDJSON lines in order. */
  async ndjson(path: string): Promise<any[]> {
    const response = await this.fetch('GET', path, undefined, 10 * 60_000);
    const text = await response.text();
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<Timed<T>> {
    const sentAt = Date.now();
    const response = await this.fetch(method, path, body, this.timeoutMs);
    const text = await response.text();
    return { body: (text ? JSON.parse(text) : null) as T, sentAt, receivedAt: Date.now() };
  }

  private async fetch(method: string, path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.credential) headers.Authorization = `StoreServer ${this.credential}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: any) {
      throw new CloudUnreachable(error?.message ?? 'Cloud unreachable');
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text)?.message ?? text;
      } catch {
        // plain text
      }
      throw new CloudError(String(message || response.statusText), response.status);
    }
    return response;
  }
}
