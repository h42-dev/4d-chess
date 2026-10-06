import Anthropic from '@anthropic-ai/sdk';
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

  const response = await client.beta.messages.create(
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
  );

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to choose a move');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before answering');
  return response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}
