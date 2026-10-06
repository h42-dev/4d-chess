import type { BotLevel } from '../engine/bot';

export type ProviderId = 'builtin' | 'claude' | 'openai' | 'gemini' | 'openrouter' | 'local' | 'custom';
export type Effort = 'low' | 'medium' | 'high';

/** One AI player: which service plays, with which model and credentials. */
export interface AiPlayer {
  provider: ProviderId;
  /** model id, or the built-in bot's level */
  model: string;
  apiKey?: string;
  /** OpenAI-compatible base URL (local models) or your own bot's URL */
  baseUrl?: string;
  /** how hard Claude thinks before moving */
  effort?: Effort;
}

export interface ProviderInfo {
  label: string;
  short: string;
  needsKey: boolean;
  needsUrl: boolean;
  defaultModel: string;
  /** suggested models; the model field also accepts any other id */
  models: string[];
  defaultUrl?: string;
  keyUrl?: string;
  help: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  builtin: {
    label: 'Built-in bot',
    short: 'Bot',
    needsKey: false,
    needsUrl: false,
    defaultModel: 'medium',
    models: ['easy', 'medium', 'hard'],
    help: 'The game’s own engine. Free, runs in your browser.',
  },
  claude: {
    label: 'Claude (Anthropic)',
    short: 'Claude',
    needsKey: true,
    needsUrl: false,
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1'],
    keyUrl: 'https://platform.claude.com/settings/keys',
    help: 'Uses your Anthropic API key. Each move is one request billed to your account.',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    short: 'GPT',
    needsKey: true,
    needsUrl: false,
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    help: 'Uses your OpenAI API key. Type any model id your key can use.',
  },
  gemini: {
    label: 'Gemini (Google)',
    short: 'Gemini',
    needsKey: true,
    needsUrl: false,
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
    help: 'Uses your Google AI Studio key. Type any model id your key can use.',
  },
  openrouter: {
    label: 'OpenRouter (any model)',
    short: 'OpenRouter',
    needsKey: true,
    needsUrl: false,
    defaultModel: 'anthropic/claude-opus-5-5',
    models: ['anthropic/claude-opus-5-5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'meta-llama/llama-4-maverick'],
    keyUrl: 'https://openrouter.ai/keys',
    help: 'One key for hundreds of models. Use the model id from openrouter.ai/models.',
  },
  local: {
    label: 'Local model (Ollama / LM Studio)',
    short: 'Local',
    needsKey: false,
    needsUrl: true,
    defaultModel: 'llama3.1',
    models: [],
    defaultUrl: 'http://localhost:11434/v1',
    help: 'Any OpenAI-compatible server on your computer. Ollama needs OLLAMA_ORIGINS set to this site’s address.',
  },
  custom: {
    label: 'Your own bot (URL)',
    short: 'Your bot',
    needsKey: false,
    needsUrl: true,
    defaultModel: '',
    models: [],
    defaultUrl: 'http://localhost:8000/move',
    help: 'Your program gets the position and the legal moves as JSON and answers with a move. See the README for the format.',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['builtin', 'claude', 'openai', 'gemini', 'openrouter', 'local', 'custom'];

export function defaultPlayer(provider: ProviderId): AiPlayer {
  const p = PROVIDERS[provider];
  return { provider, model: p.defaultModel, baseUrl: p.defaultUrl, effort: provider === 'claude' ? 'medium' : undefined };
}

/** Short display name, e.g. "Claude · claude-opus-5-5" or "Bot · hard". */
export function playerName(a: AiPlayer): string {
  const p = PROVIDERS[a.provider];
  if (a.provider === 'custom') return 'Your bot';
  return a.model ? `${p.short} · ${a.model}` : p.short;
}

export const builtinLevel = (a: AiPlayer): BotLevel => (['easy', 'medium', 'hard'].includes(a.model) ? (a.model as BotLevel) : 'medium');

// ---------------------------------------------------------------------------
// Saved connections (this browser only). Keys never leave the browser except to the provider itself.

/** opp = the AI you play against; w / b = the two AIs in an AI vs AI game */
export type SlotId = 'opp' | 'w' | 'b';

export interface SavedAi {
  remember: boolean;
  keys: Partial<Record<ProviderId, string>>;
  slots: Partial<Record<SlotId, Omit<AiPlayer, 'apiKey'>>>;
}

const KEY = '4d-chess.ai';

export function loadSaved(): SavedAi {
  const fallback: SavedAi = { remember: true, keys: {}, slots: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    /* unavailable */
  }
  return fallback;
}

export function saveSaved(s: SavedAi) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.remember ? s : { ...s, keys: {} }));
  } catch {
    /* not persisted */
  }
}

/** The player saved in a slot, with its provider's key filled in. */
export function slotPlayer(saved: SavedAi, slot: SlotId, fallback: ProviderId): AiPlayer {
  const base = saved.slots[slot] ?? defaultPlayer(fallback);
  return { ...base, apiKey: saved.keys[base.provider] };
}
