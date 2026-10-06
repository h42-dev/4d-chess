import { useEffect, useRef, type CSSProperties } from 'react';
import { sqName } from '../engine/game';
import type { GameState, Move, Piece } from '../engine/types';
import { colorName, era, fromChar, NAME, rel } from './pieces';
import { Pc } from './Pc';

interface Props {
  state: GameState;
  sq: number;
  flipped: boolean;
  piece: Piece;
  /** centre it in the view instead of anchoring it to the square (used by the 3D view) */
  floating?: boolean;
  moves: Move[];
  /** an own piece standing on the clicked square, offered as "select this instead" */
  other?: Piece | null;
  onPick: (moves: Move[]) => void;
  onHover: (dt: number | null) => void;
  onSelectOther: () => void;
  onCancel: () => void;
}

/** Pops up over a square when the selected piece can land there in more than one time. */
export function TimePicker({ state, sq, flipped, piece, floating, moves, other, onPick, onHover, onSelectOther, onCancel }: Props) {
  const byDt = new Map<number, Move[]>();
  for (const m of moves) {
    if (!byDt.has(m.toDt)) byDt.set(m.toDt, []);
    byDt.get(m.toDt)!.push(m);
  }
  const options = [...byDt.entries()].sort((a, b) => a[0] - b[0]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (ref.current?.querySelector<HTMLButtonElement>('.topt.now') ?? ref.current?.querySelector<HTMLButtonElement>('.topt'))?.focus();
  }, [sq]);

  const rank = (sq >> 3) & 7, file = sq & 7;
  const row = flipped ? rank : 7 - rank;
  const col = flipped ? 7 - file : file;
  // Anchored next to the square on the board; the floating version is centred by CSS.
  const style: CSSProperties = {};
  if (!floating) {
    if (col <= 3) style.left = `${Math.max(1, col * 12.5 - 2)}%`;
    else style.right = `${Math.max(1, (7 - col) * 12.5 - 2)}%`;
    if (row <= 3) style.top = `${(row + 1) * 12.5 + 0.5}%`;
    else style.bottom = `${(8 - row) * 12.5 + 0.5}%`;
  }

  const same = piece.sq === sq;
  return (
    <div className={`picker ${floating ? 'floating' : row <= 3 ? 'below' : 'above'}`} style={style} ref={ref} onClick={(e) => e.stopPropagation()} onMouseLeave={() => onHover(null)}>
      <div className="picker-head">
        <Pc type={piece.type} color={piece.color} />
        <div>
          <strong>{same ? `Move ${NAME[piece.type].toLowerCase()} through time` : `${NAME[piece.type]} to ${sqName(sq, state.levels)}`}</strong>
          <span>When should it land?</span>
        </div>
      </div>
      {other && (
        <button className="pick-other" onClick={onSelectOther}>
          <Pc type={other.type} color={other.color} />
          <span>
            <b>Select your {NAME[other.type].toLowerCase()} instead</b>
            <small>or pick a time below to move the {NAME[piece.type].toLowerCase()} onto this square</small>
          </span>
        </button>
      )}
      <div className="topts">
        {options.map(([dt, ms]) => {
          const m0 = ms[0];
          const hist = m0.erase !== undefined ? fromChar(state.snapshots[m0.erase]?.[m0.to] ?? '.') : null;
          const victim = hist ?? (m0.capture !== undefined ? state.pieces.find((p) => p.id === m0.capture) : undefined);
          return (
            <button
              key={dt}
              className={`topt ${era(dt)}${victim ? ' capture' : ''}`}
              onMouseEnter={() => onHover(dt)}
              onFocus={() => onHover(dt)}
              onClick={() => onPick(ms)}
              title={victim ? `Take the ${colorName(victim.color).toLowerCase()} ${NAME[victim.type].toLowerCase()}` : undefined}
            >
              <b>{rel(dt)}</b>
              <small>T={state.ply + dt}</small>
              {victim && (
                <em>
                  {hist ? 'erases' : 'takes'} <Pc type={victim.type} color={victim.color} />
                </em>
              )}
            </button>
          );
        })}
      </div>
      <div className="picker-foot">
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
