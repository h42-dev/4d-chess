import { afterEach, describe, expect, it, vi } from 'vitest';
import { askGemini, askOpenAICompatible, listModels } from './http';
import { slotPlayer } from './types';

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
    const out = await askGemini({ provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'g-key' }, 'S', 'U', signal);
    expect(out).toBe('{"move":"e2→e4"}');
    expect(calls[0].url).toContain('/models/gemini-3.8-flash:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(JSON.parse(String(calls[0].init.body)).generationConfig.responseMimeType).toBe('application/json');
  });

  it('explains a bad key', async () => {
    mockFetch(401, { error: { message: 'Incorrect API key provided' } });
    await expect(askOpenAICompatible({ provider: 'openai', model: 'gpt-5', apiKey: 'bad' }, 'S', 'U', signal)).rejects.toThrow(/401 \(check the API key\): Incorrect API key/);
  });

  it('Gemini: a bad key says so (Google answers 400, not 401)', async () => {
    mockFetch(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    await expect(askGemini({ provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'bad' }, 'S', 'U', signal)).rejects.toThrow(/check the API key/);
  });

  it('Gemini: a model the key cannot use points to “Find my models”', async () => {
    mockFetch(404, { error: { code: 404, message: 'models/gemini-2.5-pro is not found for API version v1beta', status: 'NOT_FOUND' } });
    await expect(askGemini({ provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'k' }, 'S', 'U', signal)).rejects.toThrow(/Find my models/);
  });

  it('Find my models: Gemini lists only text models the key can use', async () => {
    const calls = mockFetch(200, {
      models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    expect(await listModels({ provider: 'gemini', model: '', apiKey: 'k' })).toEqual(['gemini-3.8-flash', 'gemini-3.1-pro-preview']);
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });

  it('Find my models: OpenAI keeps chat models only', async () => {
    mockFetch(200, { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }, { id: 'gpt-6-realtime' }, { id: 'dall-e-3' }] });
    expect(await listModels({ provider: 'openai', model: '', apiKey: 'k' })).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
  });

  it('saved settings that still name an old restricted default move to the new one', () => {
    const p = slotPlayer({ remember: true, keys: { gemini: 'k' }, slots: { opp: { provider: 'gemini', model: 'gemini-2.5-pro' } } }, 'opp', 'claude');
    expect(p.model).toBe('gemini-3.8-flash');
    expect(p.apiKey).toBe('k');
    const kept = slotPlayer({ remember: true, keys: {}, slots: { opp: { provider: 'gemini', model: 'gemini-3.7-flash' } } }, 'opp', 'claude');
    expect(kept.model).toBe('gemini-3.7-flash');
  });
});
