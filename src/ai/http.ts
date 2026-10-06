import type { AiPlayer } from './types';

/**
 * What went wrong with a provider, so the game can react sensibly:
 * busy (overloaded, 5xx) and rate (too many requests right now) are worth waiting out;
 * quota (daily/free allowance used up or out of credit), key and model need the player.
 */
export type ProblemKind = 'busy' | 'rate' | 'quota' | 'key' | 'model' | 'other';

export class ProviderError extends Error {
  status: number;
  kind: ProblemKind;
  /** how long the provider asked us to wait, if it said */
  retryAfterMs?: number;
  constructor(message: string, status: number, kind: ProblemKind, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

/** "37s", "1.5s" → milliseconds */
const durationMs = (d: unknown) => (typeof d === 'string' && /^[\d.]+s$/.test(d) ? Math.round(parseFloat(d) * 1000) : undefined);

const HINTS: Record<ProblemKind, string> = {
  busy: 'the service is overloaded right now; this usually passes in a minute',
  rate: 'too many requests for this key right now. Free keys only allow a few per minute',
  quota: 'this key’s allowance is used up (daily free limit or credit). Try another model, since each has its own limit, wait for it to reset, or add billing',
  key: 'check the API key',
  model: 'this key may not be able to use that model; press “Find my models”',
  other: '',
};

/** Reads a failed response into a ProviderError, using the provider's own message and hints. */
export async function problemOf(res: Response, who: string): Promise<ProviderError> {
  let body: { error?: { message?: string; code?: string | number; status?: string; details?: Record<string, unknown>[] } | string; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const err = typeof body.error === 'object' ? body.error : undefined;
  const detail = String(err?.message ?? (typeof body.error === 'string' ? body.error : '') ?? body.message ?? '');
  const details = err?.details ?? [];
  const typeOf = (d: Record<string, unknown>) => String(d['@type'] ?? '');

  // Google sends how long to wait (RetryInfo) and which quota ran out (QuotaFailure).
  const googleWait = durationMs(details.find((d) => typeOf(d).endsWith('RetryInfo'))?.retryDelay);
  const header = Number(res.headers.get('retry-after'));
  const retryAfterMs = googleWait ?? (header > 0 ? header * 1000 : undefined);
  const violations = (details.find((d) => typeOf(d).endsWith('QuotaFailure'))?.violations as { quotaId?: string; quotaMetric?: string }[] | undefined) ?? [];
  const daily = violations.some((v) => /PerDay|per_day|daily/i.test(`${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`));

  let kind: ProblemKind;
  if (res.status >= 500) kind = 'busy'; // checked first: busy messages often mention "model"
  // Google says "exceeded your current quota" for per-minute limits too; those come with a wait time.
  else if (res.status === 429) kind = daily || err?.code === 'insufficient_quota' || (/quota|billing|credit/i.test(detail) && !googleWait) ? 'quota' : 'rate';
  else if (/api key|apikey|unauthori[sz]ed|invalid.*key|incorrect.*key/i.test(detail) || res.status === 401) kind = 'key';
  else if (/model/i.test(detail) || res.status === 404 || res.status === 403) kind = 'model';
  else kind = 'other';

  const hint = HINTS[kind] ? ` (${HINTS[kind]})` : '';
  return new ProviderError(`${who} returned ${res.status}${hint}${detail ? `: ${detail.slice(0, 200)}` : ''}`, res.status, kind, retryAfterMs);
}

async function fail(res: Response, who: string): Promise<never> {
  throw await problemOf(res, who);
}

function network(e: unknown, who: string, url: string): never {
  if ((e as Error).name === 'AbortError') throw e;
  throw new Error(`Couldn't reach ${who} at ${url}. If it's on your computer, make sure it's running and allows requests from this site (CORS).`);
}

/** Short in-request retries for brief overloads. Shortened in tests. */
export const retryPolicy = { delays: [2000, 5000], maxWaitMs: 15_000 };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * fetch, retried a couple of times when the provider is briefly overloaded or rate limiting.
 * If it asks for a longer wait than we're willing to block for, the error is passed up with that
 * wait so the game can count it down and try again by itself.
 */
async function request(url: string, init: RequestInit, who: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      network(e, who, url);
    }
    if (res.ok) return res;
    const err = await problemOf(res, who);
    const wait = err.retryAfterMs ?? retryPolicy.delays[attempt];
    const worthWaiting = (err.kind === 'busy' || err.kind === 'rate') && attempt < retryPolicy.delays.length && wait <= retryPolicy.maxWaitMs;
    if (!worthWaiting) throw err;
    await sleep(wait, signal);
  }
}

/** OpenAI, OpenRouter and local servers (Ollama, LM Studio…) all speak the OpenAI chat format. */
export async function askOpenAICompatible(player: AiPlayer, system: string, user: string, signal: AbortSignal): Promise<string> {
  const base =
    player.provider === 'openai' ? 'https://api.openai.com/v1' : player.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : (player.baseUrl ?? '').replace(/\/+$/, '');
  const who = player.provider === 'openai' ? 'OpenAI' : player.provider === 'openrouter' ? 'OpenRouter' : 'Your local model';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (player.apiKey) headers.Authorization = `Bearer ${player.apiKey}`;
  if (player.provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = '4D Chess';
  }
  const body: Record<string, unknown> = {
    model: player.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  // Local servers don't all support JSON mode; the prompt asks for JSON anyway.
  if (player.provider !== 'local') body.response_format = { type: 'json_object' };

  const url = `${base}/chat/completions`;
  const res = await request(url, { method: 'POST', headers, body: JSON.stringify(body) }, who, signal);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export async function askGemini(player: AiPlayer, system: string, user: string, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(player.model)}:generateContent`;
  const res = await request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': player.apiKey ?? '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
    'Gemini',
    signal,
  );
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
}

/** The body sent to your own bot's URL. Documented in the README ("Bot API"). */
export interface BotRequest {
  protocol: '4d-chess-bot/1';
  variant: 'time' | '4d';
  you: 'white' | 'black';
  turn: number;
  /** the same text description an LLM gets */
  position: string;
  /** every legal move in notation; answer with one of these */
  legalMoves: string[];
  /** moves so far, in notation */
  history: string[];
  /** the full engine state, for bots that want to compute themselves */
  state: unknown;
}

export async function askCustom(player: AiPlayer, request: BotRequest, signal: AbortSignal): Promise<string> {
  const url = player.baseUrl ?? '';
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
  } catch (e) {
    network(e, 'your bot', url);
  }
  if (!res.ok) await fail(res, 'Your bot');
  const data = await res.json();
  if (typeof data?.index === 'number' && request.legalMoves[data.index]) {
    return JSON.stringify({ move: request.legalMoves[data.index], comment: data.comment });
  }
  return JSON.stringify(data);
}

/**
 * Asks the provider which models this key can use, so nobody has to guess model ids.
 * Returns ids in the provider's own order, chat/text models only where the API says so.
 */
export async function listModels(player: AiPlayer, signal?: AbortSignal): Promise<string[]> {
  let url: string;
  const headers: Record<string, string> = {};
  switch (player.provider) {
    case 'gemini':
      url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
      headers['x-goog-api-key'] = player.apiKey ?? '';
      break;
    case 'openai':
      url = 'https://api.openai.com/v1/models';
      headers.Authorization = `Bearer ${player.apiKey ?? ''}`;
      break;
    case 'openrouter':
      url = 'https://openrouter.ai/api/v1/models';
      break;
    case 'local':
      url = `${(player.baseUrl ?? '').replace(/\/+$/, '')}/models`;
      break;
    default:
      return [];
  }
  const who = player.provider === 'gemini' ? 'Gemini' : player.provider === 'openai' ? 'OpenAI' : player.provider === 'openrouter' ? 'OpenRouter' : 'Your local model';
  const res = await request(url, { headers }, who, signal);
  const data = await res.json();
  if (player.provider === 'gemini') {
    return (data?.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''))
      .filter((id: string) => !/embedding|tts|image|transcribe|live|veo|imagen|aqa/i.test(id));
  }
  const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);
  return player.provider === 'openai' ? ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|transcribe|tts|image|embedding|search/.test(id)) : ids;
}
