import { expect, it } from 'vitest';
import { applyMove, legalMoves, newGame } from './game';

it('the piece that erases always lands where its victim stood (pawns included)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let erases = 0;
  for (let g = 0; g < 25; g++) {
    let s = newGame({ levels: 1 });
    for (let i = 0; i < 50 && !s.result; i++) {
      const ms = legalMoves(s);
      if (!ms.length) break;
      const er = ms.filter((m) => m.erase !== undefined);
      const m = er.length && rnd() < 0.5 ? er[Math.floor(rnd() * er.length)] : ms[Math.floor(rnd() * ms.length)];
      const next = applyMove(s, m).state;
      if (m.erase !== undefined) {
        erases++;
        expect(next.voided).not.toContain(s.ply);
      }
      s = next;
    }
  }
  expect(erases).toBeGreaterThan(20);
}, 60_000);

it('each piece only has so many erasures (a pawn gets one)', async () => {
  const { fromPieces, STANDARD_RULES, legalMoves: legal, applyMove: apply, erasesLeft } = await import('./game');
  // White pawn on d4 in the past (t−1) next to two black pawns that stood on c5 and e5 back then.
  const pieces = [
    { id: 1, type: 'k' as const, color: 'w' as const, sq: 4, dt: 0, moved: false },
    { id: 2, type: 'k' as const, color: 'b' as const, sq: 60, dt: 0, moved: false },
    { id: 3, type: 'p' as const, color: 'w' as const, sq: 27, dt: 0, moved: true },
    { id: 4, type: 'p' as const, color: 'b' as const, sq: 34, dt: 0, moved: true },
    { id: 5, type: 'p' as const, color: 'b' as const, sq: 36, dt: 0, moved: true },
  ];
  let s = fromPieces(pieces, 1, STANDARD_RULES);
  // quiet king moves so there is a past to go back to (with Black having had a turn)
  s = apply(s, { pid: 1, from: 4, fromDt: 0, to: 5, toDt: 0 }).state;
  s = apply(s, { pid: 2, from: 60, fromDt: 0, to: 61, toDt: 0 }).state;
  s = apply(s, { pid: 1, from: 5, fromDt: 0, to: 4, toDt: 0 }).state;
  s = apply(s, { pid: 2, from: 61, fromDt: 0, to: 60, toDt: 0 }).state;
  const pawn = s.pieces.find((p) => p.id === 3)!;
  expect(erasesLeft(s, pawn)).toBe(1);
  const erase = legal(s).find((m) => m.pid === 3 && m.erase !== undefined)!;
  expect(erase).toBeDefined();
  s = apply(s, erase).state;
  const after = s.pieces.find((p) => p.id === 3)!;
  expect(after.sq).toBe(erase.to); // it lands where its victim stood
  expect(erasesLeft(s, after)).toBe(0);
  s = apply(s, { pid: 2, from: 60, fromDt: 0, to: 61, toDt: 0 }).state;
  expect(legal(s).filter((m) => m.pid === 3 && m.erase !== undefined)).toEqual([]);
});
