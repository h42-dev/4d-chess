import { describe, expect, it } from 'vitest';
import { adjudicate, applyMove, ctxOf, fromPieces, inCheck, legalMoves, newGame, OG_RULES, SIMPLE_RULES, sqAt, STANDARD_RULES } from './game';
import type { GameState, Move, Piece } from './types';

const sq = (name: string) => (name.charCodeAt(0) - 97) + (Number(name[1]) - 1) * 8;

/** Plays a list of moves given as "e2e4", "d8d5@-3" (target time), "d5@-3>d5@0" (piece in a past layer). */
function play(moves: string[], s: GameState = newGame()): GameState {
  for (const mv of moves) {
    const m = findMove(s, mv);
    if (!m) throw new Error(`illegal: ${mv} at ply ${s.ply}`);
    s = applyMove(s, m).state;
  }
  return s;
}

function findMove(s: GameState, mv: string): Move | undefined {
  const re = /^([a-h][1-8])(?:@(-?\d+))?>?([a-h][1-8])(?:@(-?\d+))?$/;
  const [, from, fromDt, to, toDt] = mv.match(re)!;
  return legalMoves(s).find(
    (m) =>
      m.from === sq(from) && m.to === sq(to) &&
      m.fromDt === Number(fromDt ?? 0) && m.toDt === Number(toDt ?? fromDt ?? 0) &&
      (!m.promo || m.promo === 'q'),
  );
}

/** Builds a position from scratch with a given history length. */
function position(pieces: Omit<Piece, 'id' | 'moved'>[], ply: number, history?: string[], levels = 1): GameState {
  const ps = pieces.map((p, i) => ({ ...p, id: i + 1, moved: true }));
  const s = fromPieces(ps, levels, STANDARD_RULES);
  return {
    ...s,
    ply,
    snapshots: history ?? Array.from({ length: ply + 1 }, () => s.snapshots[0]),
    snapIds: Array.from({ length: ply + 1 }, () => s.snapIds[0]),
  };
}

describe('normal chess still works', () => {
  it('has the usual 20 present-time opening moves', () => {
    const present = legalMoves(newGame()).filter((m) => m.toDt === 0);
    expect(present).toHaveLength(20);
  });

  it("fool's mate is still mate", () => {
    const s = play(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    // White could only escape by sending the king into the future, so check the escape exists...
    const escapes = legalMoves(s);
    expect(escapes.length).toBeGreaterThan(0);
    expect(escapes.every((m) => m.toDt !== 0 || m.pid !== s.pieces.find((p) => p.type === 'k' && p.color === 'w')!.id || m.capture)).toBe(true);
    expect(inCheck(s, 'w')).toBe(true);
  });
});

describe('travelling into the past', () => {
  it("queen joins an occupied square at an earlier time (the d5 example)", () => {
    // 1. e4 d5 2. exd5 ... black queen d8 wants d5, which has been occupied since ply 3.
    let s = play(['e2e4', 'd7d5', 'e4d5']);
    // ply 3, black to move. d5 had black's pawn at ply 2, white's pawn now. Ply 1 (gap -2): d5 empty.
    const back = findMove(s, 'd8d5@-2');
    expect(back).toBeDefined();
    // gap -1 = ply 2, when black's own pawn stood on d5 → blocked by history.
    expect(findMove(s, 'd8d5@-1')).toBeUndefined();
    s = applyMove(s, back!).state;
    const q = s.pieces.find((p) => p.type === 'q' && p.color === 'b')!;
    expect(q.sq).toBe(sq('d5'));
    // It stays on the T=1 board, which is 3 turns back once this turn is over.
    expect(q.dt).toBe(-3);
    // White's pawn still in the present on the same square.
    expect(s.pieces.some((p) => p.sq === sq('d5') && p.dt === 0 && p.color === 'w')).toBe(true);
  });

  it('Simple rules: past pieces keep a fixed gap as time moves on', () => {
    let s = play(['e2e4', 'd7d5', 'e4d5', 'd8d5@-2', 'g1f3'], newGame({ rules: SIMPLE_RULES }));
    const q = s.pieces.find((p) => p.type === 'q' && p.color === 'b')!;
    expect(q.dt).toBe(-2);
    s = play(['a7a6'], s);
    expect(s.pieces.find((p) => p.id === q.id)!.dt).toBe(-2);
  });

  it('a present queen can drop straight down through time to capture (the knight example)', () => {
    // White knight sits on e5 two turns in the past; black queen on e5 in the present.
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('a1'), dt: 0 },
        { type: 'k', color: 'b', sq: sq('h8'), dt: 0 },
        { type: 'q', color: 'b', sq: sq('e5'), dt: 0 },
        { type: 'n', color: 'w', sq: sq('e5'), dt: -2 },
      ],
      5,
    );
    s.ply = 5; // black to move
    const take = legalMoves(s).find((m) => m.to === sq('e5') && m.from === sq('e5') && m.toDt === -2);
    expect(take?.capture).toBeDefined();
  });

  it('pieces can only capture through time within their TTL', () => {
    const base = (dt: number) =>
      position(
        [
          { type: 'k', color: 'w', sq: sq('a1'), dt: 0 },
          { type: 'k', color: 'b', sq: sq('h8'), dt: 0 },
          { type: 'n', color: 'w', sq: sq('d4'), dt: 0 },
          { type: 'q', color: 'b', sq: sq('e6'), dt },
        ],
        10,
      );
    const knightTakes = (s: GameState) => legalMoves(s).some((m) => m.capture !== undefined && m.to === sq('e6'));
    expect(knightTakes(base(3))).toBe(true);
    expect(knightTakes(base(-3))).toBe(true);
    expect(knightTakes(base(5))).toBe(false); // the example from the rules
    expect(knightTakes(base(-4))).toBe(false);
  });

  it('cannot go further back than the start of the game', () => {
    // T=0: the first move has nothing to go back to.
    const s = newGame();
    expect(legalMoves(s).every((m) => m.toDt >= 0)).toBe(true);
    // T=1: black's reply can go back to T=0, but no further.
    const t1 = play(['e2e4']);
    const dts = legalMoves(t1).map((m) => m.toDt);
    expect(Math.min(...dts)).toBe(-1);
  });
});

describe('travelling into the future', () => {
  it('a future piece arrives when time catches up', () => {
    let s = play(['g1f3@3']); // knight lands on f3, 3 turns from now
    const n = s.pieces.find((p) => p.type === 'n' && p.sq === sq('f3'))!;
    expect(n.dt).toBe(2);
    s = play(['a7a6', 'a2a3'], s);
    expect(s.pieces.find((p) => p.id === n.id)!.dt).toBe(0);
  });

  it('a future piece is lost if its square is taken when it arrives', () => {
    // White's knight is due on c3 three turns from now; white's own pawn gets there just before.
    const s = play(['b1c3@3', 'a7a6']);
    expect(s.pieces.find((p) => p.type === 'n' && p.sq === sq('c3'))!.dt).toBe(1);
    const arrival = applyMove(s, findMove(s, 'c2c3')!);
    expect(arrival.events).toEqual([{ kind: 'lost', type: 'n', color: 'w', sq: sq('c3') }]);
    expect(arrival.state.pieces.some((p) => p.type === 'n' && p.sq === sq('c3'))).toBe(false);
  });

  it('a king lost on arrival ends the game', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('e4'), dt: 1 },
        { type: 'k', color: 'b', sq: sq('h8'), dt: 0 },
        { type: 'r', color: 'b', sq: sq('e8'), dt: 0 },
      ],
      9,
    );
    // black to move; rook to e4 means white's king arrives on an occupied square.
    const m = legalMoves(s).find((x) => x.from === sq('e8') && x.to === sq('e4') && x.toDt === 0)!;
    const next = applyMove(s, m).state;
    expect(next.result).toEqual({ winner: 'b', reason: 'King lost in time' });
    expect(adjudicate(next)?.winner).toBe('b');
  });

  it('the king can go 10 forward but only 5 back', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('e1'), dt: 0 },
        { type: 'k', color: 'b', sq: sq('e8'), dt: 0 },
      ],
      20,
    );
    const dts = legalMoves(s).filter((m) => m.from === sq('e1')).map((m) => m.toDt);
    expect(Math.max(...dts)).toBe(10);
    expect(Math.min(...dts)).toBe(-5);
  });

  it('a piece can never be further from the present than its TTL', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('e1'), dt: 8 },
        { type: 'k', color: 'b', sq: sq('e8'), dt: 0 },
      ],
      20,
    );
    s.rules = { ...s.rules, futureRunning: true }; // house rule, so the horizon is what stops it
    const dts = legalMoves(s).filter((m) => m.from === sq('e1')).map((m) => m.toDt);
    expect(Math.max(...dts)).toBe(10);
    expect(Math.min(...dts)).toBe(3); // 8 − 5
  });
});

describe('no passing', () => {
  it('a piece cannot hop one turn ahead on its own square', () => {
    const s = newGame();
    expect(legalMoves(s).some((m) => m.from === m.to && m.toDt === m.fromDt + 1)).toBe(false);
    // ...but it can jump further, or hop one ahead onto a different square.
    expect(legalMoves(s).some((m) => m.from === m.to && m.toDt === 2)).toBe(true);
    expect(findMove(s, 'g1f3@1')).toBeDefined();
  });

  it('a future piece cannot stall by hopping one further ahead', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('a1'), dt: 0 },
        { type: 'k', color: 'b', sq: sq('h8'), dt: 0 },
        { type: 'q', color: 'w', sq: sq('d4'), dt: 3 },
      ],
      10,
    );
    s.rules = { ...s.rules, futureRunning: true }; // under standard rules it can't go further ahead at all
    const q = legalMoves(s).filter((m) => m.from === sq('d4') && m.to === sq('d4')).map((m) => m.toDt);
    expect(q).not.toContain(4);
    expect(q).toContain(5);
  });
});

describe('time catches up', () => {
  it('a piece in the future cannot run even further ahead', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('e1'), dt: 3 },
        { type: 'k', color: 'b', sq: sq('e8'), dt: 0 },
      ],
      20,
    );
    const dts = legalMoves(s).filter((m) => m.from === sq('e1')).map((m) => m.toDt);
    expect(Math.max(...dts)).toBe(3); // can stay level or come back, never go further
    expect(Math.min(...dts)).toBe(-2);
  });

  it('house rules can allow it again', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq('e1'), dt: 3 },
        { type: 'k', color: 'b', sq: sq('e8'), dt: 0 },
      ],
      20,
    );
    s.rules = { ...s.rules, futureRunning: true };
    expect(Math.max(...legalMoves(s).filter((m) => m.from === sq('e1')).map((m) => m.toDt))).toBe(10);
  });
});

describe('paths', () => {
  it('sliding pieces travel through their own time, then drop into the target time', () => {
    // Opening position: the queen is boxed in by its own pieces in the present, so it can't leap
    // across the board even in an empty future.
    const s = newGame();
    const q = s.pieces.find((p) => p.type === 'q' && p.color === 'w')!;
    const qm = legalMoves(s).filter((m) => m.pid === q.id);
    expect(qm.every((m) => m.to === q.sq || [sq('c1'), sq('e1'), sq('c2'), sq('d2'), sq('e2')].includes(m.to))).toBe(true);
    expect(ctxOf(s)).toBeTruthy();
  });
});

describe('4D chess (three levels)', () => {
  /** square on a 3-level board: level 0 = lower, 1 = middle, 2 = upper */
  const sq3 = (name: string, z: number) => sqAt(name.charCodeAt(0) - 97, Number(name[1]) - 1, z);
  const flat = (s: GameState) => ({ ...s, rules: { ...s.rules, timeTravel: false } });

  it('starts like normal chess on the middle level', () => {
    const s = newGame({ levels: 3 });
    expect(s.pieces.every((p) => p.sq >> 6 === 1)).toBe(true);
    expect(s.snapshots[0]).toHaveLength(192);
  });

  it('opening moves include climbing pawns and knights jumping between levels', () => {
    const s = flat(newGame({ levels: 3 }));
    const ms = legalMoves(s);
    // e2 pawn: e3 / e4 on the middle level, plus e3 on the levels above and below
    const pawn = ms.filter((m) => m.from === sq3('e2', 1)).map((m) => m.to).sort((a, b) => a - b);
    expect(pawn).toEqual([sq3('e3', 0), sq3('e3', 1), sq3('e4', 1), sq3('e3', 2)].sort((a, b) => a - b));
    // g1 knight can jump 2 up/down levels? No: only 3 levels, from the middle ±2 is off the board.
    // But it can go one level up/down and two ranks forward.
    const knight = ms.filter((m) => m.from === sq3('g1', 1)).map((m) => m.to);
    expect(knight).toContain(sq3('g3', 0));
    expect(knight).toContain(sq3('g3', 2));
    expect(knight).toContain(sq3('f3', 1));
  });

  it('rooks move straight up and down, bishops along diagonals in vertical planes', () => {
    const s = flat(position(
      [
        { type: 'k', color: 'w', sq: sq3('a1', 1), dt: 0 },
        { type: 'k', color: 'b', sq: sq3('h8', 1), dt: 0 },
        { type: 'r', color: 'w', sq: sq3('d4', 1), dt: 0 },
        { type: 'b', color: 'w', sq: sq3('f4', 1), dt: 0 },
      ],
      0, undefined, 3,
    ));
    const ms = legalMoves(s);
    const rook = ms.filter((m) => m.from === sq3('d4', 1)).map((m) => m.to);
    expect(rook).toContain(sq3('d4', 0));
    expect(rook).toContain(sq3('d4', 2));
    expect(rook).not.toContain(sq3('e5', 2));
    const bishop = ms.filter((m) => m.from === sq3('f4', 1)).map((m) => m.to);
    expect(bishop).toContain(sq3('f5', 2)); // rank + level
    expect(bishop).toContain(sq3('g4', 0)); // file + level
    expect(bishop).toContain(sq3('g5', 1)); // ordinary diagonal
    expect(bishop).not.toContain(sq3('g5', 2)); // a 3D diagonal is the queen's, not the bishop's
  });

  it('a queen on another level can give check along a 3D diagonal', () => {
    const s = position(
      [
        { type: 'k', color: 'w', sq: sq3('e1', 1), dt: 0 },
        { type: 'k', color: 'b', sq: sq3('h8', 1), dt: 0 },
        { type: 'q', color: 'b', sq: sq3('d2', 0), dt: 0 },
      ],
      1, undefined, 3,
    );
    expect(inCheck(s, 'w')).toBe(true);
  });

  it('flat Time Travel Chess is unaffected', () => {
    expect(legalMoves(newGame()).filter((m) => m.toDt === 0)).toHaveLength(20);
  });
});

describe('OG rules (living history)', () => {
  const og = (moves: string[]) => play(moves, newGame({ rules: OG_RULES }));
  const find = (s: GameState, from: string, fromDt: number, to: string, toDt: number) =>
    legalMoves(s).find((m) => m.from === sq(from) && m.fromDt === fromDt && m.to === sq(to) && m.toDt === toDt);

  it('going back to T=0 lands on the starting position, but a traveller there cannot ambush anyone', () => {
    // 1. e4 a6: the queen can now leave d1 through e2, and drops back to T=0 on h5.
    let s = og(['e2e4', 'a7a6']);
    const back = find(s, 'd1', 0, 'h5', -2);
    expect(back).toBeDefined();
    s = applyMove(s, back!).state;
    s = play(['h7h6'], s);
    // The queen is still on the T=0 board (now 4 turns back), surrounded by the starting position.
    const q = s.pieces.find((p) => p.type === 'q' && p.color === 'w')!;
    expect(q.dt).toBe(-4);
    // f7 still has Black's pawn on that board, but the queen was never on h5 while Black had a turn,
    // so the pawn never had a chance to get out of the way: no erasing it.
    expect(find(s, 'h5', -4, 'f7', -4)).toBeUndefined();
  });

  it('no ambushes: a threat the victim escaped straight away cannot be cashed in from the past', () => {
    const pieces = [
      { id: 1, type: 'k', color: 'w', sq: sq('a1'), dt: 0, moved: true },
      { id: 2, type: 'b', color: 'w', sq: sq('c1'), dt: 0, moved: true },
      { id: 3, type: 'k', color: 'b', sq: sq('h8'), dt: 0, moved: true },
      { id: 4, type: 'n', color: 'b', sq: sq('e5'), dt: 0, moved: true },
    ] as Piece[];
    // The bishop attacks the knight; the knight runs away.
    const s = play(['a1a2', 'h8g8', 'c1b2', 'e5c4'], fromPieces(pieces, 1, OG_RULES));
    expect(legalMoves(s).filter((m) => m.pid === 2 && m.to === sq('e5') && m.erase !== undefined)).toEqual([]);
  });

  it('a piece left in danger through its turn can have its history undone', () => {
    const pieces = [
      { id: 1, type: 'k', color: 'w', sq: sq('a1'), dt: 0, moved: true },
      { id: 2, type: 'b', color: 'w', sq: sq('c1'), dt: 0, moved: true },
      { id: 3, type: 'k', color: 'b', sq: sq('h8'), dt: 0, moved: true },
      { id: 4, type: 'n', color: 'b', sq: sq('e5'), dt: 0, moved: true },
    ] as Piece[];
    // The bishop attacks the knight; Black moves the king instead, then the knight leaves.
    const s = play(['a1a2', 'h8g8', 'c1b2', 'g8f8', 'a2a1', 'e5c4'], fromPieces(pieces, 1, OG_RULES));
    // On the board from after Black ignored the threat (T=4), the knight is fair game.
    const take = find(s, 'b2', 0, 'e5', -2);
    expect(take?.erase).toBe(4);
    const after = applyMove(s, take!).state;
    expect(after.pieces.some((p) => p.id === 4)).toBe(false);
    // ...but not on the board from just after the bishop arrived, before Black had a turn.
    expect(find(s, 'b2', 0, 'e5', -3)).toBeUndefined();
  });

  it('erasing a piece brings back what it captured later, and its later moves never happen', () => {
    const pieces = [
      { id: 1, type: 'k', color: 'w', sq: sq('a1'), dt: 0, moved: true },
      { id: 2, type: 'q', color: 'w', sq: sq('c1'), dt: 0, moved: true },
      { id: 3, type: 'p', color: 'w', sq: sq('d4'), dt: 0, moved: true },
      { id: 4, type: 'k', color: 'b', sq: sq('h8'), dt: 0, moved: true },
      { id: 5, type: 'n', color: 'b', sq: sq('b8'), dt: 0, moved: true },
    ] as Piece[];
    let s = play(['a1a2', 'b8c6', 'a2a1', 'c6d4'], fromPieces(pieces, 1, OG_RULES));
    expect(s.pieces.some((p) => p.id === 3)).toBe(false); // the knight took the d4 pawn
    // The queen goes back two turns, to when the knight stood on c6, and takes it.
    const take = find(s, 'c1', 0, 'c6', -2);
    expect(take?.erase).toBe(2);
    s = applyMove(s, take!).state;
    expect(s.pieces.some((p) => p.id === 5)).toBe(false); // the knight is gone
    expect(s.pieces.find((p) => p.id === 3)).toMatchObject({ sq: sq('d4'), dt: 0 }); // the pawn is back
  });

  it('a piece further back than its limit is pulled back to the present', () => {
    const pieces = [
      { id: 1, type: 'k', color: 'w', sq: sq('a1'), dt: 0, moved: true },
      { id: 2, type: 'r', color: 'w', sq: sq('h1'), dt: 0, moved: true },
      { id: 3, type: 'k', color: 'b', sq: sq('a8'), dt: 0, moved: true },
    ] as Piece[];
    const s = play(['a1a2', 'a8b8', 'a2a1', 'b8a8', 'a1a2', 'a8b8'], fromPieces(pieces, 1, OG_RULES));
    // Rook to h4, four turns back: it stays there (now 5 back, its limit)...
    let r = applyMove(s, find(s, 'h1', 0, 'h4', -4)!);
    expect(r.state.pieces.find((p) => p.id === 2)!.dt).toBe(-5);
    // ...and after one more turn it's too far back, so it's pulled into the present on h4.
    r = applyMove(r.state, find(r.state, 'b8', 0, 'a8', 0)!);
    expect(r.events).toContainEqual({ kind: 'returned', type: 'r', color: 'w', sq: sq('h4') });
    expect(r.state.pieces.find((p) => p.id === 2)).toMatchObject({ sq: sq('h4'), dt: 0 });
  });

  it('past kings cannot be captured', () => {
    const pieces = [
      { id: 1, type: 'k', color: 'w', sq: sq('a1'), dt: 0, moved: true },
      { id: 2, type: 'q', color: 'w', sq: sq('e1'), dt: 0, moved: true },
      { id: 3, type: 'k', color: 'b', sq: sq('e8'), dt: 0, moved: true },
    ] as Piece[];
    // The black king has stepped from e8 to d8; on the past boards it's still on e8.
    const s = play(['a1a2', 'e8d8'], fromPieces(pieces, 1, OG_RULES));
    const toE8 = legalMoves(s).filter((m) => m.pid === 2 && m.to === sq('e8')).map((m) => m.toDt);
    expect(toE8).toContain(0); // empty now
    expect(toE8).not.toContain(-1); // the king's past self is there: no capture
    expect(toE8).not.toContain(-2);
  });

  it('Simple rules: past pieces are history you can see but not touch', () => {
    const s = play(['e2e4', 'a7a6', 'd1h5', 'a6a5'], newGame({ rules: SIMPLE_RULES }));
    expect(legalMoves(s).some((m) => m.erase !== undefined)).toBe(false);
  });
});
