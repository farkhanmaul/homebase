export type Occupant = { id: number; active: boolean; x?: number; y?: number; direction?: string; status?: string };
export type OfficeMessage = { id: string | number; seq: number; name: string; text: string; time: string; sprite: number };

// Every request is bounded by an AbortController. Callers may pass their own
// signal, which is composed with the timeout so either can cancel the fetch.
export const DEFAULT_TIMEOUT_MS = 5000;
// Network retry backoff is exponential but hard-capped so a flaky connection
// can never schedule an unbounded delay.
export const MAX_BACKOFF_MS = 30000;
// The server retains 200 messages; rendering more than that would be redundant.
export const MAX_RENDERED_MESSAGES = 200;

const BASE_BACKOFF_MS = 500;
const DEFAULT_GET_RETRIES = 2;

export class OfficeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeError';
  }
}

export class OfficeHttpError extends OfficeError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OfficeHttpError';
    this.status = status;
  }
}

// Typed 401: the session is gone, so request() has already cleared the local
// token/id and the UI can fall back to character selection.
export class OfficeUnauthorizedError extends OfficeHttpError {
  readonly code = 'unauthorized';
  constructor(message = 'Sesi kantor sudah berakhir. Pilih karakter lagi.') {
    super(401, message);
    this.name = 'OfficeUnauthorizedError';
  }
}

export class OfficeTimeoutError extends OfficeError {
  readonly code = 'timeout';
  constructor(message = 'Kantor tidak merespons. Coba lagi.') {
    super(message);
    this.name = 'OfficeTimeoutError';
  }
}

export class OfficeNetworkError extends OfficeError {
  readonly code = 'network';
  constructor(message = 'Tidak dapat terhubung ke kantor.') {
    super(message);
    this.name = 'OfficeNetworkError';
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  retries?: number;
  timeoutMs?: number;
};

export type ConfigureOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

// Exponential backoff with jitter, clamped to MAX_BACKOFF_MS. Exported so the
// bound is directly testable.
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (0.5 + random() * 0.5)));
}

// Appends only messages we do not already hold (deduped by id) and keeps them
// ordered by the server sequence, bounded to the retained window. This lets a
// poll fetch only new messages instead of the full 200-message history.
export function mergeMessages(existing: OfficeMessage[], incoming: OfficeMessage[]): OfficeMessage[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((message) => String(message.id)));
  const merged = existing.slice();
  for (const message of incoming) {
    const key = String(message.id);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  merged.sort((a, b) => a.seq - b.seq);
  return merged.length > MAX_RENDERED_MESSAGES ? merged.slice(-MAX_RENDERED_MESSAGES) : merged;
}

export function latestSeq(messages: OfficeMessage[]): number {
  return messages.reduce((max, message) => (message.seq > max ? message.seq : max), 0);
}

export type ChatPollState = { initialized: boolean; seq: number };
export type ChatPollResult = { state: ChatPollState; announcement: string | null };

// The first successful poll only primes the chat: even an empty result marks it
// initialized, so the first message that arrives afterwards is announced. The
// cursor only advances when messages arrive, so a poll of the same cursor sees
// nothing new and the announcement cannot repeat.
export function reduceChatPoll(state: ChatPollState, incoming: OfficeMessage[]): ChatPollResult {
  if (!incoming.length) return { state: { initialized: true, seq: state.seq }, announcement: null };
  const last = incoming[incoming.length - 1];
  return {
    state: { initialized: true, seq: latestSeq(incoming) },
    announcement: state.initialized ? `${last.name}: ${last.text}` : null,
  };
}

function errorMessageFrom(data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Tidak dapat terhubung ke kantor.';
}

function callerAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Permintaan dibatalkan.');
}

type Settled<T> = { ok: true; value: T } | { ok: false; reason: unknown };

// Settles when the promise settles or the composed signal aborts, whichever
// happens first, so the request timeout bounds body parsing too: a response
// whose json() never resolves still settles as a timeout. The branch that loses
// the race stays observed, so it can never surface as an unhandled rejection.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<Settled<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Settled<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, reason: signal.reason });
    if (signal.aborted) {
      finish({ ok: false, reason: signal.reason });
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish({ ok: true, value }),
      (reason) => finish({ ok: false, reason }),
    );
  });
}

function composeSignals(timeout: AbortSignal, caller?: AbortSignal): AbortSignal {
  if (!caller) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, caller]);
  const controller = new AbortController();
  const forward = (source: AbortSignal) => () => controller.abort(source.reason);
  if (timeout.aborted) controller.abort(timeout.reason);
  else timeout.addEventListener('abort', forward(timeout), { once: true });
  if (caller.aborted) controller.abort(caller.reason);
  else caller.addEventListener('abort', forward(caller), { once: true });
  return controller.signal;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Permintaan dibatalkan.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Permintaan dibatalkan.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class OfficeSession {
  api = '';
  token = '';
  id: number | null = null;
  releaseLock?: () => void;
  private sessionClearedListeners = new Set<() => void>();

  async configure(options: ConfigureOptions = {}): Promise<void> {
    const timeout = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeout.abort(new OfficeTimeoutError());
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = composeSignals(timeout.signal, options.signal);
    try {
      let response: Response;
      try {
        response = await fetch('config.json', { cache: 'no-store', signal });
      } catch {
        if (timedOut) throw new OfficeTimeoutError();
        if (options.signal?.aborted) throw callerAbortError(options.signal);
        throw new OfficeNetworkError();
      }

      const parsed = await abortable(response.json(), signal);
      if (!parsed.ok) {
        if (timedOut) throw new OfficeTimeoutError();
        if (options.signal?.aborted) throw callerAbortError(options.signal);
        throw new OfficeError('Konfigurasi kantor tidak dapat dibaca.');
      }
      if (!response.ok) throw new OfficeHttpError(response.status, 'Konfigurasi kantor tidak dapat dimuat.');

      const config = parsed.value;
      if (!config || typeof config !== 'object') throw new OfficeError('Konfigurasi kantor tidak valid.');
      const { apiUrl } = config as { apiUrl?: unknown };
      if (apiUrl !== undefined && typeof apiUrl !== 'string') throw new OfficeError('Konfigurasi kantor tidak valid.');
      this.api = typeof apiUrl === 'string' ? apiUrl.replace(/\/$/, '') : '';
    } finally {
      clearTimeout(timer);
    }
  }

  // Single recovery channel: every path that ends a session — a typed 401 or an
  // explicit release — funnels through clearSession(), which notifies these
  // subscribers so the UI resets its active/selected/chat state in one place.
  onSessionCleared(listener: () => void): () => void {
    this.sessionClearedListeners.add(listener);
    return () => {
      this.sessionClearedListeners.delete(listener);
    };
  }

  // Clears the local bearer/id so a dead session cannot keep being replayed.
  clearSession(): void {
    this.token = '';
    this.id = null;
    this.releaseLock?.();
    this.releaseLock = undefined;
    for (const listener of this.sessionClearedListeners) {
      try {
        listener();
      } catch {
        // A misbehaving subscriber must not break the recovery path.
      }
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    // Only safe, idempotent reads are retried; writes like claim/message are
    // never replayed automatically.
    const retries = options.retries ?? (method === 'GET' ? DEFAULT_GET_RETRIES : 0);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await this.fetchOnce<T>(path, method, options.body, options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      } catch (error) {
        const retryable = error instanceof OfficeNetworkError || error instanceof OfficeTimeoutError;
        if (!retryable || attempt > retries) throw error;
        await wait(backoffDelay(attempt), options.signal);
      }
    }
  }

  private async fetchOnce<T>(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<T> {
    const timeout = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeout.abort(new OfficeTimeoutError());
    }, timeoutMs);
    const signal = composeSignals(timeout.signal, callerSignal);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.token) headers['X-Office-Session'] = this.token;

      let response: Response;
      try {
        response = await fetch(`${this.api}/api/office/${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal,
        });
      } catch (error) {
        if (timedOut) throw new OfficeTimeoutError();
        if (callerSignal?.aborted) throw callerAbortError(callerSignal);
        throw new OfficeNetworkError(error instanceof Error ? error.message : undefined);
      }

      // The timer stays armed through this read, so a stalled body is still
      // bounded by the same deadline as the request headers.
      const parsed = await abortable(response.json(), signal);
      let data: unknown;
      if (parsed.ok) {
        data = parsed.value;
      } else {
        if (timedOut) throw new OfficeTimeoutError();
        if (callerSignal?.aborted) throw callerAbortError(callerSignal);
        data = undefined;
      }

      if (response.status === 401) {
        this.clearSession();
        throw new OfficeUnauthorizedError(errorMessageFrom(data));
      }
      if (!response.ok) {
        throw new OfficeHttpError(response.status, errorMessageFrom(data));
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async availability(): Promise<Occupant[]> {
    if (this.api) {
      const data = await this.request<{ characters: Occupant[] }>('characters');
      return data.characters;
    }
    if (!navigator.locks) throw new OfficeError('Browser ini tidak mendukung sesi preview. Gunakan Chrome/Edge terbaru.');
    const snapshot = await navigator.locks.query();
    return Array.from({ length: 6 }, (_, i) => ({ id: i + 1, active: snapshot.held?.some(lock => lock.name === `office-character-${i + 1}`) || false }));
  }

  async claim(id: number): Promise<void> {
    if (this.api) {
      const data = await this.request<{ token: string }>('claim', { body: { id }, method: 'POST' });
      this.token = data.token;
      this.id = id;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(`office-character-${id}`, { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('Karakter baru saja dipakai. Pilih yang lain.')); return; }
        this.id = id;
        await new Promise<void>(release => { this.releaseLock = release; resolve(); });
      }).catch(reject);
    });
  }

  async release(): Promise<void> {
    if (this.api && this.token) await this.request<{ ok: boolean }>('release', { body: {}, method: 'POST' });
    this.clearSession();
  }

  async heartbeat(position: { x: number; y: number; direction: string; status: string }): Promise<void> {
    await this.request<{ ok: boolean }>('heartbeat', { body: position, method: 'POST' });
  }

  // `afterSeq` fetches only messages newer than the cursor; omitting it returns
  // the retained history for the initial load.
  async messages(afterSeq?: number): Promise<OfficeMessage[]> {
    const query = afterSeq === undefined ? '' : `?afterSeq=${encodeURIComponent(String(afterSeq))}`;
    const data = await this.request<{ messages: OfficeMessage[] }>(`messages${query}`);
    return data.messages;
  }

  async sendMessage(text: string): Promise<void> {
    await this.request<{ ok: boolean }>('messages', { body: { text }, method: 'POST' });
  }
}
