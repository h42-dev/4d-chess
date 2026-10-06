import type { AiPlayer } from './types';

/** Turns a failed HTTP response into a readable error, using the provider's message when it has one. */
async function fail(res: Response, who: string): Promise<never> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? body?.error ?? body?.message ?? '';
  } catch {
    /* not JSON */
  }
  const hint = res.status === 401 || res.status === 403 ? ' (check the API key)' : res.status === 404 ? ' (check the model name or URL)' : res.status === 429 ? ' (rate limited or out of credit)' : '';
  throw new Error(`${who} returned ${res.status}${hint}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
}

function network(e: unknown, who: string, url: string): never {
  if ((e as Error).name === 'AbortError') throw e;
  throw new Error(`Couldn't reach ${who} at ${url}. If it's on your computer, make sure it's running and allows requests from this site (CORS).`);
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
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    network(e, who, url);
  }
  if (!res.ok) await fail(res, who);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export async function askGemini(player: AiPlayer, system: string, user: string, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(player.model)}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': player.apiKey ?? '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal,
    });
  } catch (e) {
    network(e, 'Gemini', url);
  }
  if (!res.ok) await fail(res, 'Gemini');
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
