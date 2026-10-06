import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from './http';
import type { AiPlayer } from './types';

/** The reply every model is asked for. */
const MOVE_SCHEMA = {
  type: 'object',
  properties: {
    move: { type: 'string', description: 'One legal move, written exactly as in the list' },
    comment: { type: 'string', description: 'One short sentence explaining the idea' },
  },
  required: ['move', 'comment'],
  additionalProperties: false,
};

/** Models that accept server-side refusal fallbacks ("default" form). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/**
 * Asks Claude for a move. Runs in the browser with the player's own key (the key only ever goes to
 * api.anthropic.com). Uses structured outputs so the reply is always {"move", "comment"} JSON, and
 * server-side fallbacks so a declined request is retried on another model instead of failing.
 */
export async function askClaude(player: AiPlayer, system: string, user: string, signal: AbortSignal): Promise<string> {
  const client = new Anthropic({ apiKey: player.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const model = player.model || 'claude-opus-5-5';
  const haiku = model.startsWith('claude-haiku');
  const fallback = FALLBACK_MODELS.has(model);

  const response = await client.beta.messages
    .create(
      {
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: {
          // Haiku doesn't take an effort setting; on the others it controls how long Claude thinks.
          ...(haiku ? {} : { effort: player.effort ?? 'medium' }),
          format: { type: 'json_schema', schema: MOVE_SCHEMA },
        },
        ...(fallback ? { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] } : {}),
      },
      { signal },
    )
    .catch((e: unknown) => {
      throw toProviderError(e);
    });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to choose a move');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before answering');
  return response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** Turns an SDK error into the same kind of error the other providers give, so the game can wait out busy spells. */
function toProviderError(e: unknown): unknown {
  if (!(e instanceof Anthropic.APIError) || e.status === undefined) return e;
  const after = Number(e.headers?.get('retry-after'));
  const wait = after > 0 ? after * 1000 : undefined;
  const msg = (hint: string) => `Claude returned ${e.status} (${hint}): ${e.message.slice(0, 200)}`;
  if (e.status === 529 || e.status >= 500) return new ProviderError(msg('Anthropic is overloaded right now; this usually passes in a minute'), e.status, 'busy', wait);
  if (e.status === 429) return new ProviderError(msg('too many requests for this key right now'), e.status, 'rate', wait);
  if (e.status === 401 || e.status === 403) return new ProviderError(msg('check the API key'), e.status, 'key');
  if (e.status === 404) return new ProviderError(msg('check the model name'), e.status, 'model');
  if (e.status === 400 && /credit|billing/i.test(e.message)) return new ProviderError(msg('out of credit; add billing'), e.status, 'quota');
  return e;
}
