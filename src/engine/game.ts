import type { Color, Erasure, GameState, Move, Piece, PieceType, Result, Rules, TimeEvent } from './types';

/** Standard Time Travel Limits: how far a piece may shift back / forward in time in one move. */
export const STANDARD_TTL: Rules['ttl'] = {
  k: { back: 5, fwd: 10 },
  q: { back: 9, fwd: 9 },
  r: { back: 5, fwd: 5 },
  b: { back: 3, fwd: 3 },
  n: { back: 3, fwd: 3 },
  p: { back: 1, fwd: 1 },
};

/** OG rules: how many erasures each piece gets per game. */
export const STANDARD_ERASES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 5, k: 8 };

/** "Simple" rules: the past is history you can see but not touch. */
export const SIMPLE_RULES: Rules = {
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
  history: 'snapshot',
  eraseLimit: STANDARD_ERASES,
};

/**
 * The standard rules ("OG rules"): past boards are real, pieces that go back stay on that board,
 * and capturing a piece there rewrites history.
 */
export const STANDARD_RULES: Rules = { ...SIMPLE_RULES, history: 'living' };
/** Same as STANDARD_RULES; the name the menu uses. */
export const OG_RULES = STANDARD_RULES;
export const isLiving = (s: GameState) => s.rules.history === 'living';

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

/** Which piece (by id) stood on each square of the present board; 0 = empty. */
export function snapIdsOf(pieces: Piece[], levels: number): number[] {
  const b = new Array<number>(64 * levels).fill(0);
  for (const p of pieces) if (p.dt === 0) b[p.sq] = p.id;
  return b;
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
  return fromPieces(pieces, levels, rules);
}

/** A fresh game starting from the given pieces (used by newGame, tests and history replays). */
export function fromPieces(pieces: Piece[], levels: number, rules: Rules): GameState {
  return {
    levels,
    rules,
    ply: 0,
    pieces,
    snapshots: [snapshotOf(pieces, levels)],
    snapIds: [snapIdsOf(pieces, levels)],
    ep: -1,
    quiet: 0,
    result: null,
    initial: pieces.map((p) => ({ ...p })),
    record: [],
    erasures: [],
    voided: [],
  };
}

// ---------------------------------------------------------------------------
// Occupancy

export const GHOST = 'ghost' as const;
/** OG rules: a piece standing on a past board as part of history (not a time traveller). */
export interface HistPiece {
  hist: true;
  id: number;
  type: PieceType;
  color: Color;
  /** the absolute turn of the board it stands on */
  ply: number;
}
export type Occupant = Piece | HistPiece | typeof GHOST | null;
export const isHist = (o: Occupant): o is HistPiece => !!o && o !== GHOST && 'hist' in o;

const key = (sq: number, dt: number) => (dt + 16384) * 512 + sq;

export interface Ctx {
  s: GameState;
  occ: Map<number, Piece>;
  /** erasures used per piece id, worked out when first needed */
  used?: Map<number, number>;
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
    const T = c.s.ply + L;
    const snap = c.s.snapshots[T];
    if (snap !== undefined && snap.charCodeAt(sq) !== 46) {
      if (!isLiving(c.s)) return GHOST;
      const ch = snap[sq];
      const lower = ch.toLowerCase() as PieceType;
      return { hist: true, id: c.s.snapIds[T][sq], type: lower, color: ch === lower ? 'b' : 'w', ply: T };
    }
  }
  return null;
}

export const eraseLimitOf = (s: GameState, t: PieceType) => s.rules.eraseLimit?.[t] ?? STANDARD_ERASES[t];

/** How many times each piece has erased someone from history this game (moves later voided don't count). */
function usedErases(s: GameState): Map<number, number> {
  const used = new Map<number, number>();
  const voided = new Set(s.voided);
  s.record.forEach((m, i) => {
    if (m.erase !== undefined && !voided.has(i)) used.set(m.pid, (used.get(m.pid) ?? 0) + 1);
  });
  return used;
}

/** How many more erasures this piece may make. */
export function erasesLeft(s: GameState, p: Piece, c?: Ctx): number {
  const used = c ? (c.used ??= usedErases(s)) : usedErases(s);
  return Math.max(0, eraseLimitOf(s, p.type) - (used.get(p.id) ?? 0));
}

/** The capture (or history erasure) of whatever stands on the target, if allowed. */
function captureOf(c: Ctx, o: Occupant, mover: Piece): Pick<Move, 'capture' | 'erase'> | null {
  if (!o || o === GHOST || o.color === mover.color) return null;
  if (isHist(o)) {
    // Past kings can't be captured, and each piece only has so many erasures.
    if (o.type === 'k' || erasesLeft(c.s, mover, c) <= 0) return null;
    return { capture: o.id, erase: o.ply };
  }
  return { capture: o.id };
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
    return;
  }
  const cap = captureOf(c, o, p);
  // Erasing history replays the whole game, so the bot's capture-only search leaves it out.
  if (cap && !(cap.erase !== undefined && mode === 'captures')) out.push({ pid: p.id, from: p.sq, fromDt: p.dt, to, toDt: L, ...cap });
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
      const cap = captureOf(c, o, p);
      if (cap && !(cap.erase !== undefined && mode === 'captures')) {
        push({ pid: p.id, from: p.sq, fromDt: p.dt, to: t, toDt: L, ...cap });
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
  if (m.erase !== undefined && isLiving(s)) return rewriteHistory(s, m);
  return playTurn(s, m, m);
}

/**
 * Plays one turn. `m` is the move to make, or null for a turn where nothing moves (during a
 * history replay, when a recorded move no longer makes sense). `raw` is what goes in the record.
 */
function playTurn(s: GameState, m: Move | null, raw: Move): { state: GameState; events: TimeEvent[] } {
  // Capturing a piece on a past board doesn't remove anything here: that's rewriteHistory's job.
  const captured = m && m.capture !== undefined && m.erase === undefined ? s.pieces.find((p) => p.id === m.capture) : undefined;
  const pieces = s.pieces.filter((p) => p.id !== captured?.id).map((p) => ({ ...p }));
  let wasPawn = false;
  let result: Result | null = null;
  if (m) {
    const mover = pieces.find((p) => p.id === m.pid)!;
    wasPawn = mover.type === 'p';
    mover.sq = m.to;
    mover.dt = m.toDt;
    mover.moved = true;
    if (m.promo) mover.type = m.promo;
    if (m.castle) {
      const rook = pieces.find((p) => p.id === m.rookId)!;
      rook.sq = m.castle === 'K' ? m.to - 1 : m.to + 1;
      rook.moved = true;
    }
    if (captured?.type === 'k') result = { winner: mover.color, reason: 'King captured' };
  }

  // Time moves on. Future pieces get one turn closer and land when they reach the present.
  // Under OG rules, past pieces stay on the board they went to, so they fall one turn further
  // behind, and are pulled back to the present once they're further back than their limit.
  const living = isLiving(s);
  const events: TimeEvent[] = [];
  const landing: { p: Piece; kind: 'arrived' | 'returned' }[] = [];
  for (const p of pieces) {
    if (p.dt > 0) {
      if (--p.dt === 0) landing.push({ p, kind: 'arrived' });
    } else if (living && p.dt < 0) {
      p.dt--;
      if (-p.dt > ttlOf(s, p.type).back) {
        p.dt = 0;
        landing.push({ p, kind: 'returned' });
      }
    }
  }
  let survivors = pieces;
  if (landing.length) {
    const landingIds = new Set(landing.map((l) => l.p.id));
    const taken = new Set(pieces.filter((p) => p.dt === 0 && !landingIds.has(p.id)).map((p) => p.sq));
    const lost = new Set<number>();
    for (const { p: a, kind } of landing) {
      if (taken.has(a.sq)) {
        lost.add(a.id);
        events.push({ kind: 'lost', type: a.type, color: a.color, sq: a.sq });
        if (a.type === 'k') result = { winner: opp(a.color), reason: 'King lost in time' };
      } else {
        taken.add(a.sq);
        events.push({ kind, type: a.type, color: a.color, sq: a.sq });
      }
    }
    if (lost.size) survivors = pieces.filter((p) => !lost.has(p.id));
  }

  const ep = m && wasPawn && m.fromDt === 0 && m.toDt === 0 && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {
    state: {
      levels: s.levels,
      rules: s.rules,
      ply: s.ply + 1,
      pieces: survivors,
      snapshots: [...s.snapshots, snapshotOf(survivors, s.levels)],
      snapIds: [...s.snapIds, snapIdsOf(survivors, s.levels)],
      ep,
      quiet: captured || wasPawn ? 0 : s.quiet + 1,
      result,
      initial: s.initial,
      record: [...s.record, raw],
      erasures: s.erasures,
      voided: m ? s.voided : [...s.voided, s.ply],
    },
    events,
  };
}

// ---------------------------------------------------------------------------
// OG rules: rewriting history

/**
 * A piece on a past board was captured: erase it from that turn onward and replay every move since,
 * so it's gone from the present too, anything it captured later is back, and moves that no longer
 * make sense don't happen.
 */
function rewriteHistory(s: GameState, m: Move): { state: GameState; events: TimeEvent[] } {
  const T = m.erase!;
  const ch = s.snapshots[T]?.[m.to] ?? '.';
  const victim = { type: ch.toLowerCase() as PieceType, color: (ch === ch.toLowerCase() ? 'b' : 'w') as Color };
  const erasures: Erasure[] = [...s.erasures, { ply: T, id: m.capture! }];
  const { state, events } = replay(s, [...s.record, m], erasures);
  return { state, events: [{ kind: 'erased', type: victim.type, color: victim.color, sq: m.to }, ...events] };
}

/** Replays a game from its first position with the given erasures applied. */
export function replay(s: GameState, record: Move[], erasures: Erasure[]): { state: GameState; events: TimeEvent[] } {
  let cur: GameState = { ...fromPieces(s.initial.map((p) => ({ ...p })), s.levels, s.rules), erasures };
  cur = eraseNow(cur);
  let events: TimeEvent[] = [];
  for (const raw of record) {
    if (cur.result) break;
    const r = playTurn(cur, replayable(cur, raw), raw);
    cur = eraseNow(r.state);
    events = r.events;
  }
  return { state: cur, events };
}

/** Removes pieces erased at the current turn from the board (and from this turn's snapshot). */
function eraseNow(s: GameState): GameState {
  const gone = new Set(s.erasures.filter((e) => e.ply === s.ply).map((e) => e.id));
  if (!gone.size || !s.pieces.some((p) => gone.has(p.id))) return s;
  const pieces = s.pieces.filter((p) => !gone.has(p.id));
  return {
    ...s,
    pieces,
    snapshots: [...s.snapshots.slice(0, -1), snapshotOf(pieces, s.levels)],
    snapIds: [...s.snapIds.slice(0, -1), snapIdsOf(pieces, s.levels)],
  };
}

/** The recorded move as it would be played now, or null if it no longer can be. */
function replayable(s: GameState, raw: Move): Move | null {
  const p = s.pieces.find((x) => x.id === raw.pid);
  if (!p || p.sq !== raw.from || p.dt !== raw.fromDt || p.color !== sideToMove(s)) return null;
  const out: Move[] = [];
  pieceMoves(ctxOf(s), p, out, 'all');
  const m = out.find((x) => x.to === raw.to && x.toDt === raw.toDt && (x.promo ?? null) === (raw.promo ?? null) && (x.castle ?? null) === (raw.castle ?? null));
  // A replayed move never starts another rewrite; it simply lands there.
  if (m) return { ...m, erase: undefined, capture: m.erase !== undefined ? undefined : m.capture };
  // The move that did the erasing still lands where its victim stood, even though the square is now
  // empty (a pawn's diagonal capture onto an empty square isn't otherwise a move).
  if (raw.erase !== undefined && at(ctxOf(s), raw.to, raw.toDt) === null) {
    return { pid: raw.pid, from: raw.from, fromDt: raw.fromDt, to: raw.to, toDt: raw.toDt, ...(raw.promo ? { promo: raw.promo } : {}) };
  }
  return null;
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
