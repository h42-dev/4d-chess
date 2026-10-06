import { describe, expect, it } from 'vitest';
import { applyMove, legalMoves, moveText, newGame } from '../engine/game';
import { matchMove, parseReply, positionPrompt, systemPrompt } from './prompt';

describe('AI prompt', () => {
  it('every legal move can be read back from its own notation', () => {
    for (const levels of [1, 3]) {
      let s = newGame({ levels });
      // a few moves in, so there are time travellers and captures around
      for (let i = 0; i < 6; i++) s = applyMove(s, legalMoves(s)[(i * 37) % legalMoves(s).length]).state;
      const legal = legalMoves(s);
      for (const m of legal) {
        const got = matchMove(s, legal, moveText(s, m));
        expect(got && moveText(s, got)).toBe(moveText(s, m));
      }
    }
  });

  it('accepts common ways of writing the same move', () => {
    const s = newGame();
    const legal = legalMoves(s);
    for (const text of ['e2→e4', 'e2->e4', 'e2-e4', ' e2 → e4 ', 'e2→e4[now]']) {
      expect(matchMove(s, legal, text) && moveText(s, matchMove(s, legal, text)!)).toBe('e2→e4');
    }
    expect(moveText(s, matchMove(s, legal, 'Ng1->f3[t+2]')!)).toBe('Ng1→f3[t+2]');
    expect(moveText(s, matchMove(s, legal, 'Ng1→f3[t+2]')!)).toBe('Ng1→f3[t+2]');
    expect(matchMove(s, legal, 'e2→e5')).toBeNull();
  });

  it('reads JSON replies, even with extra text around them', () => {
    expect(parseReply('{"move":"e2→e4","comment":"centre"}')).toEqual({ move: 'e2→e4', comment: 'centre' });
    expect(parseReply('Sure! ```json\n{"move": "Ng1→f3", "comment": "develop"}\n```')).toEqual({ move: 'Ng1→f3', comment: 'develop' });
    expect(parseReply('I will play "move": "d2→d4" now')).toEqual({ move: 'd2→d4' });
    expect(parseReply('no idea')).toBeNull();
  });

  it('describes the position and lists the legal moves compactly', () => {
    const s = newGame({ levels: 3 });
    const legal = legalMoves(s);
    const text = positionPrompt(s, legal, []);
    expect(text).toContain('You are White');
    expect(text).toContain('upper level');
    expect(text).toMatch(/^Ng1: /m);
    expect(systemPrompt(s)).toContain('4D Chess');
    // compact enough to send every turn
    expect(text.length).toBeLessThan(20000);
  });
});
