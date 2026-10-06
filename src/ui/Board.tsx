import type { ReactNode } from 'react';
import { sqName } from '../engine/game';
import type { GameState, Move, Piece } from '../engine/types';
import { colorName, era, fromChar, NAME, rel, relWords, squareAt } from './pieces';
import { useSettings } from './settings';
import { Pc } from './Pc';

/** `null` = every time at once; a number = the board at that single moment. */
export type Focus = number | null;

export interface Preview {
  sq: number;
  dt: number;
}

interface Props {
  state: GameState;
  /** which spatial level to draw (always 0 in Time Travel Chess) */
  level: number;
  focus: Focus;
  flipped: boolean;
  selected: Piece | null;
  /** the selected piece's legal moves, by destination square, already filtered for the focus */
  targets: Map<number, Move[]>;
  lastMove?: Move;
  lastMovedId?: number;
  lastCapture?: boolean;
  checkedId: number | null;
  hoverId: number | null;
  preview: Preview | null;
  onSquare: (sq: number) => void;
  onPiece: (p: Piece) => void;
  overlay?: ReactNode;
}

export function Board(props: Props) {
  const { state, level, focus, flipped, selected, targets, lastMove, lastMovedId, lastCapture, checkedId, hoverId, preview, onSquare, onPiece, overlay } = props;
  const { coords, hints } = useSettings();
  const base = level * 64;

  // Which pieces belong on which square in this view.
  const bySq = new Map<number, Piece[]>();
  for (const p of state.pieces) {
    if (focus !== null && p.dt !== focus) continue;
    if (!bySq.has(p.sq)) bySq.set(p.sq, []);
    bySq.get(p.sq)!.push(p);
  }
  for (const list of bySq.values()) list.sort((a, b) => a.dt - b.dt);
  const history = focus !== null && focus < 0 ? state.snapshots[state.ply + focus] : undefined;
  const echoes = new Map<number, Piece>();
  if (focus !== null && focus > 0) for (const p of state.pieces) if (p.dt === 0) echoes.set(p.sq, p);
  const victims = new Set<number>();
  // Erasing a past piece targets its past self, not the copy on the board now.
  for (const ms of targets.values()) for (const m of ms) if (m.capture !== undefined && m.erase === undefined) victims.add(m.capture);
  const living = state.rules.history === 'living';

  const cells: ReactNode[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = base + squareAt(row, col, flipped);
      const light = (((sq >> 3) & 7) + (sq & 7)) % 2 === 1;
      const here = [...(bySq.get(sq) ?? [])];
      const opts = targets.get(sq);
      const quiet = opts?.filter((m) => m.capture === undefined) ?? [];
      const erases = opts?.filter((m) => m.erase !== undefined) ?? [];

      // While choosing a time, show the moving piece where it would land.
      let ghost: { piece: Piece; dt: number } | null = null;
      if (selected && preview && preview.sq === sq) {
        ghost = { piece: selected, dt: preview.dt };
      }

      const classes = ['sq', light ? 'light' : 'dark'];
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) classes.push('last');
      if (lastCapture && lastMove?.to === sq) classes.push('took');
      if (opts && hints) classes.push('target');

      type Slot = { piece: Piece; ghost?: boolean };
      let slots: Slot[] = here.map((piece) => ({ piece }));
      if (ghost) {
        // The preview replaces a captured piece, otherwise slots in by time.
        slots = slots.filter((s) => !(s.piece.dt === ghost!.dt && s.piece.id !== selected!.id));
        slots.push({ piece: { ...ghost.piece, dt: ghost.dt, sq }, ghost: true });
        slots.sort((a, b) => a.piece.dt - b.piece.dt);
      }
      const n = slots.length;

      let background: ReactNode = null;
      if (n === 0 && history) {
        const h = fromChar(history[sq]);
        if (h)
          background = living ? (
            <span className={`bg-piece history living${erases.length ? ' erasable' : ''}`} title="This piece stood here at that moment. Capture it to erase it from history.">
              <Pc type={h.type} color={h.color} />
            </span>
          ) : (
            <span className="bg-piece history" title="History: this square was taken back then. It blocks landing but can't be captured.">
              <Pc type={h.type} color={h.color} />
            </span>
          );
      } else if (n === 0 && echoes.has(sq)) {
        const e = echoes.get(sq)!;
        background = <span className="bg-piece echo" title="Standing here in the present right now"><Pc type={e.type} color={e.color} /></span>;
      }

      cells.push(
        <div key={sq} className={classes.join(' ')} onClick={() => onSquare(sq)} data-sq={sq}>
          {coords && col === 0 && <span className="coord rank">{((sq >> 3) & 7) + 1}</span>}
          {coords && row === 7 && <span className="coord file">{'abcdefgh'[sq & 7]}</span>}
          {background}
          {n > 0 && (
            <div className={`slots n${Math.min(n, 4)}${focus !== null ? ' moment' : ''}`}>
              {slots.map(({ piece: p, ghost: isGhost }) => {
                const cls = ['slot', era(p.dt), p.color];
                if (isGhost) cls.push('ghost-preview');
                if (!isGhost && selected?.id === p.id) cls.push('sel');
                if (!isGhost && checkedId === p.id) cls.push('check');
                if (!isGhost && hints && victims.has(p.id)) cls.push('victim');
                if (!isGhost && hoverId === p.id) cls.push('hover');
                if (!isGhost && lastMovedId === p.id) cls.push('fresh');
                const showBadge = focus === null && (p.dt !== 0 || n > 1);
                return (
                  <button
                    key={isGhost ? 'ghost' : p.id}
                    className={cls.join(' ')}
                    title={
                      isGhost
                        ? `Your ${NAME[p.type].toLowerCase()} would land here ${relWords(p.dt)}`
                        : `${colorName(p.color)} ${NAME[p.type].toLowerCase()} on ${sqName(p.sq, state.levels)}, ${relWords(p.dt)}`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isGhost) onPiece(p);
                    }}
                  >
                    <Pc type={p.type} color={p.color} />
                    {showBadge && <span className="tbadge">{rel(p.dt)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {hints && erases.length > 0 && quiet.length === 0 && !ghost && focus === null && (
            // OG rules: a piece's past self can be captured here, in another time.
            <button
              className={`dot erase${n > 0 ? ' corner' : ''}`}
              title="Capture a past piece here, erasing it from history"
              onClick={(e) => {
                e.stopPropagation();
                onSquare(sq);
              }}
            >
              ×
            </button>
          )}
          {hints && quiet.length > 0 && !ghost && (
            n > 0 ? (
              // An occupied square that can also be reached in another time: the dot itself is the target.
              <button
                className={`dot corner ${dotEra(quiet)}`}
                title={`Move here in another time`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSquare(sq);
                }}
              >
                {new Set(quiet.map((m) => m.toDt)).size > 1 && <b>{new Set(quiet.map((m) => m.toDt)).size}</b>}
              </button>
            ) : (
              <span className={`dot ${dotEra(quiet)}`}>
                {new Set(quiet.map((m) => m.toDt)).size > 1 && <b>{new Set(quiet.map((m) => m.toDt)).size}</b>}
              </span>
            )
          )}
        </div>,
      );
    }
  }

  return (
    <div className={`board ${focus === null ? 'all' : `moment ${era(focus)}`}`}>
      {cells}
      {overlay}
    </div>
  );
}

/** Colour of a move-target dot: gold if you can land there now, otherwise the time it leads to. */
function dotEra(ms: Move[]) {
  if (ms.some((m) => m.toDt === 0)) return 'now';
  const past = ms.some((m) => m.toDt < 0);
  const future = ms.some((m) => m.toDt > 0);
  return past && future ? 'mixed' : past ? 'past' : 'future';
}
