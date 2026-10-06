import { levelName, sqName } from '../engine/game';
import type { GameState, Move, Piece } from '../engine/types';
import type { Focus } from './Board';
import { colorName, era, NAME, relWords, squareAt } from './pieces';
import { Pc } from './Pc';
import { useSettings } from './settings';

interface Props {
  state: GameState;
  level: number;
  focus: Focus;
  flipped: boolean;
  selected: Piece | null;
  /** the selected piece's moves by destination square */
  targets: Map<number, Move[]>;
  checkedId: number | null;
  onLevel: (z: number) => void;
  /** a target square on a mini board was clicked */
  onTarget: (sq: number) => void;
}

const ARROW = ['↓', '•', '↑'];

/**
 * 4D Chess: a small map of every level, top to bottom. The big board shows one level at a time;
 * these show where everything is (and where the selected piece can go) on all of them.
 */
export function LevelBar({ state, level, focus, flipped, selected, targets, checkedId, onLevel, onTarget }: Props) {
  const { hints } = useSettings();
  const levels = Array.from({ length: state.levels }, (_, z) => state.levels - 1 - z); // upper first
  return (
    <div className="levelbar" role="tablist" aria-label="Levels">
      {levels.map((z) => {
        const pieces = state.pieces.filter((p) => p.sq >> 6 === z && (focus === null || p.dt === focus));
        let moves = 0;
        for (const [sq, ms] of targets) if (sq >> 6 === z) moves += new Set(ms.map((m) => m.toDt)).size;
        const hasSel = selected && selected.sq >> 6 === z;
        const hasCheck = state.pieces.some((p) => p.id === checkedId && p.sq >> 6 === z);
        return (
          <button
            key={z}
            role="tab"
            aria-selected={z === level}
            className={`lvl${z === level ? ' on' : ''}${hasCheck ? ' check' : ''}`}
            onClick={() => onLevel(z)}
            title={`Show the ${levelName(z, state.levels)} level`}
          >
            <span className="lvl-head">
              <b>{ARROW[z] ?? z + 1}</b>
              <span>{levelName(z, state.levels)}</span>
              {hasSel && <i className="lvl-you">selected</i>}
              {hints && moves > 0 && <em>{moves}</em>}
            </span>
            <span className="mini">
              {Array.from({ length: 64 }, (_, k) => {
                const sq = z * 64 + squareAt(k >> 3, k & 7, flipped);
                const light = (((sq >> 3) & 7) + (sq & 7)) % 2 === 1;
                const here = pieces.filter((p) => p.sq === sq);
                const top = here.find((p) => p.dt === 0) ?? here[0];
                const target = hints && targets.has(sq);
                // Empty target: a dot. Occupied target (free in another time): a ring, so the piece stays visible.
                const mark = target ? (top ? ' tr' : ' t') : '';
                return (
                  <span
                    key={k}
                    className={`mc ${light ? 'light' : 'dark'}${top && top.dt !== 0 ? ` ${era(top.dt)}` : ''}${mark}${selected && top?.id === selected.id ? ' sel' : ''}`}
                    title={
                      target
                        ? targets.get(sq)!.some((m) => m.capture !== undefined)
                          ? `Capture on ${sqName(sq, state.levels)}`
                          : `Move to ${sqName(sq, state.levels)}${top ? ' (taken now, free in another time)' : ''}`
                        : top
                          ? `${colorName(top.color)} ${NAME[top.type].toLowerCase()} on ${sqName(sq, state.levels)}, ${relWords(top.dt)}`
                          : undefined
                    }
                    onClick={
                      target
                        ? (e) => {
                            e.stopPropagation();
                            onTarget(sq);
                          }
                        : undefined
                    }
                  >
                    {top && <Pc type={top.type} color={top.color} />}
                    {here.length > 1 && <i className="mc-more" />}
                  </span>
                );
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
