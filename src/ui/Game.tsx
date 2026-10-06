import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adjudicate, applyMove, attackers, ctxOf, inCheck, isSafeFor, kingOf, legalMoves, levelName, levelOf, moveText, newGame, pseudoMoves, sideToMove, sqName, startLevel, ttlOf } from '../engine/game';
import type { Color, GameState, Move, Piece, Result, TimeEvent } from '../engine/types';
import { Board, type Focus } from './Board';
import { rulesSummary } from './HouseRules';
import { LevelBar } from './LevelBar';
import type { GameConfig } from './Menu';
import { Pc } from './Pc';
import { colorName, describeMove, era, NAME, rel, relWords } from './pieces';
import { useSettings } from './settings';
import { play as sfx } from './sound';
import { RIBBON_FUTURE, TimeRibbon } from './TimeRibbon';
import { TimePicker } from './TimePicker';
import { TimeStack } from './TimeStack';
import type { OnlineGame } from '../online/session';

interface Entry {
  state: GameState;
  move?: Move;
  notation?: string;
  text?: string;
  by?: Color;
  captured?: Piece;
  events: TimeEvent[];
}

/** What the game screen needs to play online; moves come from and go to the shared game. */
export interface OnlineCtl {
  game: OnlineGame;
  /** your colour, or null when watching */
  me: Color | null;
  link: string;
  send: (m: Move, over: boolean) => void;
  setResult: (r: Result) => void;
  offerDraw: () => void;
  answerDraw: (accept: boolean) => void;
  rematch: () => void;
}

interface Props {
  config: GameConfig;
  online?: OnlineCtl;
  onMenu: () => void;
  onRules: () => void;
}

type View = 'board' | 'stack';

const start = (config: GameConfig) => newGame({ levels: config.variant === '4d' ? 3 : 1, rules: config.rules });

function makeEntry(s: GameState, m: Move): Entry {
  const { state, events } = applyMove(s, m);
  const captured = s.pieces.find((p) => p.id === m.capture);
  return { state, move: m, notation: moveText(s, m), text: describeMove(s, m), by: sideToMove(s), captured, events };
}

/** Finds the legal move matching one received from the other player, or null if it isn't legal. */
function verify(s: GameState, raw: Move): Move | null {
  const color = sideToMove(s);
  const m = pseudoMoves(ctxOf(s), color).find(
    (x) => x.pid === raw.pid && x.to === raw.to && x.toDt === raw.toDt && (x.promo ?? null) === (raw.promo ?? null) && (x.castle ?? null) === (raw.castle ?? null),
  );
  return m && isSafeFor(applyMove(s, m).state, color) ? m : null;
}

/** Rebuilds the game from a list of moves, stopping at the first illegal one. */
function replay(config: GameConfig, moves: Move[]): Entry[] {
  const hist: Entry[] = [{ state: start(config), events: [] }];
  for (const raw of moves) {
    const m = verify(hist[hist.length - 1].state, raw);
    if (!m) break;
    hist.push(makeEntry(hist[hist.length - 1].state, m));
  }
  return hist;
}

export function Game({ config, online, onMenu, onRules }: Props) {
  const settings = useSettings();
  const [hist, setHist] = useState<Entry[]>(() => (online ? replay(config, online.game.moves) : [{ state: start(config), events: [] }]));
  const [selId, setSelId] = useState<number | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [view, setView] = useState<View>('board');
  const [level, setLevel] = useState(() => startLevel(config.variant === '4d' ? 3 : 1));
  const [manualFlip, setManualFlip] = useState((config.mode === 'bot' || config.mode === 'online') && config.human === 'b');
  const [promo, setPromo] = useState<Move[] | null>(null);
  const [picker, setPicker] = useState<{ sq: number; other: Piece | null; floating?: boolean } | null>(null);
  const [previewDt, setPreviewDt] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Online: follow the shared move list. Moves are checked with the rules engine as they arrive.
  const [badMove, setBadMove] = useState(false);
  const remoteMoves = online?.game.moves;
  useEffect(() => {
    if (!remoteMoves) return;
    setHist((h) => {
      const have = h.length - 1;
      if (remoteMoves.length === have) return h;
      if (remoteMoves.length < have) return replay(config, remoteMoves);
      const next = [...h];
      for (const raw of remoteMoves.slice(have)) {
        const m = verify(next[next.length - 1].state, raw);
        if (!m) {
          setBadMove(true);
          break;
        }
        next.push(makeEntry(next[next.length - 1].state, m));
      }
      return next;
    });
  }, [remoteMoves, config]);

  const last = hist[hist.length - 1];
  const cur = last.state;
  const is4d = cur.levels > 1;
  const turn = sideToMove(cur);
  const legal = useMemo(() => legalMoves(cur), [cur]);

  // --- Clock ----------------------------------------------------------------
  const initial = config.clock ? config.clock.minutes * 60_000 : 0;
  const [clock, setClock] = useState<Record<Color, number>>({ w: initial, b: initial });
  const [flag, setFlag] = useState<Color | null>(null);
  const [resigned, setResigned] = useState<Color | null>(null);
  const boardResult = useMemo(() => adjudicate(cur, legal), [cur, legal]);
  const result: Result | null =
    boardResult ??
    online?.game.result ??
    (flag ? { winner: flag === 'w' ? 'b' : 'w', reason: `${colorName(flag)} ran out of time` } : null) ??
    (resigned ? { winner: resigned === 'w' ? 'b' : 'w', reason: `${colorName(resigned)} resigned` } : null);

  const over = !!result;
  useEffect(() => {
    if (!config.clock || online || over || hist.length < 2) return; // the clock starts after White's first move
    let lastTick = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const spent = now - lastTick;
      lastTick = now;
      setClock((c) => {
        const left = Math.max(0, c[turn] - spent);
        if (left === 0) setFlag(turn);
        return { ...c, [turn]: left };
      });
    }, 100);
    return () => clearInterval(id);
  }, [config.clock, online, over, turn, hist.length]);

  // Online clocks: the shared game stores each side's time after the last move; count down from there.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const onlineClocked = !!online?.game.clock;
  useEffect(() => {
    if (!onlineClocked) return;
    const id = setInterval(() => setNowTick(Date.now()), 200);
    return () => clearInterval(id);
  }, [onlineClocked]);
  const shownClock: Record<Color, number> = (() => {
    if (!online?.game.clock) return clock;
    const t = { ...online.game.times };
    const g = online.game;
    if (g.lastMoveAt && g.moves.length >= 1 && !g.result && g.status === 'active' && !boardResult) {
      t[turn] = Math.max(0, t[turn] - (nowTick - g.lastMoveAt.toMillis()));
    }
    return t;
  })();
  const onlineFlag = online?.game.clock && online.game.moves.length >= 1 && shownClock[turn] === 0 && !online.game.result && !boardResult;
  const setOnlineResult = online?.setResult;
  useEffect(() => {
    if (onlineFlag && setOnlineResult) setOnlineResult({ winner: turn === 'w' ? 'b' : 'w', reason: `${colorName(turn)} ran out of time` });
  }, [onlineFlag, setOnlineResult, turn]);

  const botTurn = config.mode === 'bot' && turn !== config.human && !result;
  const waiting = online?.game.status === 'waiting';
  const canAct = !result && !botTurn && (!online || (online.me === turn && !waiting));
  const flipped = config.mode === 'local' && settings.autoFlip ? turn === 'b' : manualFlip;

  const selected = cur.pieces.find((p) => p.id === selId) ?? null;
  const selMoves = useMemo(() => (selected ? legal.filter((m) => m.pid === selected.id) : []), [legal, selected]);
  const bySq = useMemo(() => {
    const map = new Map<number, Move[]>();
    for (const m of selMoves) {
      if (!map.has(m.to)) map.set(m.to, []);
      map.get(m.to)!.push(m);
    }
    return map;
  }, [selMoves]);
  const boardTargets = useMemo(() => {
    if (focus === null) return bySq;
    const map = new Map<number, Move[]>();
    for (const [sq, ms] of bySq) {
      const here = ms.filter((m) => m.toDt === focus);
      if (here.length) map.set(sq, here);
    }
    return map;
  }, [bySq, focus]);
  const reach = useMemo(() => {
    const r = new Map<number, number>();
    for (const m of selMoves) if (!m.promo || m.promo === 'q') r.set(m.toDt, (r.get(m.toDt) ?? 0) + 1);
    return r;
  }, [selMoves]);

  const checkInfo = useMemo(() => {
    const k = kingOf(cur, turn);
    if (!k) return null;
    const by = attackers(ctxOf(cur), k.sq, k.dt, turn === 'w' ? 'b' : 'w');
    return by.length ? { king: k, by } : null;
  }, [cur, turn]);

  const clearPickerOnly = () => {
    setPicker(null);
    setPreviewDt(null);
  };

  const clearSelection = () => {
    setSelId(null);
    clearPickerOnly();
  };

  const send = online?.send;
  const play = useCallback(
    (m: Move) => {
      if (send) {
        // Online: the move goes to the shared game, and comes straight back through the sync above.
        send(m, !!adjudicate(applyMove(cur, m).state));
      } else {
        setHist((h) => [...h, makeEntry(h[h.length - 1].state, m)]);
      }
      if (config.clock && !send) {
        const mover = sideToMove(cur);
        setClock((c) => ({ ...c, [mover]: c[mover] + config.clock!.increment * 1000 }));
      }
      setSelId(null);
      setPromo(null);
      setPicker(null);
      setPreviewDt(null);
      setFocus(null);
      // Follow the action onto the level where the move landed.
      if (cur.levels > 1) setLevel(levelOf(m.to));
    },
    [config.clock, cur, send],
  );

  // --- Sound ----------------------------------------------------------------
  const heard = useRef(1);
  useEffect(() => {
    if (hist.length <= heard.current) {
      heard.current = hist.length;
      return;
    }
    heard.current = hist.length;
    if (!settings.sound || !last.move) return;
    const shift = last.move.toDt - last.move.fromDt;
    if (last.events.some((e) => e.kind === 'lost')) sfx('lost');
    else if (last.captured) sfx('capture');
    else if (shift < 0) sfx('past');
    else if (shift > 0) sfx('future');
    else sfx('move');
    if (adjudicate(cur)) setTimeout(() => sfx('end'), 250);
    else if (inCheck(cur, sideToMove(cur))) setTimeout(() => sfx('check'), 200);
  }, [hist.length, last, cur, settings.sound]);

  // --- Bot -----------------------------------------------------------------
  const worker = useRef<Worker | null>(null);
  const token = useRef(0);
  const clockRef = useRef(clock);
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);
  useEffect(() => {
    const w = new Worker(new URL('../engine/bot.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!botTurn || !worker.current) return;
    const my = ++token.current;
    const w = worker.current;
    setThinking(true);
    const started = Date.now();
    const onMsg = (e: MessageEvent<{ move: Move | null; token: number }>) => {
      if (e.data.token !== my) return;
      // A short pause so instant replies don't feel like a glitch.
      const wait = Math.max(0, 500 - (Date.now() - started));
      setTimeout(() => {
        if (token.current !== my) return;
        setThinking(false);
        if (e.data.move) play(e.data.move);
      }, wait);
    };
    w.addEventListener('message', onMsg);
    // On a clock, the bot never spends more than a slice of its remaining time.
    const left = clockRef.current[sideToMove(cur)];
    const pace = config.clock ? Math.min(settings.botPace, Math.max(0.1, left / 60_000 / 4)) : settings.botPace;
    w.postMessage({ state: cur, level: config.level, pace, token: my });
    return () => {
      w.removeEventListener('message', onMsg);
      token.current++;
      setThinking(false);
    };
  }, [botTurn, cur, config.level, config.clock, play, settings.botPace]);

  // --- Input ---------------------------------------------------------------
  const choose = (moves: Move[]) => {
    clearPickerOnly();
    if (moves.length > 1 && moves.every((m) => m.promo)) setPromo(moves);
    else play(moves[0]);
  };

  const optionsAt = (sq: number) => boardTargets.get(sq) ?? [];

  /** Moves the selected piece to `sq`, asking "when?" if more than one time is possible. */
  const goTo = (sq: number, other: Piece | null = null, ask = false) => {
    const ms = optionsAt(sq);
    if (!ms.length) return false;
    if (new Set(ms.map((m) => m.toDt)).size === 1 && !other && !ask) choose(ms);
    else setPicker({ sq, other });
    return true;
  };

  const select = (p: Piece) => {
    setSelId(p.id);
    clearPickerOnly();
    if (focus !== null && p.dt !== focus) setFocus(null);
    if (is4d) setLevel(levelOf(p.sq));
  };

  const onSquare = (sq: number) => {
    if (picker) return clearPickerOnly();
    if (!canAct) return;
    if (selected && goTo(sq)) return;
    clearSelection();
  };

  const onPiece = (p: Piece) => {
    if (picker) return clearPickerOnly();
    if (!canAct) return;
    if (selected) {
      if (p.id === selected.id) {
        // Clicking the selected piece again offers its pure time-travel moves (always confirmed).
        if (!goTo(p.sq, null, true)) clearSelection();
        return;
      }
      const caps = optionsAt(p.sq).filter((m) => m.capture === p.id);
      if (caps.length) return choose(caps);
      // Your own piece on a square the selected piece can reach in another time: ask, with
      // "select this piece instead" as the first choice.
      if (p.color === turn && optionsAt(p.sq).length) return void goTo(p.sq, p);
      if (p.color !== turn && goTo(p.sq)) return;
    }
    if (p.color === turn) select(p);
    else clearSelection();
  };

  /** From the level map: jump to that level and ask when to land on the square. */
  const onLevelTarget = (sq: number) => {
    if (!canAct || !selected) return;
    setLevel(levelOf(sq));
    const own = cur.pieces.find((p) => p.sq === sq && p.color === turn && p.id !== selected.id && (focus === null ? p.dt === 0 : p.dt === focus)) ?? null;
    goTo(sq, own, true);
  };

  /** From the 3D view: a target cell (possibly with several times) was clicked. */
  const onStackTarget = (ms: Move[]) => {
    if (!canAct || !ms.length) return;
    if (new Set(ms.map((m) => m.toDt)).size === 1) choose(ms);
    else setPicker({ sq: ms[0].to, other: null, floating: true });
  };

  const onToken = (p: Piece) => {
    if (canAct && p.color === turn) {
      select(p);
      setFocus(null);
    } else {
      setFocus(p.dt);
      if (is4d) setLevel(levelOf(p.sq));
    }
  };

  const lo = -Math.min(cur.ply, 9);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') setFocus((f) => Math.max(lo, (f ?? 0) - 1));
      else if (e.key === 'ArrowRight') setFocus((f) => Math.min(RIBBON_FUTURE, (f ?? 0) + 1));
      else if (is4d && (e.key === 'ArrowUp' || e.key === 'PageUp')) setLevel((z) => Math.min(cur.levels - 1, z + 1));
      else if (is4d && (e.key === 'ArrowDown' || e.key === 'PageDown')) setLevel((z) => Math.max(0, z - 1));
      else if (e.key === 'Escape') {
        setPromo(null);
        setPreviewDt(null);
        setPicker((pk) => {
          if (!pk) {
            setSelId((s) => {
              if (s === null) setFocus(null);
              return null;
            });
          }
          return null;
        });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lo, is4d, cur.levels]);

  const undo = () => {
    setHist((h) => {
      if (h.length <= 1) return h;
      let n = h.length - 1;
      // Against the bot, rewind to your own turn.
      if (config.mode === 'bot') while (n > 1 && sideToMove(h[n - 1].state) !== config.human) n--;
      return h.slice(0, n);
    });
    clearSelection();
    setFocus(null);
  };

  const restart = () => {
    token.current++;
    setHist([{ state: start(config), events: [] }]);
    setClock({ w: initial, b: initial });
    setFlag(null);
    setResigned(null);
    clearSelection();
    setFocus(null);
    setLevel(startLevel(cur.levels));
  };

  // --- Render --------------------------------------------------------------
  const players = (c: Color) => {
    if (online) {
      const name = online.game.names[c] || (online.game[c === 'w' ? 'white' : 'black'] ? colorName(c) : 'Waiting for a friend…');
      return online.me === c ? `${name} (you)` : name;
    }
    return config.mode === 'local' ? colorName(c) : c === config.human ? 'You' : `Bot · ${config.level}`;
  };

  const promoOverlay = promo && (
    <div className="board-overlay">
      <div className="promo-card">
        <p>Promote your pawn to</p>
        <div>
          {promo.map((m) => (
            <button key={m.promo} onClick={() => play(m)} title={NAME[m.promo!]}>
              <Pc type={m.promo!} color={turn} />
            </button>
          ))}
        </div>
        <button className="link" onClick={() => setPromo(null)}>Cancel</button>
      </div>
    </div>
  );

  const resultOverlay = result && (
    <div className="board-overlay">
      <div className="result-card">
        <h2>
          {result.winner
            ? config.mode === 'bot' || (online && online.me)
              ? result.winner === config.human
                ? 'You win!'
                : online
                  ? `${players(result.winner)} wins`
                  : 'The bot wins'
              : `${colorName(result.winner)} wins`
            : 'Draw'}
        </h2>
        <p>{result.reason}</p>
        <div className="row">
          {online ? (
            online.me && (
              <button className="primary" onClick={online.rematch}>
                {online.game.rematch ? 'Join the rematch' : 'Rematch'}
              </button>
            )
          ) : (
            <button className="primary" onClick={restart}>Play again</button>
          )}
          <button onClick={onMenu}>Menu</button>
        </div>
        {online?.game.rematch && <p className="muted small">Your friend asked for a rematch with colours swapped.</p>}
      </div>
    </div>
  );

  const waitingOverlay = online && waiting && (
    <div className="board-overlay">
      <div className="result-card invite">
        <h2>Invite a friend</h2>
        <p>Send them this link. The game starts as soon as they open it.</p>
        <div className="invite-link">
          <input readOnly value={online.link} onFocus={(e) => e.target.select()} aria-label="Game link" />
          <button
            className="primary"
            onClick={() => {
              navigator.clipboard?.writeText(online.link).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="muted small">Game code <b>{online.game.code}</b> · waiting for your friend…</p>
      </div>
    </div>
  );

  const pickerMoves = picker ? (picker.floating ? bySq.get(picker.sq) ?? [] : optionsAt(picker.sq)) : [];
  const pickerOverlay = picker && selected && (
    <TimePicker
      state={cur}
      sq={picker.sq}
      flipped={flipped}
      piece={selected}
      floating={picker.floating}
      moves={pickerMoves.filter((m) => !m.promo || m.promo === 'q')}
      other={picker.other}
      onPick={(ms) => choose(pickerMoves.filter((m) => m.toDt === ms[0].toDt))}
      onHover={setPreviewDt}
      onSelectOther={() => picker.other && select(picker.other)}
      onCancel={clearPickerOnly}
    />
  );

  const lastMovedId = last.move?.pid;
  const stackLabel = is4d ? '3D levels' : '3D time stack';
  const levelLabel = levelName(level, cur.levels);

  return (
    <div className={`game${is4d ? ' four-d' : ''}`}>
      <section className="stage">
        <div className="stage-head">
          <div className="seg view-toggle" role="tablist">
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')} role="tab" aria-selected={view === 'board'}>
              Board
            </button>
            <button
              className={view === 'stack' ? 'on' : ''}
              onClick={() => {
                setView('stack');
                if (!is4d) setFocus(null);
                clearPickerOnly();
              }}
              role="tab"
              aria-selected={view === 'stack'}
            >
              {stackLabel}
            </button>
          </div>
          {cur.rules.timeTravel && <Legend />}
        </div>

        {focus !== null && (view === 'board' || is4d) && (
          <div className={`moment-banner ${era(focus)}`}>
            <div>
              <strong>{focus === 0 ? 'The present only' : `The board ${relWords(focus)}`}</strong>
              <span>
                {focus < 0
                  ? `T=${cur.ply + focus}. Grey pieces are history: they stood here then, so you can't land there, but they can't be captured.`
                  : focus > 0
                    ? `T=${cur.ply + focus}. Faint pieces are in the present now. If they're still there when this time arrives, pieces landing on them are lost.`
                    : 'Only the pieces in the present are shown.'}
              </span>
            </div>
            <button onClick={() => setFocus(null)}>Show all times</button>
          </div>
        )}

        {view === 'board' ? (
          <div className={`board-wrap${is4d ? ' with-levels' : ''}`}>
            {is4d && (
              <LevelBar
                state={cur}
                level={level}
                focus={focus}
                flipped={flipped}
                selected={canAct ? selected : null}
                targets={canAct ? boardTargets : new Map()}
                checkedId={checkInfo?.king.id ?? null}
                onLevel={setLevel}
                onTarget={onLevelTarget}
              />
            )}
            <div className="board-col">
              {is4d && (
                <div className="level-title">
                  <span className="level-arrow">{['↓', '•', '↑'][level]}</span>
                  <b>{levelLabel[0].toUpperCase() + levelLabel.slice(1)} level</b>
                  <span className="muted">
                    {level === startLevel(cur.levels) ? 'where the armies start' : level > startLevel(cur.levels) ? 'above the start level' : 'below the start level'}
                  </span>
                  <span className="level-keys">↑ ↓ keys switch levels</span>
                </div>
              )}
              <Board
                state={cur}
                level={level}
                focus={focus}
                flipped={flipped}
                selected={canAct ? selected : null}
                targets={canAct ? boardTargets : new Map()}
                lastMove={last.move}
                lastMovedId={lastMovedId}
                lastCapture={!!last.captured}
                checkedId={checkInfo?.king.id ?? null}
                hoverId={hoverId}
                preview={picker && !picker.floating && previewDt !== null ? { sq: picker.sq, dt: previewDt } : null}
                onSquare={onSquare}
                onPiece={onPiece}
                overlay={waitingOverlay || promoOverlay || resultOverlay || (picker && !picker.floating ? pickerOverlay : null)}
              />
            </div>
          </div>
        ) : (
          <div className="stack-shell">
            <TimeStack
              state={cur}
              mode={is4d ? 'levels' : 'time'}
              focus={is4d ? focus : null}
              flipped={flipped}
              selected={canAct ? selected : null}
              targets={canAct ? (is4d ? boardTargets : bySq) : new Map()}
              checkedId={checkInfo?.king.id ?? null}
              hoverId={hoverId}
              lastMovedId={lastMovedId}
              onPiece={(p) => {
                if (!canAct || p.color !== turn) return;
                if (p.id === selId) clearSelection();
                else select(p);
              }}
              onTarget={onStackTarget}
              onBackground={clearSelection}
            />
            {(waitingOverlay || promoOverlay || resultOverlay || (picker?.floating && pickerOverlay)) && (
              <div className="stack-overlay">{waitingOverlay || promoOverlay || resultOverlay || pickerOverlay}</div>
            )}
          </div>
        )}

        {cur.rules.timeTravel && (
          <TimeRibbon
            state={cur}
            focus={view === 'board' || is4d ? focus : null}
            selected={canAct ? selected : null}
            reach={canAct ? reach : new Map()}
            hoverId={hoverId}
            onHover={setHoverId}
            onFocus={(f) => {
              if (!is4d) setView('board');
              setFocus(f);
              clearPickerOnly();
            }}
            onToken={onToken}
          />
        )}
      </section>

      <aside className="panel">
        <div className="players card">
          {(['b', 'w'] as Color[]).map((c) => (
            <div key={c} className={`player ${turn === c && !result ? 'to-move' : ''}`}>
              <Pc type="k" color={c} />
              <div className="pinfo">
                <span className="pname">
                  {players(c)}
                  {turn === c && !result && config.clock && <span className="pstate inline">{thinking && botTurn ? ' · thinking…' : ' · to move'}</span>}
                </span>
                <Taken hist={hist} color={c} />
              </div>
              {config.clock ? (
                <span className={`clock${turn === c && !result && hist.length > 1 ? ' running' : ''}${shownClock[c] < 20_000 ? ' low' : ''}`}>{fmtClock(shownClock[c])}</span>
              ) : (
                turn === c && !result && <span className="pstate">{thinking && botTurn ? 'thinking…' : 'to move'}</span>
              )}
            </div>
          ))}
        </div>

        {(config.house || is4d) && (
          <div className="mode-tags">
            <span className="tag">{is4d ? '4D Chess · 8×8×3' : 'Time Travel Chess'}</span>
            {config.house && <span className="tag house" title={rulesSummary(config.rules)}>House rules: {rulesSummary(config.rules)}</span>}
          </div>
        )}

        {online && !online.me && <div className="card note">You're watching this game.</div>}
        {badMove && <div className="card alert"><strong>Out of sync</strong><span>A move from the other player didn't follow the rules, so it was ignored. Reload to try again.</span></div>}
        {online && online.game.drawOffer && !result && (
          <div className="card draw-offer">
            {online.game.drawOffer === online.me ? (
              <span>You offered a draw. Waiting for an answer…</span>
            ) : online.me ? (
              <>
                <strong>{players(online.game.drawOffer)} offers a draw</strong>
                <div className="row">
                  <button className="primary" onClick={() => online.answerDraw(true)}>Accept</button>
                  <button onClick={() => online.answerDraw(false)}>Decline</button>
                </div>
              </>
            ) : (
              <span>{players(online.game.drawOffer)} offered a draw.</span>
            )}
          </div>
        )}

        {checkInfo && !result && (
          <div className="card alert">
            <strong>{colorName(turn)} is in check</strong>
            <span>
              From the {checkInfo.by.map((p) => `${NAME[p.type].toLowerCase()} on ${sqName(p.sq, cur.levels)} (${relWords(p.dt)})`).join(', ')}.
              {checkInfo.king.dt !== 0 && ` The king is ${relWords(checkInfo.king.dt)}.`}
            </span>
          </div>
        )}

        <SelectedCard selected={canAct ? selected : null} reach={reach} canAct={canAct} result={!!result} cur={cur} view={view} />

        <MoveLog hist={hist} levels={cur.levels} />

        <div className="actions">
          {online ? (
            <button onClick={online.offerDraw} disabled={!online.me || !!result || waiting || !!online.game.drawOffer}>Draw?</button>
          ) : (
            <button onClick={undo} disabled={hist.length <= 1 || thinking || !!config.clock} title={config.clock ? 'No undo in timed games' : undefined}>
              Undo
            </button>
          )}
          <button onClick={() => setManualFlip((f) => !f)} disabled={config.mode === 'local' && settings.autoFlip}>Flip</button>
          <button
            onClick={() => {
              const who = config.mode === 'bot' || online ? config.human : turn;
              if (!window.confirm(`Resign as ${colorName(who)}?`)) return;
              if (online) online.setResult({ winner: who === 'w' ? 'b' : 'w', reason: `${colorName(who)} resigned` });
              else setResigned(who);
            }}
            disabled={!!result || (!!online && (!online.me || waiting))}
          >
            Resign
          </button>
          <button onClick={onRules}>Rules</button>
          <button onClick={onMenu}>{online ? 'Leave' : 'Menu'}</button>
        </div>
        {online && (
          <p className="share-line">
            Game <b>{online.game.code}</b> ·{' '}
            <button className="link" onClick={() => navigator.clipboard?.writeText(online.link).catch(() => undefined)}>copy link</button>
            {online.me === null ? '' : ' to invite a spectator'}
          </p>
        )}
      </aside>
    </div>
  );
}

function fmtClock(ms: number) {
  if (ms < 20_000) return (ms / 1000).toFixed(1);
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="sw past" />Past</span>
      <span><i className="sw now" />Now</span>
      <span><i className="sw future" />Future</span>
      <span className="legend-note">Shared square → split, earlier on the left</span>
    </div>
  );
}

interface SelectedProps {
  selected: Piece | null;
  reach: Map<number, number>;
  canAct: boolean;
  result: boolean;
  cur: GameState;
  view: View;
}

function SelectedCard({ selected, reach, canAct, result, cur, view }: SelectedProps) {
  if (!selected) {
    return (
      <div className="card sel-card empty">
        {result ? (
          <strong>Game over</strong>
        ) : canAct ? (
          <>
            <strong>Your move</strong>
            <span>
              Click one of your pieces.
              {cur.rules.timeTravel && ' Pieces in other times are tinted and labelled with how far away they are, like −2 or +3.'}
              {cur.levels > 1 && ' The level map on the left shows the upper and lower levels.'}
            </span>
          </>
        ) : (
          <>
            <strong>Bot is thinking…</strong>
            <span>Its move will be highlighted on the board and described below.</span>
          </>
        )}
      </div>
    );
  }
  const t = ttlOf(cur, selected.type);
  const total = [...reach.values()].reduce((a, b) => a + b, 0);
  return (
    <div className={`card sel-card ${era(selected.dt)}`}>
      <div className="sel-top">
        <Pc type={selected.type} color={selected.color} />
        <div>
          <strong>{NAME[selected.type]} on {sqName(selected.sq, cur.levels)}</strong>
          <span className={`when ${era(selected.dt)}`}>
            {selected.dt === 0 ? 'in the present' : `${relWords(selected.dt)} · T=${cur.ply + selected.dt}`}
            {cur.levels > 1 && ` · ${levelName(levelOf(selected.sq), cur.levels)} level`}
          </span>
        </div>
      </div>
      {cur.rules.timeTravel && (
        <div className="ttl-line">
          <span className="past">◂ {t.back} back</span>
          <span className="ttl-label">time travel limit</span>
          <span className="future">{t.fwd} ahead ▸</span>
        </div>
      )}
      <p>
        {total === 0 ? (
          'This piece has no legal moves.'
        ) : view === 'stack' && cur.levels === 1 ? (
          <>{total} move{total === 1 ? '' : 's'}. Dots show where it can land in the times shown. Switch to Board to reach empty times.</>
        ) : (
          <>
            {total} move{total === 1 ? '' : 's'}
            {cur.rules.timeTravel && <> across {reach.size} time{reach.size === 1 ? '' : 's'}</>}. Dots show where it can go:{' '}
            <b className="now">gold</b> lands now
            {cur.rules.timeTravel && (
              <>
                , <b className="past">past colour</b> in the past, <b className="future">future colour</b> in the future. A number on a dot means you'll pick when
              </>
            )}
            .{cur.levels > 1 && ' The level map shows how many moves it has on each level.'}
          </>
        )}
      </p>
    </div>
  );
}

/** Pieces this colour has lost so far: captured, or destroyed when they arrived from the future. */
function Taken({ hist, color }: { hist: Entry[]; color: Color }) {
  const lost: Piece['type'][] = [];
  for (const e of hist) {
    if (e.captured?.color === color) lost.push(e.captured.type);
    for (const ev of e.events) if (ev.kind === 'lost' && ev.color === color) lost.push(ev.type);
  }
  if (!lost.length) return null;
  const order = 'qrbnpk';
  lost.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <span className="taken" title={`Pieces ${colorName(color)} has lost`}>
      {lost.map((t, i) => (
        <Pc key={i} type={t} color={color} />
      ))}
    </span>
  );
}

function MoveLog({ hist, levels }: { hist: Entry[]; levels: number }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [hist.length]);
  const rows = hist.slice(1);
  return (
    <div className="card moves">
      <h3>Moves</h3>
      {rows.length === 0 ? (
        <p className="muted">No moves yet. White starts at T=0.</p>
      ) : (
        <ol ref={ref}>
          {rows.map((e, i) => {
            const shift = e.move ? e.move.toDt - e.move.fromDt : 0;
            return (
              <li key={i} className={i === rows.length - 1 ? 'latest' : ''}>
                <span className="n">{i + 1}</span>
                <span className={`dot ${e.by}`} />
                <div className="mtext">
                  <span className={e.captured ? 'took' : ''}>{e.text}</span>
                  <span className="mmeta">
                    <code>{e.notation}</code>
                    {shift !== 0 && <span className={`shift ${era(shift)}`}>{rel(shift)}</span>}
                  </span>
                  {e.events.map((ev, j) => (
                    <span key={j} className={`ev ${ev.kind}`}>
                      {ev.kind === 'arrived'
                        ? `↧ ${colorName(ev.color)} ${NAME[ev.type].toLowerCase()} arrived from the future on ${sqName(ev.sq, levels)}`
                        : `✕ ${colorName(ev.color)} ${NAME[ev.type].toLowerCase()} arrived on an occupied ${sqName(ev.sq, levels)} and was lost in time`}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
