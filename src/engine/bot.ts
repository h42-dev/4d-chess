import { applyMove, ctxOf, fileOf, inCheck, kingOf, legalMoves, levelOf, pseudoMoves, rankOf, sideToMove, startLevel } from './game';
import type { Color, GameState, Move, Piece, PieceType } from './types';

export type BotLevel = 'easy' | 'medium' | 'hard';

const LEVELS: Record<BotLevel, { depth: number; timeMs: number; beam: number; noise: number }> = {
  easy: { depth: 1, timeMs: 400, beam: Infinity, noise: 120 },
  medium: { depth: 2, timeMs: 2500, beam: 40, noise: 30 },
  hard: { depth: 4, timeMs: 6000, beam: 30, noise: 0 },
};

const VAL: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 1_000_000;
/** How bad it is to have your king waiting in the future on a square that's currently taken. */
const KING_ARRIVAL_RISK = 2500;

class Timeout extends Error {}

/**
 * What a move captures. Under OG rules a capture on a past board can hit the past self of a piece
 * that's no longer on the board now, so read its type from that board's snapshot.
 */
function victimType(s: GameState, m: Move): PieceType | null {
  if (m.capture === undefined) return null;
  if (m.erase !== undefined) return (s.snapshots[m.erase]?.[m.to]?.toLowerCase() as PieceType) ?? null;
  return s.pieces.find((p) => p.id === m.capture)?.type ?? null;
}

function centre(sq: number, levels: number) {
  const f = fileOf(sq), r = rankOf(sq);
  const flat = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)); // 0 at the edge … 3 in the middle
  // In 4D the middle level is the centre too: it reaches both other levels.
  return levels > 1 && levelOf(sq) !== startLevel(levels) ? flat - 0.75 : flat;
}

function pieceScore(p: Piece, presentSquares: Set<number>, levels: number): number {
  if (p.dt === 0) {
    if (p.type === 'k') return 0;
    let v = VAL[p.type];
    if (p.type === 'p') v += ((p.color === 'w' ? rankOf(p.sq) : 7 - rankOf(p.sq)) - 1) * 6;
    else if (p.type !== 'r') v += centre(p.sq, levels) * (p.type === 'q' ? 3 : 8);
    return v;
  }
  if (p.dt < 0) return p.type === 'k' ? -15 : VAL[p.type] * 0.94;
  // Future: the piece is only as good as its chance of landing safely.
  const blocked = presentSquares.has(p.sq);
  const risk = blocked ? (p.dt <= 2 ? 0.85 : 0.45) : 0;
  if (p.type === 'k') return -KING_ARRIVAL_RISK * risk - 10;
  return VAL[p.type] * 0.92 * (1 - risk);
}

export function evaluate(s: GameState, me: Color): number {
  const present = new Set<number>();
  for (const p of s.pieces) if (p.dt === 0) present.add(p.sq);
  let score = 0;
  for (const p of s.pieces) {
    const v = pieceScore(p, present, s.levels);
    score += p.color === me ? v : -v;
  }
  return score;
}

function terminal(s: GameState, me: Color, depthLeft: number): number {
  if (!s.result || s.result.winner === null) return 0;
  return (s.result.winner === me ? 1 : -1) * (MATE + depthLeft);
}

class Search {
  nodes = 0;
  private deadline: number;
  constructor(deadline: number) {
    this.deadline = deadline;
  }

  private tick() {
    if ((++this.nodes & 255) === 0 && Date.now() > this.deadline) throw new Timeout();
  }

  private order(s: GameState, moves: Move[]): Move[] {
    const byId = new Map(s.pieces.map((p) => [p.id, p]));
    const score = (m: Move) => {
      const mover = byId.get(m.pid)!;
      const victim = victimType(s, m);
      if (victim) return 10_000 + VAL[victim] * 10 - VAL[mover.type] / 10 + (victim === 'k' ? 1e6 : 0);
      if (m.promo) return 9_000;
      return m.toDt === m.fromDt ? 0 : -50 - Math.abs(m.toDt);
    };
    return moves.map((m) => [score(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  negamax(s: GameState, depth: number, alpha: number, beta: number): number {
    const me = sideToMove(s);
    if (s.result) return terminal(s, me, depth);
    if (depth <= 0) return this.quiesce(s, alpha, beta, 4);
    this.tick();
    const moves = this.order(s, pseudoMoves(ctxOf(s), me, 'search'));
    let best = -Infinity;
    for (const m of moves) {
      if (m.erase === undefined && victimType(s, m) === 'k') return MATE + depth;
      const next = applyMove(s, m).state;
      if (!kingOf(next, me)) continue;
      const score = -this.negamax(next, depth - 1, -beta, -alpha);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    if (best === -Infinity) return inCheck(s, me) ? -MATE : 0;
    return best;
  }

  quiesce(s: GameState, alpha: number, beta: number, depth: number): number {
    const me = sideToMove(s);
    if (s.result) return terminal(s, me, 0);
    this.tick();
    const caps = this.order(s, pseudoMoves(ctxOf(s), me, 'captures'));
    if (caps.length && victimType(s, caps[0]) === 'k') return MATE;
    const stand = evaluate(s, me);
    if (stand >= beta || depth === 0) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of caps) {
      const next = applyMove(s, m).state;
      if (!kingOf(next, me)) continue;
      const score = -this.quiesce(next, -beta, -alpha, depth - 1);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
}

/** `pace` scales how long the bot may think (0.5 = quick, 2 = take its time). */
export function chooseMove(s: GameState, level: BotLevel, pace = 1): Move | null {
  const cfg = { ...LEVELS[level], timeMs: LEVELS[level].timeMs * pace };
  const root = legalMoves(s);
  if (root.length <= 1) return root[0] ?? null;

  const search = new Search(Date.now() + cfg.timeMs);
  const children = root.map((m) => ({ m, next: applyMove(s, m).state, score: 0 }));

  // Depth 1 for everything (with a capture search on top), so we always have an answer.
  for (const c of children) {
    c.score = -search.quiesce(c.next, -Infinity, Infinity, 4) + (Math.random() - 0.5) * cfg.noise;
  }
  children.sort((a, b) => b.score - a.score);

  // Then look deeper at the most promising moves for as long as the clock allows.
  for (let depth = 2; depth <= cfg.depth; depth++) {
    const beam = children.slice(0, cfg.beam);
    const scores: number[] = [];
    try {
      let alpha = -Infinity;
      for (const c of beam) {
        const score = -search.negamax(c.next, depth - 1, -Infinity, -alpha) + (Math.random() - 0.5) * cfg.noise;
        scores.push(score);
        if (score > alpha) alpha = score;
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break; // keep the last fully searched depth
    }
    beam.forEach((c, i) => (c.score = scores[i]));
    // Moves outside the beam keep their shallower score but can't outrank a searched move.
    for (const c of children.slice(cfg.beam)) c.score = -Infinity;
    children.sort((a, b) => b.score - a.score);
  }
  return children[0].m;
}
