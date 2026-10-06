import { levelName, levelOf, sqName } from '../engine/game';
import type { Color, GameState, Move, PieceType } from '../engine/types';

/** Filled glyphs for both colours (styled by CSS); U+FE0E keeps iOS/macOS from drawing emoji. */
export const GLYPH: Record<PieceType, string> = {
  k: '♚︎',
  q: '♛︎',
  r: '♜︎',
  b: '♝︎',
  n: '♞︎',
  p: '♟︎',
};

export const NAME: Record<PieceType, string> = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

export const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black');

/** Decodes a snapshot character into a piece type and colour. */
export function fromChar(ch: string): { type: PieceType; color: Color } | null {
  if (ch === '.') return null;
  const lower = ch.toLowerCase() as PieceType;
  return { type: lower, color: ch === lower ? 'b' : 'w' };
}

/** 'past' | 'now' | 'future' — used as a CSS class everywhere time is shown. */
export const era = (dt: number) => (dt < 0 ? 'past' : dt > 0 ? 'future' : 'now');

/** Short relative label: −2, Now, +3 */
export const rel = (dt: number) => (dt === 0 ? 'Now' : dt < 0 ? `−${-dt}` : `+${dt}`);

const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;

/** Relative time in words: "2 turns ago", "now", "in 3 turns" */
export const relWords = (dt: number) => (dt === 0 ? 'now' : dt < 0 ? `${turns(-dt)} ago` : `in ${turns(dt)}`);

/** A move in plain English, for the move log. */
export function describeMove(s: GameState, m: Move): string {
  const p = s.pieces.find((x) => x.id === m.pid)!;
  const who = `${colorName(p.color)} ${NAME[p.type].toLowerCase()}`;
  const shift = m.toDt - m.fromDt;
  const travel =
    shift === 0 ? '' : shift < 0 ? `${turns(-shift)} back in time` : `${turns(shift)} forward in time`;
  const name = (sq: number) => sqName(sq, s.levels);
  const dz = levelOf(m.to) - levelOf(m.from);
  const climb = dz === 0 ? '' : ` ${dz > 0 ? 'up' : 'down'} to the ${levelName(levelOf(m.to), s.levels)} level`;
  let text: string;
  if (m.castle) {
    text = `${colorName(p.color)} castled ${m.castle === 'K' ? 'kingside' : 'queenside'}`;
  } else if (m.from === m.to) {
    text = `${who} on ${name(m.from)} went ${travel}`;
  } else {
    text = `${who} ${name(m.from)} → ${name(m.to)}${climb}${travel ? `, ${travel}` : ''}`;
  }
  if (m.erase !== undefined) {
    const h = fromChar(s.snapshots[m.erase]?.[m.to] ?? '.');
    if (h) text += ` and erased the ${colorName(h.color).toLowerCase()} ${NAME[h.type].toLowerCase()} from history (T=${m.erase} onward)`;
  } else {
    const victim = m.capture !== undefined ? s.pieces.find((x) => x.id === m.capture) : undefined;
    if (victim) text += ` and took the ${colorName(victim.color).toLowerCase()} ${NAME[victim.type].toLowerCase()}`;
  }
  if (m.promo) text += `, promoting to a ${NAME[m.promo].toLowerCase()}`;
  return text;
}

/** The square shown at a given screen row/column. */
export const squareAt = (row: number, col: number, flipped: boolean) => {
  const rank = flipped ? row : 7 - row;
  const file = flipped ? 7 - col : col;
  return rank * 8 + file;
};
