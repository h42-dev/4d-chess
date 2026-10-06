import { afterEach, describe, expect, it, vi } from 'vitest';
import { askClaude } from './claude';

/** Stands in for api.anthropic.com: records the request and returns a canned message. */
function mockApi(reply: { text?: string; stop_reason?: string }) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }],
          stop_reason: reply.stop_reason ?? 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } },
      );
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Claude player', () => {
  it('asks Opus 5.5 for structured JSON with effort and default fallbacks', async () => {
    const calls = mockApi({ text: '{"move":"e2→e4","comment":"centre"}' });
    const text = await askClaude({ provider: 'claude', model: 'claude-opus-5-5', apiKey: 'test-key', effort: 'high' }, 'SYSTEM', 'USER', new AbortController().signal);
    expect(text).toBe('{"move":"e2→e4","comment":"centre"}');
    const { url, headers, body } = calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.system).toBe('SYSTEM');
    expect(body.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
    expect(body.thinking).toBeUndefined(); // Opus 5.5 always thinks adaptively; effort controls depth
  });

  it('leaves out effort and fallbacks for Haiku', async () => {
    const calls = mockApi({ text: '{"move":"e2→e4","comment":"x"}' });
    await askClaude({ provider: 'claude', model: 'claude-haiku-4-5', apiKey: 'k' }, 'S', 'U', new AbortController().signal);
    const { headers, body } = calls[0];
    expect(body.fallbacks).toBeUndefined();
    expect(headers.get('anthropic-beta')).toBeNull();
    expect((body.output_config as Record<string, unknown>).effort).toBeUndefined();
  });

  it('reports a refusal instead of returning an empty move', async () => {
    mockApi({ stop_reason: 'refusal' });
    await expect(askClaude({ provider: 'claude', model: 'claude-opus-5-5', apiKey: 'k' }, 'S', 'U', new AbortController().signal)).rejects.toThrow(/declined/);
  });
});
