import { useState } from 'react';
import { defaultPlayer, PROVIDER_ORDER, PROVIDERS, type AiPlayer, type Effort, type ProviderId } from '../ai/types';
import { moveText, newGame } from '../engine/game';

interface Props {
  title: string;
  value: AiPlayer;
  /** the key this browser has for each provider, so switching provider brings its key back */
  keys: Partial<Record<ProviderId, string>>;
  variant: 'time' | '4d';
  onChange: (p: AiPlayer) => void;
}

const EFFORTS: { id: Effort; label: string; note: string }[] = [
  { id: 'low', label: 'Quick', note: 'Fast, cheaper, weaker' },
  { id: 'medium', label: 'Balanced', note: 'Default' },
  { id: 'high', label: 'Deep', note: 'Slower, stronger, costs more' },
];

/** Picks and configures one AI player: provider, model, key or URL, and a connection test. */
export function AiSlot({ title, value, keys, variant, onChange }: Props) {
  const info = PROVIDERS[value.provider];
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({ state: 'idle' });
  /** models the provider says this key can use (null until looked up) */
  const [found, setFound] = useState<{ provider: ProviderId; ids: string[]; note?: string; error?: string } | null>(null);
  const [finding, setFinding] = useState(false);
  const canList = ['gemini', 'openai', 'openrouter', 'local'].includes(value.provider);

  const findModels = async () => {
    setFinding(true);
    try {
      const { listModels } = await import('../ai/http');
      const ids = await listModels(value);
      if (!ids.length) {
        setFound({ provider: value.provider, ids, error: 'No usable models came back for this key.' });
      } else if (!ids.includes(value.model)) {
        // The current model isn't available to this key: switch to the default if allowed, else the first one.
        const pick = ids.includes(info.defaultModel) ? info.defaultModel : ids[0];
        onChange({ ...value, model: pick });
        setFound({ provider: value.provider, ids, note: `${ids.length} models available. “${value.model || '(none)'}” isn’t one of them, so I picked ${pick}.` });
      } else {
        setFound({ provider: value.provider, ids, note: `${ids.length} models available, including the one selected.` });
      }
    } catch (e) {
      setFound({ provider: value.provider, ids: [], error: (e as Error).message });
    } finally {
      setFinding(false);
    }
  };
  const suggestions = found && found.provider === value.provider && found.ids.length ? found.ids : info.models;
  const set = (p: Partial<AiPlayer>) => {
    setTest({ state: 'idle' });
    onChange({ ...value, ...p });
  };

  const runTest = async () => {
    setTest({ state: 'busy' });
    try {
      const { aiChooseMove } = await import('../ai/runner');
      const s = newGame({ levels: variant === '4d' ? 3 : 1 });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120_000);
      const r = await aiChooseMove(s, value, [], ctrl.signal);
      clearTimeout(timer);
      setTest({ state: 'ok', text: `Connected. It would open with ${moveText(s, r.move)}${r.comment ? `: “${r.comment}”` : ''}` });
    } catch (e) {
      setTest({ state: 'error', text: (e as Error).name === 'AbortError' ? 'No answer within 2 minutes.' : (e as Error).message });
    }
  };

  return (
    <div className="ai-slot">
      <div className="ai-slot-head">
        <b>{title}</b>
        <select
          value={value.provider}
          onChange={(e) => {
            const provider = e.target.value as ProviderId;
            setTest({ state: 'idle' });
            onChange({ ...defaultPlayer(provider), apiKey: keys[provider] });
          }}
          aria-label={`${title} provider`}
        >
          {PROVIDER_ORDER.map((id) => (
            <option key={id} value={id}>{PROVIDERS[id].label}</option>
          ))}
        </select>
      </div>

      {value.provider === 'builtin' ? (
        <div className="seg">
          {info.models.map((m) => (
            <button key={m} className={value.model === m ? 'on' : ''} onClick={() => set({ model: m })}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      ) : (
        <>
          {value.provider !== 'custom' && (
            <label className="ai-field">
              <span>Model</span>
              <input
                className="text-input"
                list={`models-${value.provider}`}
                value={value.model}
                onChange={(e) => set({ model: e.target.value.trim() })}
                placeholder={info.defaultModel}
                spellCheck={false}
              />
              <datalist id={`models-${value.provider}`}>
                {suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {canList && (
                <span className="find-models">
                  <button type="button" onClick={findModels} disabled={finding || (info.needsKey && !value.apiKey)} title={info.needsKey && !value.apiKey ? 'Paste your key first' : 'Ask the provider which models this key can use'}>
                    {finding ? 'Looking…' : 'Find my models'}
                  </button>
                  {found?.provider === value.provider && found.note && <small className="ai-test-ok">{found.note}</small>}
                  {found?.provider === value.provider && found.error && <small className="ai-test-error">{found.error}</small>}
                </span>
              )}
            </label>
          )}
          {info.needsKey && (
            <label className="ai-field">
              <span>
                API key{' '}
                {info.keyUrl && (
                  <a href={info.keyUrl} target="_blank" rel="noreferrer">
                    get one
                  </a>
                )}
              </span>
              <input
                className="text-input"
                type="password"
                autoComplete="off"
                value={value.apiKey ?? ''}
                onChange={(e) => set({ apiKey: e.target.value.trim() })}
                placeholder="Paste your key"
                spellCheck={false}
              />
            </label>
          )}
          {info.needsUrl && (
            <label className="ai-field">
              <span>{value.provider === 'custom' ? 'Bot URL' : 'Server URL'}</span>
              <input
                className="text-input"
                value={value.baseUrl ?? ''}
                onChange={(e) => set({ baseUrl: e.target.value.trim() })}
                placeholder={info.defaultUrl}
                spellCheck={false}
              />
            </label>
          )}
          {value.provider === 'claude' && (
            <div className="ai-field">
              <span>Thinking</span>
              <div className="seg">
                {EFFORTS.map((e) => (
                  <button key={e.id} className={(value.effort ?? 'medium') === e.id ? 'on' : ''} onClick={() => set({ effort: e.id })} title={e.note}>
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="hint-text">{info.help}</p>

      {value.provider !== 'builtin' && (
        <div className="ai-test">
          <button onClick={runTest} disabled={test.state === 'busy'}>
            {test.state === 'busy' ? 'Asking…' : 'Test connection'}
          </button>
          {test.text && <span className={`ai-test-${test.state}`}>{test.text}</span>}
        </div>
      )}
    </div>
  );
}
