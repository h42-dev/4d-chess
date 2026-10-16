import { useEffect, useState } from 'react';
import type { BotLevel } from '../engine/bot';
import { SIMPLE_RULES, STANDARD_RULES } from '../engine/game';
import type { Color, Rules } from '../engine/types';
import { HouseRules, rulesSummary } from './HouseRules';
import { Pc } from './Pc';
import { AiSlot } from './AiSlot';
import { loadSaved, saveSaved, slotPlayer, type AiPlayer, type SavedAi, type SlotId } from '../ai/types';
import { loadHouseRules, saveHouseRules } from './settings';
import { onlineAvailable, savedName, saveName } from '../online/config';
import type { NewGame } from '../online/session';

export type Variant = 'time' | '4d';

export interface Clock {
  minutes: number;
  increment: number;
}

export interface GameConfig {
  variant: Variant;
  mode: 'bot' | 'local' | 'online' | 'ai';
  human: Color;
  level: BotLevel;
  rules: Rules;
  house: boolean;
  clock: Clock | null;
  /** mode 'ai': who plays each side (null = a human at this screen) */
  ai?: { w: AiPlayer | null; b: AiPlayer | null };
}

interface Props {
  onStart: (c: GameConfig) => void;
  /** creates an online game and opens it */
  onOnline: (g: NewGame) => Promise<void>;
  onRules: () => void;
}

const LEVELS: { id: BotLevel; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'Looks one move ahead and makes mistakes' },
  { id: 'medium', label: 'Medium', note: 'Looks two moves ahead' },
  { id: 'hard', label: 'Hard', note: 'Looks up to four moves ahead' },
];

const CLOCKS: { label: string; clock: Clock | null }[] = [
  { label: 'No clock', clock: null },
  { label: '3 + 2', clock: { minutes: 3, increment: 2 } },
  { label: '5 + 3', clock: { minutes: 5, increment: 3 } },
  { label: '10 + 5', clock: { minutes: 10, increment: 5 } },
  { label: '30 + 0', clock: { minutes: 30, increment: 0 } },
];

interface MenuPrefs {
  variant: Variant;
  mode: 'bot' | 'local' | 'online' | 'ai';
  /** AI mode: you vs an AI, or two AIs against each other */
  aiMatch: 'you' | 'watch';
  color: Color | 'random';
  level: BotLevel;
  clock: number;
  house: boolean;
  /** the Simple rules instead of the standard Realistic (OG) rules */
  simple: boolean;
}

const PREFS_KEY = '4d-chess.menu';
const DEFAULT_PREFS: MenuPrefs = { variant: 'time', mode: 'bot', aiMatch: 'you', color: 'w', level: 'medium', clock: 0, house: false, simple: false };

function loadPrefs(): MenuPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function Menu({ onStart, onOnline, onRules }: Props) {
  const [prefs, setPrefs] = useState<MenuPrefs>(loadPrefs);
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<SavedAi>(loadSaved);
  const slot = (id: SlotId) => slotPlayer(ai, id, id === 'w' ? 'builtin' : 'claude');
  const setSlot = (id: SlotId, p: AiPlayer) => {
    setAi((old) => {
      const { apiKey, ...rest } = p;
      const next: SavedAi = { ...old, slots: { ...old.slots, [id]: rest }, keys: apiKey !== undefined ? { ...old.keys, [p.provider]: apiKey } : old.keys };
      saveSaved(next);
      return next;
    });
  };
  const [house, setHouse] = useState<Rules>(loadHouseRules);
  const [editing, setEditing] = useState(false);
  const set = (p: Partial<MenuPrefs>) => setPrefs((old) => ({ ...old, ...p }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* not persisted */
    }
  }, [prefs]);
  useEffect(() => saveHouseRules(house), [house]);

  const chosenRules = prefs.house ? house : prefs.simple ? SIMPLE_RULES : STANDARD_RULES;

  const start = async () => {
    const human = prefs.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : prefs.color;
    if (prefs.mode === 'online') {
      setBusy(true);
      setError('');
      saveName(name.trim());
      try {
        await onOnline({
          variant: prefs.variant,
          rules: chosenRules,
          clock: CLOCKS[prefs.clock].clock,
          color: human,
          name: name.trim() || 'Player 1',
        });
      } catch (e) {
        setError(`Couldn't create the game: ${(e as Error).message}`);
        setBusy(false);
      }
      return;
    }
    let aiSeats: GameConfig['ai'];
    if (prefs.mode === 'ai') {
      aiSeats = prefs.aiMatch === 'watch' ? { w: slot('w'), b: slot('b') } : human === 'w' ? { w: null, b: slot('opp') } : { w: slot('opp'), b: null };
      const missing = Object.values(aiSeats).find((p) => p && p.provider !== 'builtin' && ((['claude', 'openai', 'gemini', 'openrouter'].includes(p.provider) && !p.apiKey) || (['local', 'custom'].includes(p.provider) && !p.baseUrl)));
      if (missing) {
        setError('An AI player is missing its API key or URL.');
        return;
      }
    }
    onStart({
      variant: prefs.variant,
      mode: prefs.mode,
      ai: aiSeats,
      human: prefs.mode === 'local' || (prefs.mode === 'ai' && prefs.aiMatch === 'watch') ? 'w' : human,
      level: prefs.level,
      rules: chosenRules,
      house: prefs.house,
      clock: CLOCKS[prefs.clock].clock,
    });
  };

  return (
    <div className="menu">
      <div className="rules-switch">
        <div className="rules-slider" role="radiogroup" aria-label="Time rules">
          <span className={`rules-thumb${prefs.simple ? '' : ' right'}`} aria-hidden />
          <button role="radio" aria-checked={prefs.simple} className={prefs.simple ? 'on' : ''} onClick={() => set({ simple: true, house: false })}>
            Simple
          </button>
          <button role="radio" aria-checked={!prefs.simple} className={!prefs.simple ? 'on' : ''} onClick={() => set({ simple: false, house: false })}>
            Realistic <small>(OG rules)</small>
          </button>
        </div>
        <p className="rules-note">
          {prefs.simple
            ? 'The past can be seen but not touched: pieces there just block squares.'
            : 'Past boards are real: go back to T=0 and every piece is in its starting position. Capture there to rewrite history.'}
        </p>
      </div>

      <header className="hero">
        <div className="hero-glyphs" aria-hidden>
          <div className="hero-sq">
            <span className="past"><Pc type="q" color="b" /></span>
            <span className="now"><Pc type="p" color="w" /></span>
          </div>
          <div className="hero-sq single">
            <span><Pc type="k" color="w" /></span>
          </div>
          <div className="hero-sq">
            <span className="now"><Pc type="n" color="b" /></span>
            <span className="future"><Pc type="r" color="w" /></span>
          </div>
        </div>
        <h1>4D Chess</h1>
        <p>Chess through time and space. Send pieces into the past and future, and share squares across time.</p>
      </header>

      <section className="variants" aria-label="Game">
        <button className={`variant${prefs.variant === 'time' ? ' on' : ''}`} onClick={() => set({ variant: 'time' })}>
          <span className="variant-art flat" aria-hidden>
            <i className="past" />
            <i className="now" />
            <i className="future" />
          </span>
          <span className="variant-text">
            <b>Time Travel Chess</b>
            <span>The classic 8×8 board, plus time. 3 dimensions.</span>
          </span>
        </button>
        <button className={`variant${prefs.variant === '4d' ? ' on' : ''}`} onClick={() => set({ variant: '4d' })}>
          <span className="variant-art cube" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="variant-text">
            <b>4D Chess</b>
            <span>An 8×8 board with 3 levels of height, plus time. Pieces move up and down as well.</span>
          </span>
        </button>
      </section>

      <div className="card setup">
        <div className="setup-row">
          <span className="field-label">Opponent</span>
          <div className="seg">
            <button className={prefs.mode === 'bot' ? 'on' : ''} onClick={() => set({ mode: 'bot' })}>Bot</button>
            <button className={prefs.mode === 'ai' ? 'on' : ''} onClick={() => set({ mode: 'ai' })} title="Play an AI of your choice, or watch two AIs play">AI</button>
            <button className={prefs.mode === 'local' ? 'on' : ''} onClick={() => set({ mode: 'local' })}>Pass &amp; play</button>
            <button
              className={prefs.mode === 'online' ? 'on' : ''}
              onClick={() => set({ mode: 'online' })}
              disabled={!onlineAvailable}
              title={onlineAvailable ? 'Play a friend on another device with a link' : 'Online play needs Firebase set up (see README)'}
            >
              Online
            </button>
          </div>
        </div>

        {prefs.mode === 'online' && (
          <div className="setup-row">
            <span className="field-label">Your name</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="So your friend knows it's you" maxLength={24} />
          </div>
        )}

        {prefs.mode === 'ai' && (
          <>
            <div className="setup-row">
              <span className="field-label">Match</span>
              <div className="seg">
                <button className={prefs.aiMatch === 'you' ? 'on' : ''} onClick={() => set({ aiMatch: 'you' })}>You vs AI</button>
                <button className={prefs.aiMatch === 'watch' ? 'on' : ''} onClick={() => set({ aiMatch: 'watch' })}>AI vs AI</button>
              </div>
            </div>
            <div className={`ai-slots${prefs.aiMatch === 'watch' ? ' two' : ''}`}>
              {prefs.aiMatch === 'watch' ? (
                <>
                  <AiSlot title="White" value={slot('w')} keys={ai.keys} variant={prefs.variant} onChange={(p) => setSlot('w', p)} />
                  <AiSlot title="Black" value={slot('b')} keys={ai.keys} variant={prefs.variant} onChange={(p) => setSlot('b', p)} />
                </>
              ) : (
                <AiSlot title="Your opponent" value={slot('opp')} keys={ai.keys} variant={prefs.variant} onChange={(p) => setSlot('opp', p)} />
              )}
            </div>
            <div className="ai-privacy">
              <label>
                <input
                  type="checkbox"
                  checked={ai.remember}
                  onChange={(e) => setAi((old) => {
                    const next = { ...old, remember: e.target.checked };
                    saveSaved(next);
                    return next;
                  })}
                />{' '}
                Remember API keys on this device
              </label>
              <span>
                Keys stay in your browser and are sent only to the AI provider you choose, never to this site's server. Each AI move is one request billed to your
                key.
              </span>
            </div>
          </>
        )}

        {prefs.mode !== 'local' && !(prefs.mode === 'ai' && prefs.aiMatch === 'watch') && (
          <>
            <div className="setup-row">
              <span className="field-label">Play as</span>
              <div className="seg">
                {(['w', 'b', 'random'] as const).map((c) => (
                  <button key={c} className={prefs.color === c ? 'on' : ''} onClick={() => set({ color: c })}>
                    {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
                  </button>
                ))}
              </div>
            </div>
            {prefs.mode === 'bot' && <div className="setup-row">
              <span className="field-label">Difficulty</span>
              <div className="seg">
                {LEVELS.map((l) => (
                  <button key={l.id} className={prefs.level === l.id ? 'on' : ''} onClick={() => set({ level: l.id })} title={l.note}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>}
          </>
        )}

        <div className="setup-row">
          <span className="field-label">Clock</span>
          <div className="seg wrap">
            {CLOCKS.map((c, i) => (
              <button key={c.label} className={prefs.clock === i ? 'on' : ''} onClick={() => set({ clock: i })} title={c.clock ? `${c.clock.minutes} minutes each, +${c.clock.increment}s per move` : 'Untimed'}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span className="field-label">Rules</span>
          <div className="seg">
            <button className={!prefs.house ? 'on' : ''} onClick={() => set({ house: false })} title="Use the rules chosen with the slider at the top">
              {prefs.simple ? 'Simple' : 'Realistic (OG rules)'}
            </button>
            <button className={prefs.house ? 'on' : ''} onClick={() => { set({ house: true }); setEditing(true); }}>House rules</button>
          </div>
        </div>
        {prefs.house && (
          <div className="house-box">
            <div className="house-summary">
              <span><b>House rules:</b> {rulesSummary(house)}</span>
              <button className="link" onClick={() => setEditing((e) => !e)}>{editing ? 'Hide' : 'Edit'}</button>
            </div>
            {editing && <HouseRules value={house} onChange={setHouse} />}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        <button className="primary start" onClick={start} disabled={busy}>
          {prefs.mode === 'online'
            ? busy
              ? 'Creating game…'
              : `Create online ${prefs.variant === '4d' ? '4D Chess' : 'Time Travel Chess'} game`
            : `Play ${prefs.variant === '4d' ? '4D Chess' : 'Time Travel Chess'}`}
        </button>
        {prefs.mode === 'online' && <p className="hint-text center">You'll get a link to send your friend. The game starts when they open it.</p>}
      </div>

      <button className="link" onClick={onRules}>How to play →</button>

      <p className="credit">
        Made by Henry Harnischmacher · I design and build systems for businesses.{' '}
        <a href="https://strategyledtechnology.vercel.app/?ref=4d-chess" target="_blank" rel="noopener">Strategy Led Technology →</a>
      </p>
    </div>
  );
}
