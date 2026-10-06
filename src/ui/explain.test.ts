import { describe, expect, it } from 'vitest';
import { fromPieces, STANDARD_RULES } from '../engine/game';
import type { Piece } from '../engine/types';
import { whyNoCapture } from './explain';

const sq = (n: string) => n.charCodeAt(0) - 97 + (Number(n[1]) - 1) * 8;

describe('why a piece cannot capture', () => {
  it('explains the king-in-the-future case from the screenshot', () => {
    const pieces = [
      { id: 1, type: 'k', color: 'w', sq: sq('e2'), dt: 8, moved: true },
      { id: 2, type: 'k', color: 'b', sq: sq('e8'), dt: 0, moved: true },
      { id: 3, type: 'r', color: 'b', sq: sq('d1'), dt: 0, moved: true },
    ] as Piece[];
    const s = { ...fromPieces(pieces, 1, STANDARD_RULES), ply: 20 };
    const text = whyNoCapture(s, s.pieces[0], s.pieces[2]);
    expect(text).toContain('in 8 turns');
    expect(text).toContain('+3 to +8');
    expect(text).toContain('back at most 5');
    expect(text).toContain('reach the present in 3 turns');
  });
});
