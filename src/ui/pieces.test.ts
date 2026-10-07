import { expect, it } from 'vitest';
import { applyMove, legalMoves, newGame, startLevel } from '../engine/game';
import { isLight } from './pieces';

it('flat board colours are the usual ones (a1 dark, h1 light)', () => {
  expect(isLight(0, 1)).toBe(false);
  expect(isLight(7, 1)).toBe(true);
});

it('4D: the middle level looks normal, and every bishop move stays on its colour, across levels too', () => {
  const z = startLevel(3);
  expect(isLight(z * 64 + 0, 3)).toBe(false);
  let s = newGame({ levels: 3 });
  let bishopMoves = 0;
  let levelChanges = 0;
  for (let i = 0; i < 40 && !s.result; i++) {
    const ms = legalMoves(s);
    for (const m of ms) {
      const p = s.pieces.find((x) => x.id === m.pid)!;
      if (p.type !== 'b') continue;
      bishopMoves++;
      if (m.to >> 6 !== m.from >> 6) levelChanges++;
      expect(isLight(m.to, 3)).toBe(isLight(m.from, 3));
    }
    s = applyMove(s, ms[(i * 7) % ms.length]).state;
  }
  expect(bishopMoves).toBeGreaterThan(100);
  expect(levelChanges).toBeGreaterThan(10);
});
