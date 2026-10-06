import { afterEach, describe, expect, it, vi } from 'vitest';
import { askGemini, askOpenAICompatible } from './http';

function mockFetch(status: number, json: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;

describe('other AI providers', () => {
  it('OpenRouter: OpenAI chat format, bearer key, JSON mode', async () => {
    const calls = mockFetch(200, { choices: [{ message: { content: '{"move":"e2→e4"}' } }] });
    vi.stubGlobal('location', { origin: 'https://four-d-chess.web.app' });
    const out = await askOpenAICompatible({ provider: 'openrouter', model: 'openai/gpt-5', apiKey: 'or-key' }, 'S', 'U', signal);
    expect(out).toBe('{"move":"e2→e4"}');
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer or-key');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('local servers: custom base URL, no key, no JSON mode', async () => {
    const calls = mockFetch(200, { choices: [{ message: { content: 'x' } }] });
    await askOpenAICompatible({ provider: 'local', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1/' }, 'S', 'U', signal);
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0].init.body)).response_format).toBeUndefined();
  });

  it('Gemini: key in a header, system instruction, JSON output', async () => {
    const calls = mockFetch(200, { candidates: [{ content: { parts: [{ text: '{"move":' }, { text: '"e2→e4"}' }] } }] });
    const out = await askGemini({ provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'g-key' }, 'S', 'U', signal);
    expect(out).toBe('{"move":"e2→e4"}');
    expect(calls[0].url).toContain('/models/gemini-2.5-pro:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(JSON.parse(String(calls[0].init.body)).generationConfig.responseMimeType).toBe('application/json');
  });

  it('explains a bad key', async () => {
    mockFetch(401, { error: { message: 'Incorrect API key provided' } });
    await expect(askOpenAICompatible({ provider: 'openai', model: 'gpt-5', apiKey: 'bad' }, 'S', 'U', signal)).rejects.toThrow(/401 \(check the API key\): Incorrect API key/);
  });
});
