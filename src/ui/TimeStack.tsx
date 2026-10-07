import { useLayoutEffect, useRef, useState } from 'react';
import { levelName, sqName } from '../engine/game';
import type { GameState, Move, Piece } from '../engine/types';
import type { Focus } from './Board';
import { colorName, era, isLight, NAME, rel, relWords, squareAt } from './pieces';
import { Pc } from './Pc';
import { useSettings } from './settings';

interface Props {
  state: GameState;
  /** 'time' stacks moments (Time Travel Chess); 'levels' stacks the spatial levels (4D Chess) */
  mode: 'time' | 'levels';
  /** levels mode only: which moment to show, or null for every time at once */
  focus: Focus;
  flipped: boolean;
  selected: Piece | null;
  /** all of the selected piece's legal moves by destination square */
  targets: Map<number, Move[]>;
  checkedId: number | null;
  hoverId: number | null;
  lastMovedId?: number;
  onPiece: (p: Piece) => void;
  onTarget: (moves: Move[]) => void;
  onBackground: () => void;
}

interface Row {
  id: string;
  tone: string;
  title: string;
  sub: string;
  level: number;
  /** null = pieces from every time */
  dt: number | null;
}

interface Thread {
  sq: number;
  points: { x: number; y: number; era: string }[];
}

/**
 * Tilted boards stacked on screen. In Time Travel Chess each board is a moment (future on top,
 * past at the bottom) and threads join a square across times. In 4D Chess each board is a level
 * of the 3D board (upper on top).
 */
export function TimeStack({ state, mode, focus, flipped, selected, targets, checkedId, hoverId, lastMovedId, onPiece, onTarget, onBackground }: Props) {
  const { hints } = useSettings();
  const rows: Row[] = [];
  if (mode === 'time') {
    const times = new Set<number>([0]);
    for (const p of state.pieces) times.add(p.dt);
    for (const ms of targets.values()) for (const m of ms) if (m.capture !== undefined) times.add(m.toDt);
    for (const L of [...times].sort((a, b) => b - a)) {
      const count = state.pieces.filter((p) => p.dt === L).length;
      rows.push({
        id: `t${L}`,
        tone: era(L),
        title: L === 0 ? 'Now' : rel(L),
        sub: `T=${state.ply + L} · ${L === 0 ? 'present' : relWords(L)} · ${count} piece${count === 1 ? '' : 's'}`,
        level: 0,
        dt: L,
      });
    }
  } else {
    for (let z = state.levels - 1; z >= 0; z--) {
      const count = state.pieces.filter((p) => p.sq >> 6 === z && (focus === null || p.dt === focus)).length;
      rows.push({
        id: `z${z}`,
        tone: focus === null ? 'level' : era(focus),
        title: ['↓ Lower', '• Middle', '↑ Upper'][z] ?? `Level ${z + 1}`,
        sub: `${levelName(z, state.levels)} level · ${count} piece${count === 1 ? '' : 's'}${focus === null ? '' : ` · ${relWords(focus)}`}`,
        level: z,
        dt: focus,
      });
    }
  }

  const wrap = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const rowKey = rows.map((r) => r.id).join(',');

  // Time mode: threads join the cells of a square that's used in several times.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    if (mode !== 'time') {
      setThreads((old) => (old.length ? [] : old));
      return;
    }
    const measure = () => {
      const box = el.getBoundingClientRect();
      const bySq = new Map<number, number[]>();
      for (const p of state.pieces) {
        if (!bySq.has(p.sq)) bySq.set(p.sq, []);
        if (!bySq.get(p.sq)!.includes(p.dt)) bySq.get(p.sq)!.push(p.dt);
      }
      const next: Thread[] = [];
      for (const [sq, dts] of bySq) {
        if (dts.length < 2) continue;
        const points = dts
          .sort((a, b) => b - a)
          .map((dt) => {
            const cell = el.querySelector(`[data-cell="t${dt}:${sq}"]`);
            if (!cell) return null;
            const r = cell.getBoundingClientRect();
            return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, era: era(dt) };
          })
          .filter((p): p is { x: number; y: number; era: string } => p !== null);
        if (points.length > 1) next.push({ sq, points });
      }
      setThreads((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state, flipped, rowKey, mode]);

  return (
    <div className="stack-wrap" ref={wrap} onClick={onBackground}>
      {rows.map((row) => (
        <div key={row.id} className={`layer-row ${row.tone}`}>
          <div className={`layer-tag ${row.tone}`}>
            <b>{row.title}</b>
            <span>{row.sub}</span>
          </div>
          <div className="layer-scene">
            <div className={`plane ${row.tone}`}>
              {Array.from({ length: 64 }, (_, k) => {
                const sq = row.level * 64 + squareAt(k >> 3, k & 7, flipped);
                const light = isLight(sq, state.levels);
                const here = state.pieces.filter((p) => p.sq === sq && (row.dt === null || p.dt === row.dt)).sort((a, b) => a.dt - b.dt);
                const opts = targets.get(sq)?.filter((m) => row.dt === null || m.toDt === row.dt);
                return (
                  <div
                    key={k}
                    data-cell={`${row.id}:${sq}`}
                    className={`cell ${light ? 'light' : 'dark'}${opts?.length ? ' target' : ''}${hints ? '' : ' nohint'}`}
                    onClick={(e) => {
                      if (!opts?.length) return;
                      e.stopPropagation();
                      onTarget(opts);
                    }}
                  >
                    {hints && opts?.length && here.length === 0 ? <span className={`sdot ${row.dt === null ? 'now' : era(row.dt)}`} /> : null}
                    {here.map((piece, i) => (
                      <button
                        key={piece.id}
                        className={[
                          'sp',
                          piece.color,
                          era(piece.dt),
                          here.length > 1 ? `multi m${Math.min(i, 2)}` : '',
                          selected?.id === piece.id ? 'sel' : '',
                          checkedId === piece.id ? 'check' : '',
                          hoverId === piece.id ? 'hover' : '',
                          lastMovedId === piece.id ? 'fresh' : '',
                          hints && opts?.some((m) => m.capture === piece.id) ? 'victim' : '',
                        ].join(' ')}
                        title={`${colorName(piece.color)} ${NAME[piece.type].toLowerCase()} on ${sqName(piece.sq, state.levels)}, ${relWords(piece.dt)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const cap = opts?.filter((m) => m.capture === piece.id);
                          if (cap?.length) onTarget(cap);
                          else onPiece(piece);
                        }}
                      >
                        <Pc type={piece.type} color={piece.color} />
                        {mode === 'levels' && row.dt === null && piece.dt !== 0 && <span className="sp-badge">{rel(piece.dt)}</span>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
      <svg className="threads" aria-hidden>
        {threads.map((t) => (
          <g key={t.sq}>
            <polyline points={t.points.map((p) => `${p.x},${p.y}`).join(' ')} className="thread-line" />
            {t.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} className={`thread-end ${p.era}`} />
            ))}
            <text x={t.points[0].x + 8} y={(t.points[0].y + t.points[t.points.length - 1].y) / 2} className="thread-label">
              {sqName(t.sq, state.levels)}
            </text>
          </g>
        ))}
      </svg>
      <p className="stack-note">
        {mode === 'time'
          ? 'Each board is one moment, with the future at the top and the past at the bottom. Dashed threads join the same square in different times.'
          : 'The three levels of the 4D board, upper on top. Pieces in other times glow purple (past) or cyan (future) and carry a badge.'}
      </p>
    </div>
  );
}
