import { applyMove, canHit, ctxOf, isSafeFor, layerRange, sqName } from '../engine/game';
import type { GameState, Piece } from '../engine/types';
import { NAME, rel, relWords } from './pieces';

const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;

/** Why `piece` can't capture `target` right now, in plain words. */
export function whyNoCapture(s: GameState, piece: Piece, target: Piece): string {
  const me = NAME[piece.type].toLowerCase();
  const it = `the ${NAME[target.type].toLowerCase()} on ${sqName(target.sq, s.levels)}`;
  const [lo, hi] = layerRange(s, piece);
  if (target.dt < lo || target.dt > hi) {
    const where = piece.dt === 0 ? 'in the present' : relWords(piece.dt);
    const range = lo === hi ? `only ${rel(lo)}` : `${rel(lo)} to ${rel(hi)}`;
    let reason = `Your ${me} is ${where} and can only reach ${range} this move, but ${it} is ${relWords(target.dt)}.`;
    if (target.dt < lo && s.rules.timeTravel) reason += ` A ${me} can travel back at most ${s.rules.ttl[piece.type].back} turns per move.`;
    if (piece.dt > 0 && target.dt < lo) {
      const wait = lo - target.dt;
      reason += ` Time catches up one turn per turn, so it can reach the present in ${turns(wait)}.`;
    }
    return reason;
  }
  if (!canHit(ctxOf(s), piece, target.sq, target.dt)) {
    return `Your ${me} can't reach ${sqName(target.sq, s.levels)} from ${sqName(piece.sq, s.levels)} in one move${['q', 'r', 'b'].includes(piece.type) ? ', or something is in the way' : ''}.`;
  }
  const after = applyMove(s, { pid: piece.id, from: piece.sq, fromDt: piece.dt, to: target.sq, toDt: target.dt, capture: target.id }).state;
  if (!isSafeFor(after, piece.color)) return `Taking ${it} would leave your king in check (or lose it in time).`;
  return `Your ${me} can't take ${it} right now.`;
}
