// Frontend behavior tests for lib/office-session.ts.
//
// These run on the stock Node 22 toolchain (`node --test`, TypeScript type
// stripping) with no browser framework or network: `fetch` is replaced with a
// deterministic stub per test. They pin the session behavior that the UI relies
// on: a 5s AbortController timeout, caller-signal composition, typed HTTP
// classification, a typed 401 that clears the local session, bounded network
// retry that never replays unsafe writes, and incremental message merging.

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  OfficeError,
  OfficeHttpError,
  OfficeNetworkError,
  OfficeSession,
  OfficeTimeoutError,
  OfficeUnauthorizedError,
  backoffDelay,
  latestSeq,
  mergeMessages,
  reduceChatPoll,
  type OfficeMessage,
} from '../lib/office-session.ts';

const API = 'https://office.test';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type FetchCall = { url: string; init: RequestInit };

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function installFetch(handler: (call: FetchCall) => Promise<Response> | Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: requestUrl(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function configuredSession(): OfficeSession {
  const session = new OfficeSession();
  session.api = API;
  return session;
}

function message(seq: number, overrides: Partial<OfficeMessage> = {}): OfficeMessage {
  return { id: `msg-${seq}`, seq, name: 'Farkhan', text: `t${seq}`, time: '09:00', sprite: 0, ...overrides };
}

// Fails a test if the operation never settles, instead of hanging the runner.
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('deadline exceeded')), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function hangingResponse(): Response {
  return { ok: true, status: 200, json: () => new Promise<never>(() => {}) } as unknown as Response;
}

void test('session uses a 5 second default timeout capped by a 30 second backoff ceiling', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 5000);
  assert.equal(MAX_BACKOFF_MS, 30000);
});

void test('backoffDelay grows but never exceeds the 30 second ceiling', () => {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const delay = backoffDelay(attempt, () => 1);
    assert.ok(delay >= 0, `delay ${delay} for attempt ${attempt}`);
    assert.ok(delay <= MAX_BACKOFF_MS, `delay ${delay} for attempt ${attempt}`);
  }
  // Attempt 1 with a deterministic random must stay meaningfully below the cap.
  assert.ok(backoffDelay(1, () => 1) < MAX_BACKOFF_MS);
});

void test('request aborts with a typed timeout error after the default timeout', async () => {
  installFetch(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = call.init.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );

  const session = configuredSession();
  await assert.rejects(
    () => session.request('characters', { retries: 0, timeoutMs: 25 }),
    (error: unknown) => error instanceof OfficeTimeoutError,
  );
});

void test('request composes a caller signal and surfaces the caller abort', async () => {
  installFetch(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = call.init.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );

  const session = configuredSession();
  const controller = new AbortController();
  const pending = session.request('characters', { retries: 0, signal: controller.signal });
  controller.abort(new Error('caller-cancelled'));
  await assert.rejects(pending, /caller-cancelled/);
});

void test('availability returns the typed character list', async () => {
  const calls = installFetch(() =>
    jsonResponse({ characters: [{ id: 1, active: true, x: 10, y: 20, direction: 'up', status: 'Available' }] }),
  );

  const session = configuredSession();
  const rows = await session.availability();
  assert.deepEqual(rows, [{ id: 1, active: true, x: 10, y: 20, direction: 'up', status: 'Available' }]);
  assert.equal(calls[0]?.url, `${API}/api/office/characters`);
});

void test('messages encodes the afterSeq cursor and returns typed messages', async () => {
  const calls = installFetch(() => jsonResponse({ messages: [message(43)] }));

  const session = configuredSession();
  const rows = await session.messages(42);
  assert.deepEqual(rows.map((row) => row.seq), [43]);
  assert.equal(calls[0]?.url, `${API}/api/office/messages?afterSeq=42`);
});

void test('claim stores the session token and id on success', async () => {
  installFetch(() => jsonResponse({ token: 'token-123' }));

  const session = configuredSession();
  await session.claim(3);
  assert.equal(session.token, 'token-123');
  assert.equal(session.id, 3);
});

void test('a 401 clears the local session and is not retried', async () => {
  const calls = installFetch(() => jsonResponse({ message: 'Sesi berakhir.' }, 401));

  const session = configuredSession();
  session.token = 'stale-token';
  session.id = 2;

  await assert.rejects(
    () => session.request('characters'),
    (error: unknown) => error instanceof OfficeUnauthorizedError && error.status === 401,
  );
  assert.equal(session.token, '');
  assert.equal(session.id, null);
  assert.equal(calls.length, 1);
});

void test('unsafe POST writes are never replayed after a network failure', async () => {
  const calls = installFetch(() => Promise.reject(new TypeError('network down')));

  const session = configuredSession();
  session.token = 'token-123';
  session.id = 1;

  await assert.rejects(() => session.sendMessage('halo'), (error: unknown) => error instanceof OfficeNetworkError);
  assert.equal(calls.length, 1);
});

void test('safe GET requests retry a bounded number of times', async () => {
  const calls = installFetch(() => Promise.reject(new TypeError('network down')));

  const session = configuredSession();
  await assert.rejects(
    () => session.request('characters', { retries: 1 }),
    (error: unknown) => error instanceof OfficeNetworkError,
  );
  assert.equal(calls.length, 2);
});

void test('mergeMessages appends only new messages, ordered and deduplicated', () => {
  const existing = [message(1), message(2)];
  const merged = mergeMessages(existing, [message(2), message(4), message(3)]);

  assert.deepEqual(merged.map((row) => row.seq), [1, 2, 3, 4]);
  assert.equal(merged.filter((row) => row.seq === 2).length, 1);
});

void test('mergeMessages bounds the rendered history to the retained window', () => {
  const incoming = Array.from({ length: 205 }, (_, index) => message(index + 1));
  const merged = mergeMessages([], incoming);
  assert.equal(merged.length, 200);
  assert.equal(merged[0]?.seq, 6);
  assert.equal(merged.at(-1)?.seq, 205);
});

void test('latestSeq reports the highest sequence and zero for empty history', () => {
  assert.equal(latestSeq([]), 0);
  assert.equal(latestSeq([message(7), message(3)]), 7);
});

// Blocker 1: a 401 anywhere (heartbeat, send, messages) clears the local session
// and must notify the UI through one centralized subscription so React never
// keeps showing a stale "active" state.
void test('a 401 notifies session-cleared subscribers exactly once', async () => {
  installFetch(() => jsonResponse({ message: 'Sesi berakhir.' }, 401));

  const session = configuredSession();
  session.token = 'stale-token';
  session.id = 2;
  let notified = 0;
  session.onSessionCleared(() => { notified += 1; });

  await assert.rejects(
    () => session.request('characters'),
    (error: unknown) => error instanceof OfficeUnauthorizedError,
  );
  assert.equal(notified, 1);
  assert.equal(session.token, '');
  assert.equal(session.id, null);
});

void test('an explicit release notifies session-cleared subscribers', async () => {
  installFetch(() => jsonResponse({ ok: true }));

  const session = configuredSession();
  session.token = 'token-123';
  session.id = 3;
  let notified = 0;
  session.onSessionCleared(() => { notified += 1; });

  await session.release();
  assert.equal(notified, 1);
  assert.equal(session.token, '');
  assert.equal(session.id, null);
});

void test('unsubscribing stops session-cleared notifications', async () => {
  installFetch(() => jsonResponse({ ok: true }));

  const session = configuredSession();
  session.token = 'token-123';
  session.id = 3;
  let notified = 0;
  const unsubscribe = session.onSessionCleared(() => { notified += 1; });
  unsubscribe();

  await session.release();
  assert.equal(notified, 0);
});

// Blocker 2: the timeout must cover parsing the response body, not just the
// fetch() headers promise. A stalled body still has to settle as a timeout.
void test('timeout also covers a response body that never settles', async () => {
  installFetch(() => hangingResponse());

  const session = configuredSession();
  await assert.rejects(
    () => withDeadline(session.request('characters', { retries: 0, timeoutMs: 25 }), 1000),
    (error: unknown) => error instanceof OfficeTimeoutError,
  );
});

void test('a caller abort during body parsing keeps the caller reason', async () => {
  installFetch(() => hangingResponse());

  const session = configuredSession();
  const controller = new AbortController();
  const pending = session.request('characters', { retries: 0, signal: controller.signal });
  controller.abort(new Error('caller-cancelled'));
  await assert.rejects(withDeadline(pending, 1000), /caller-cancelled/);
});

// Blocker 3: the first successful poll — even an empty one — only primes the
// chat cursor; the first message that arrives later is announced exactly once.
void test('initial empty chat poll is silent but marks chat initialized', () => {
  const first = reduceChatPoll({ initialized: false, seq: 0 }, []);
  assert.deepEqual(first, { state: { initialized: true, seq: 0 }, announcement: null });

  const second = reduceChatPoll(first.state, [message(1)]);
  assert.equal(second.announcement, 'Farkhan: t1');
  assert.equal(second.state.seq, 1);

  const third = reduceChatPoll(second.state, []);
  assert.equal(third.announcement, null);
});

void test('initial retained history renders without announcing', () => {
  const result = reduceChatPoll({ initialized: false, seq: 0 }, [message(5), message(6)]);
  assert.equal(result.announcement, null);
  assert.equal(result.state.seq, 6);
  assert.equal(result.state.initialized, true);
});

// Blocker 5: configure() must be bounded and classified like every other
// request, and must never surface credentials in its errors.
void test('configure times out on a hanging config fetch', async () => {
  installFetch(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = call.init.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );

  const session = new OfficeSession();
  await assert.rejects(
    () => withDeadline(session.configure({ timeoutMs: 25 }), 1000),
    (error: unknown) => error instanceof OfficeTimeoutError,
  );
});

void test('configure times out on a hanging config body', async () => {
  installFetch(() => hangingResponse());

  const session = new OfficeSession();
  await assert.rejects(
    () => withDeadline(session.configure({ timeoutMs: 25 }), 1000),
    (error: unknown) => error instanceof OfficeTimeoutError,
  );
});

void test('configure classifies a network failure', async () => {
  installFetch(() => Promise.reject(new TypeError('network down')));

  const session = new OfficeSession();
  await assert.rejects(() => session.configure(), (error: unknown) => error instanceof OfficeNetworkError);
});

void test('configure classifies a non-OK response without leaking the token', async () => {
  installFetch(() => jsonResponse({ message: 'nope' }, 500));

  const session = new OfficeSession();
  session.token = 'secret-token';
  await assert.rejects(
    () => session.configure(),
    (error: unknown) =>
      error instanceof OfficeHttpError && error.status === 500 && !error.message.includes('secret-token'),
  );
  assert.equal(session.api, '');
});

void test('configure classifies a malformed config body', async () => {
  installFetch(() => ({ ok: true, status: 200, json: async () => 'not-an-object' }) as unknown as Response);

  const session = new OfficeSession();
  await assert.rejects(
    () => session.configure(),
    (error: unknown) =>
      error instanceof OfficeError && !(error instanceof OfficeHttpError) && !(error instanceof OfficeTimeoutError),
  );
});

void test('configure stores a trimmed api url on success', async () => {
  installFetch(() => jsonResponse({ apiUrl: 'https://office.test/' }));

  const session = new OfficeSession();
  await session.configure();
  assert.equal(session.api, 'https://office.test');
});
