import { useEffect, useRef } from 'react';
import { layerRange, sqName } from '../engine/game';
import type { GameState, Piece } from '../engine/types';
import type { Focus } from './Board';
import { colorName, era, NAME, rel, relWords } from './pieces';
import { Pc } from './Pc';

interface Props {
  state: GameState;
  focus: Focus;
  selected: Piece | null;
  /** number of legal moves the selected piece has into each time */
  reach: Map<number, number>;
  hoverId: number | null;
  onHover: (id: number | null) => void;
  onFocus: (f: Focus) => void;
  onToken: (p: Piece) => void;
}

export const RIBBON_PAST = 9;
export const RIBBON_FUTURE = 10;

/**
 * The time axis: one column per moment, from the oldest reachable past to the furthest future.
 * Every piece that's away from the present sits in its column, so you can see at a glance who is where in time.
 */
export function TimeRibbon({ state, focus, selected, reach, hoverId, onHover, onFocus, onToken }: Props) {
  const lo = -Math.min(state.ply, RIBBON_PAST);
  const ref = useRef<HTMLDivElement>(null);
  const span = selected ? layerRange(state, selected) : null;

  useEffect(() => {
    const track = ref.current;
    const target = track?.querySelector<HTMLElement>(focus === null ? '.rcol.now' : '.rcol.focus');
    if (track && target) {
      track.scrollTo({ left: target.offsetLeft - track.clientWidth / 2 + target.clientWidth / 2, behavior: 'smooth' });
    }
  }, [focus]);

  const presentCount = state.pieces.filter((p) => p.dt === 0).length;
  const cols = [];
  for (let L = lo; L <= RIBBON_FUTURE; L++) {
    const here = state.pieces.filter((p) => p.dt === L).sort((a, b) => (a.color === b.color ? a.sq - b.sq : a.color === 'w' ? -1 : 1));
    const count = reach.get(L) ?? 0;
    const cls = ['rcol', era(L)];
    if (focus === L) cls.push('focus');
    if (span && L >= span[0] && L <= span[1]) cls.push('inwin');
    if (count) cls.push('reach');
    if (selected?.dt === L) cls.push('origin');
    cols.push(
      <div
        key={L}
        className={cls.join(' ')}
        onClick={() => onFocus(focus === L ? null : L)}
        title={focus === L ? 'Show all times again' : `Show the board ${relWords(L)} (T=${state.ply + L})`}
      >
        <div className="rhead">
          <b>{rel(L)}</b>
          <small>T={state.ply + L}</small>
        </div>
        <div className="rbody">
          {L === 0 ? (
            <span className="rnow">{presentCount} on the board</span>
          ) : (
            here.map((p) => (
              <button
                key={p.id}
                className={`tok ${p.color}${hoverId === p.id ? ' hover' : ''}${selected?.id === p.id ? ' sel' : ''}`}
                onMouseEnter={() => onHover(p.id)}
                onMouseLeave={() => onHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onToken(p);
                }}
                title={`${colorName(p.color)} ${NAME[p.type].toLowerCase()} on ${sqName(p.sq, state.levels)}, ${relWords(p.dt)}${p.dt > 0 ? ' (lands then)' : ''}`}
              >
                <Pc type={p.type} color={p.color} />
                <span className="tsq">{sqName(p.sq, state.levels)}</span>
              </button>
            ))
          )}
        </div>
        {count > 0 && <span className="rcount">{count}</span>}
      </div>,
    );
  }

  return (
    <div className="ribbon">
      <div className="ribbon-axis">
        <span className="past">◂ Past</span>
        <span className="mid">
          {selected
            ? `Shaded: how far this ${NAME[selected.type].toLowerCase()} can travel. Numbers are moves into each time.`
            : 'Pieces away from the present appear in their time. Click a time to see the board then and move into it.'}
        </span>
        <span className="future">Future ▸</span>
      </div>
      <div className="ribbon-track" ref={ref}>
        {cols}
      </div>
    </div>
  );
}
