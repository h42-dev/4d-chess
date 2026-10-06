import type { Color, GameState, Move, Piece, PieceType, Result, Rules, TimeEvent } from './types';

/** Standard Time Travel Limits: how far a piece may shift back / forward in time in one move. */
export const STANDARD_TTL: Rules['ttl'] = {
  k: { back: 5, fwd: 10 },
  q: { back: 9, fwd: 9 },
  r: { back: 5, fwd: 5 },
  b: { back: 3, fwd: 3 },
  n: { back: 3, fwd: 3 },
  p: { back: 1, fwd: 1 },
};

export const STANDARD_RULES: Rules = {
  ttl: STANDARD_TTL,
  /**
   * A piece's TTL limits both how far it can jump in one move and how far from the present it may
   * ever be. Otherwise a king could keep hopping further into the future and never be reachable.
   */
  horizon: true,
  /**
   * A piece already in the future can't run even further ahead, only move in space or back toward
   * now. Otherwise a king could stay out of reach forever by hopping forward every turn.
   */
  futureRunning: false,
  allowPass: false,
  quietDraw: 150,
  timeTravel: true,
};

export interface GameOptions {
  /** 1 = Time Travel Chess (8×8), 3 = 4D Chess (8×8×3) */
  levels: number;
  rules: Rules;
}

export const opp = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const sideToMove = (s: GameState): Color => (s.ply % 2 === 0 ? 'w' : 'b');

// ---------------------------------------------------------------------------
// Coordinates: sq = level * 64 + rank * 8 + file

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => (sq >> 3) & 7;
export const levelOf = (sq: number) => sq >> 6;
export const sqAt = (f: number, r: number, z: number) => z * 64 + r * 8 + f;
/** The level both armies start on (the middle one). */
export const startLevel = (levels: number) => Math.floor(levels / 2);

const LEVEL_MARK = ['↓', '', '↑'];
/** e4 on a flat board; in 4D, e4↑ is the upper level, e4↓ the lower one, plain e4 the middle. */
export function sqName(sq: number, levels = 1): string {
  const base = 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
  if (levels === 1) return base;
  if (levels === 3) return base + LEVEL_MARK[levelOf(sq)];
  return `${base}·L${levelOf(sq) + 1}`;
}

export const LEVEL_NAMES = ['lower', 'middle', 'upper'];
export const levelName = (z: number, levels: number) => (levels === 3 ? LEVEL_NAMES[z] : `level ${z + 1}`);

export const ttlOf = (s: GameState, t: PieceType) => (s.rules.timeTravel ? s.rules.ttl[t] : { back: 0, fwd: 0 });

const BACK_RANK: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function snapshotOf(pieces: Piece[], levels: number): string {
  const b = new Array<string>(64 * levels).fill('.');
  for (const p of pieces) if (p.dt === 0) b[p.sq] = p.color === 'w' ? p.type.toUpperCase() : p.type;
  return b.join('');
}

export function newGame(opts: Partial<GameOptions> = {}): GameState {
  const levels = opts.levels ?? 1;
  const rules = opts.rules ?? STANDARD_RULES;
  const z = startLevel(levels);
  const pieces: Piece[] = [];
  let id = 1;
  for (let f = 0; f < 8; f++) {
    pieces.push({ id: id++, type: BACK_RANK[f], color: 'w', sq: sqAt(f, 0, z), dt: 0, moved: false });
    pieces.push({ id: id++, type: 'p', color: 'w', sq: sqAt(f, 1, z), dt: 0, moved: false });
    pieces.push({ id: id++, type: 'p', color: 'b', sq: sqAt(f, 6, z), dt: 0, moved: false });
    pieces.push({ id: id++, type: BACK_RANK[f], color: 'b', sq: sqAt(f, 7, z), dt: 0, moved: false });
  }
  return { levels, rules, ply: 0, pieces, snapshots: [snapshotOf(pieces, levels)], ep: -1, quiet: 0, result: null };
}

// ---------------------------------------------------------------------------
// Occupancy

export const GHOST = 'ghost' as const;
export type Occupant = Piece | typeof GHOST | null;

const key = (sq: number, dt: number) => (dt + 16384) * 512 + sq;

export interface Ctx {
  s: GameState;
  occ: Map<number, Piece>;
}

export function ctxOf(s: GameState): Ctx {
  const occ = new Map<number, Piece>();
  for (const p of s.pieces) occ.set(key(p.sq, p.dt), p);
  return { s, occ };
}

/**
 * What is on `sq` in time layer `L`?
 * In the past, a square is also blocked by whatever stood there in the board's history (a "ghost").
 * Ghosts can't be captured. They just mean the square wasn't free back then.
 */
export function at(c: Ctx, sq: number, L: number): Occupant {
  const p = c.occ.get(key(sq, L));
  if (p) return p;
  if (L < 0) {
    const snap = c.s.snapshots[c.s.ply + L];
    if (snap !== undefined && snap.charCodeAt(sq) !== 46) return GHOST;
  }
  return null;
}

export function layerRange(s: GameState, p: Piece): [number, number] {
  const t = ttlOf(s, p.type);
  let lo = Math.max(p.dt - t.back, -s.ply);
  let hi = p.dt + t.fwd;
  if (s.rules.horizon) {
    lo = Math.max(lo, -t.back);
    hi = Math.min(hi, t.fwd);
  }
  if (p.dt > 0 && !s.rules.futureRunning) hi = Math.min(hi, p.dt);
  return [lo, hi];
}

// ---------------------------------------------------------------------------
// Directions. On a single level, anything that changes level simply falls off the board,
// so the same rules give ordinary chess moves in 2D.

type Vec = [number, number, number]; // [file, rank, level]

const ALL: Vec[] = [];
for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) if (a || b || c) ALL.push([a, b, c]);
const nonZero = (v: Vec) => v.filter((x) => x !== 0).length;
/** along one axis */
const ROOK_DIRS = ALL.filter((v) => nonZero(v) === 1);
/** diagonally within any plane (two axes at once) */
const BISHOP_DIRS = ALL.filter((v) => nonZero(v) === 2);
/** all 26 directions, including the 3D diagonals */
const QUEEN_DIRS = ALL;
const KING_STEPS = ALL;
/** 2 along one axis and 1 along another */
const KNIGHT_JUMPS: Vec[] = [];
for (const a of [-2, -1, 0, 1, 2])
  for (const b of [-2, -1, 0, 1, 2])
    for (const c of [-2, -1, 0, 1, 2]) {
      const s = [a, b, c].map(Math.abs).sort().join('');
      if (s === '012') KNIGHT_JUMPS.push([a, b, c]);
    }

function step(sq: number, v: Vec, levels: number, times = 1): number {
  const f = fileOf(sq) + v[0] * times;
  const r = rankOf(sq) + v[1] * times;
  const z = levelOf(sq) + v[2] * times;
  if (f < 0 || f > 7 || r < 0 || r > 7 || z < 0 || z >= levels) return -1;
  return sqAt(f, r, z);
}

// ---------------------------------------------------------------------------
// Move generation

/**
 * 'all'    – every pseudo-legal move
 * 'search' – what the bot looks at below the root: captures in any time, quiet moves within the
 *            piece's own time, and quiet moves that bring a time traveller back to the present
 * 'captures' – captures only
 */
export type GenMode = 'all' | 'search' | 'captures';

function wantQuiet(mode: GenMode, p: Piece, L: number) {
  return mode === 'all' || (mode === 'search' && (L === p.dt || L === 0));
}

/** Squares a piece can reach in space. Paths are checked in the piece's own time. */
function spatialTargets(c: Ctx, p: Piece): number[] {
  const out: number[] = [];
  const levels = c.s.levels;
  const jump = (vs: Vec[]) => {
    for (const v of vs) {
      const t = step(p.sq, v, levels);
      if (t >= 0) out.push(t);
    }
  };
  const slide = (vs: Vec[]) => {
    for (const v of vs) {
      for (let i = 1; ; i++) {
        const t = step(p.sq, v, levels, i);
        if (t < 0) break;
        out.push(t);
        if (at(c, t, p.dt) !== null) break; // the path is blocked from here on
      }
    }
  };
  switch (p.type) {
    case 'n': jump(KNIGHT_JUMPS); break;
    case 'k': jump(KING_STEPS); break;
    case 'r': slide(ROOK_DIRS); break;
    case 'b': slide(BISHOP_DIRS); break;
    case 'q': slide(QUEEN_DIRS); break;
  }
  return out;
}

function tryTarget(c: Ctx, p: Piece, to: number, L: number, out: Move[], mode: GenMode) {
  const o = at(c, to, L);
  if (o === null) {
    if (wantQuiet(mode, p, L)) out.push({ pid: p.id, from: p.sq, fromDt: p.dt, to, toDt: L });
  } else if (o !== GHOST && o.color !== p.color) {
    out.push({ pid: p.id, from: p.sq, fromDt: p.dt, to, toDt: L, capture: o.id });
  }
}

const PROMOS: PieceType[] = ['q', 'r', 'b', 'n'];

/**
 * Pawns step forward one rank, optionally also moving up or down a level, and capture
 * one rank forward and one file sideways (on the same level or one up/down).
 * The two-square first move is straight ahead on the same level.
 */
function pawnMoves(c: Ctx, p: Piece, lo: number, hi: number, out: Move[], mode: GenMode) {
  const levels = c.s.levels;
  const dir = p.color === 'w' ? 1 : -1;
  if (rankOf(p.sq) + dir < 0 || rankOf(p.sq) + dir > 7) return;
  const last = p.color === 'w' ? 7 : 0;
  const push = (m: Move) => {
    if (rankOf(m.to) === last) for (const promo of PROMOS) out.push({ ...m, promo });
    else out.push(m);
  };
  const one = step(p.sq, [0, dir, 0], levels);
  const steps = [one, step(p.sq, [0, dir, 1], levels), step(p.sq, [0, dir, -1], levels)].filter((t) => t >= 0);
  const startRank = p.color === 'w' ? 1 : 6;
  const two = rankOf(p.sq) === startRank && !p.moved && at(c, one, p.dt) === null ? step(p.sq, [0, dir, 0], levels, 2) : -1;
  const hits: number[] = [];
  for (const df of [-1, 1]) for (const dz of [-1, 0, 1]) {
    const t = step(p.sq, [df, dir, dz], levels);
    if (t >= 0) hits.push(t);
  }
  for (let L = lo; L <= hi; L++) {
    if (wantQuiet(mode, p, L)) {
      for (const t of steps) if (at(c, t, L) === null) push({ pid: p.id, from: p.sq, fromDt: p.dt, to: t, toDt: L });
      if (two >= 0 && at(c, two, L) === null) out.push({ pid: p.id, from: p.sq, fromDt: p.dt, to: two, toDt: L });
    }
    for (const t of hits) {
      const o = at(c, t, L);
      if (o && o !== GHOST && o.color !== p.color) {
        push({ pid: p.id, from: p.sq, fromDt: p.dt, to: t, toDt: L, capture: o.id });
      } else if (o === null && L === 0 && p.dt === 0 && c.s.ep === t && levelOf(t) === levelOf(p.sq)) {
        const victim = c.occ.get(key(t - 8 * dir, 0));
        if (victim) out.push({ pid: p.id, from: p.sq, fromDt: 0, to: t, toDt: 0, capture: victim.id, ep: true });
      }
    }
  }
}

function castleMoves(c: Ctx, k: Piece, out: Move[]) {
  const home = sqAt(4, k.color === 'w' ? 0 : 7, startLevel(c.s.levels));
  if (k.moved || k.sq !== home) return;
  const d = k.dt;
  const enemy = opp(k.color);
  if (attacked(c, home, d, enemy)) return;
  const options: [number, number[], number[], number, 'K' | 'Q'][] = [
    [home + 3, [home + 1, home + 2], [home + 1, home + 2], home + 2, 'K'],
    [home - 4, [home - 1, home - 2, home - 3], [home - 1, home - 2], home - 2, 'Q'],
  ];
  for (const [rookSq, between, path, kTo, side] of options) {
    const r = c.occ.get(key(rookSq, d));
    if (!r || r.type !== 'r' || r.color !== k.color || r.moved) continue;
    if (between.some((s) => at(c, s, d) !== null)) continue;
    if (path.some((s) => attacked(c, s, d, enemy))) continue;
    out.push({ pid: k.id, from: home, fromDt: d, to: kTo, toDt: d, castle: side, rookId: r.id });
  }
}

export function pieceMoves(c: Ctx, p: Piece, out: Move[], mode: GenMode = 'all') {
  const [lo, hi] = layerRange(c.s, p);
  // Straight up / down the time axis, staying on the same square. Jumping exactly one turn ahead
  // from the present or future leaves the board unchanged once time moves on (a pass), which is
  // only allowed under house rules.
  for (let L = lo; L <= hi; L++) {
    if (L === p.dt || (!c.s.rules.allowPass && p.dt >= 0 && L === p.dt + 1)) continue;
    tryTarget(c, p, p.sq, L, out, mode);
  }
  if (p.type === 'p') {
    pawnMoves(c, p, lo, hi, out, mode);
    return;
  }
  for (const t of spatialTargets(c, p)) for (let L = lo; L <= hi; L++) tryTarget(c, p, t, L, out, mode);
  if (p.type === 'k' && mode === 'all') castleMoves(c, p, out);
}

export function pseudoMoves(c: Ctx, color: Color, mode: GenMode = 'all'): Move[] {
  const out: Move[] = [];
  for (const p of c.s.pieces) if (p.color === color) pieceMoves(c, p, out, mode);
  return out;
}

// ---------------------------------------------------------------------------
// Attacks & check

function pathClear(c: Ctx, from: number, to: number, L: number) {
  const v: Vec = [
    Math.sign(fileOf(to) - fileOf(from)),
    Math.sign(rankOf(to) - rankOf(from)),
    Math.sign(levelOf(to) - levelOf(from)),
  ];
  for (let i = 1; ; i++) {
    const s = step(from, v, c.s.levels, i);
    if (s === to || s < 0) return true;
    if (at(c, s, L) !== null) return false;
  }
}

/** Can piece `p` capture something standing on (sq, L)? */
export function canHit(c: Ctx, p: Piece, sq: number, L: number): boolean {
  const t = ttlOf(c.s, p.type);
  const dL = L - p.dt;
  if (dL < -t.back || dL > t.fwd) return false;
  if (c.s.rules.horizon && (L < -t.back || L > t.fwd)) return false;
  if (p.dt > 0 && L > p.dt && !c.s.rules.futureRunning) return false;
  if (p.sq === sq) return dL !== 0;
  const df = fileOf(sq) - fileOf(p.sq);
  const dr = rankOf(sq) - rankOf(p.sq);
  const dz = levelOf(sq) - levelOf(p.sq);
  const a = [Math.abs(df), Math.abs(dr), Math.abs(dz)];
  const moving = a.filter((x) => x !== 0);
  const straight = moving.every((x) => x === moving[0]); // all moving axes by the same amount
  switch (p.type) {
    case 'p': return a[0] === 1 && dr === (p.color === 'w' ? 1 : -1) && a[2] <= 1;
    case 'n': return [...a].sort().join('') === '012';
    case 'k': return Math.max(...a) === 1;
    case 'r': return moving.length === 1 && pathClear(c, p.sq, sq, p.dt);
    case 'b': return moving.length === 2 && straight && pathClear(c, p.sq, sq, p.dt);
    case 'q': return straight && pathClear(c, p.sq, sq, p.dt);
  }
}

export function attackers(c: Ctx, sq: number, L: number, by: Color): Piece[] {
  return c.s.pieces.filter((p) => p.color === by && canHit(c, p, sq, L));
}

export function attacked(c: Ctx, sq: number, L: number, by: Color): boolean {
  for (const p of c.s.pieces) if (p.color === by && canHit(c, p, sq, L)) return true;
  return false;
}

export const kingOf = (s: GameState, color: Color) => s.pieces.find((p) => p.type === 'k' && p.color === color);

export function inCheck(s: GameState, color: Color, c: Ctx = ctxOf(s)): boolean {
  const k = kingOf(s, color);
  return !k || attacked(c, k.sq, k.dt, opp(color));
}

// ---------------------------------------------------------------------------
// Making moves

export function applyMove(s: GameState, m: Move): { state: GameState; events: TimeEvent[] } {
  const captured = m.capture !== undefined ? s.pieces.find((p) => p.id === m.capture) : undefined;
  const pieces = s.pieces.filter((p) => p.id !== m.capture).map((p) => ({ ...p }));
  const mover = pieces.find((p) => p.id === m.pid)!;
  const wasPawn = mover.type === 'p';
  mover.sq = m.to;
  mover.dt = m.toDt;
  mover.moved = true;
  if (m.promo) mover.type = m.promo;
  if (m.castle) {
    const rook = pieces.find((p) => p.id === m.rookId)!;
    rook.sq = m.castle === 'K' ? m.to - 1 : m.to + 1;
    rook.moved = true;
  }

  let result: Result | null = null;
  if (captured?.type === 'k') result = { winner: mover.color, reason: 'King captured' };

  // Time moves on: future pieces get one turn closer, and arrive when they reach the present.
  const events: TimeEvent[] = [];
  const arriving: Piece[] = [];
  for (const p of pieces) {
    if (p.dt > 0 && --p.dt === 0) arriving.push(p);
  }
  let survivors = pieces;
  if (arriving.length) {
    const taken = new Set(pieces.filter((p) => p.dt === 0 && !arriving.includes(p)).map((p) => p.sq));
    const lost = new Set<number>();
    for (const a of arriving) {
      if (taken.has(a.sq)) {
        lost.add(a.id);
        events.push({ kind: 'lost', type: a.type, color: a.color, sq: a.sq });
        if (a.type === 'k') result = { winner: opp(a.color), reason: 'King lost in time' };
      } else {
        events.push({ kind: 'arrived', type: a.type, color: a.color, sq: a.sq });
      }
    }
    if (lost.size) survivors = pieces.filter((p) => !lost.has(p.id));
  }

  const ep = wasPawn && m.fromDt === 0 && m.toDt === 0 && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {
    state: {
      levels: s.levels,
      rules: s.rules,
      ply: s.ply + 1,
      pieces: survivors,
      snapshots: [...s.snapshots, snapshotOf(survivors, s.levels)],
      ep,
      quiet: captured || wasPawn ? 0 : s.quiet + 1,
      result,
    },
    events,
  };
}

/** A move is legal if afterwards your king still exists and can't be captured. */
export function isSafeFor(s: GameState, color: Color): boolean {
  const k = kingOf(s, color);
  return !!k && !attacked(ctxOf(s), k.sq, k.dt, opp(color));
}

export function legalMoves(s: GameState): Move[] {
  if (s.result) return [];
  const color = sideToMove(s);
  return pseudoMoves(ctxOf(s), color).filter((m) => isSafeFor(applyMove(s, m).state, color));
}

/** Works out whether the game is over for the side about to move. */
export function adjudicate(s: GameState, legal: Move[] = legalMoves(s)): Result | null {
  if (s.result) return s.result;
  const color = sideToMove(s);
  if (legal.length === 0) {
    if (inCheck(s, color)) return { winner: opp(color), reason: 'Checkmate' };
    const pseudo = pseudoMoves(ctxOf(s), color);
    if (pseudo.length > 0 && pseudo.every((m) => !kingOf(applyMove(s, m).state, color))) {
      return { winner: opp(color), reason: 'King lost in time' };
    }
    return { winner: null, reason: 'Stalemate' };
  }
  if (s.pieces.every((p) => p.type === 'k')) return { winner: null, reason: 'Only kings left' };
  const q = s.rules.quietDraw;
  if (q > 0 && s.quiet >= q) return { winner: null, reason: `${q} turns without a capture or pawn move` };
  return null;
}

// ---------------------------------------------------------------------------
// Notation

export const timeLabel = (dt: number) => (dt === 0 ? 'now' : dt < 0 ? `t−${-dt}` : `t+${dt}`);

const LETTER: Record<PieceType, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' };

export function moveText(s: GameState, m: Move): string {
  const p = s.pieces.find((x) => x.id === m.pid)!;
  const at = (sq: number, dt: number) => sqName(sq, s.levels) + (dt === 0 ? '' : `[${timeLabel(dt)}]`);
  if (m.castle) return (m.castle === 'K' ? 'O-O' : 'O-O-O') + (m.toDt === 0 ? '' : ` [${timeLabel(m.toDt)}]`);
  const promo = m.promo ? `=${LETTER[m.promo]}` : '';
  return `${LETTER[p.type]}${at(m.from, m.fromDt)}${m.capture !== undefined ? '×' : '→'}${at(m.to, m.toDt)}${promo}`;
}
