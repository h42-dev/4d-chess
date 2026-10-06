import type { Color, PieceType } from '../engine/types';
import { GLYPH, NAME } from './pieces';
import { useSettings } from './settings';

const OUTLINE: Record<PieceType, string> = {
  k: '♔︎',
  q: '♕︎',
  r: '♖︎',
  b: '♗︎',
  n: '♘︎',
  p: '♙︎',
};

const LETTER: Record<PieceType, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' };

/** One chess piece, drawn in whichever piece style the player picked. */
export function Pc({ type, color, className = '' }: { type: PieceType; color: Color; className?: string }) {
  const { pieceStyle } = useSettings();
  const cls = `piece ${color} ${pieceStyle} ${className}`;
  if (pieceStyle === 'letters') {
    return (
      <span className={cls} aria-label={NAME[type]}>
        <span className="disc">{LETTER[type]}</span>
      </span>
    );
  }
  if (pieceStyle === 'classic') {
    // A filled body with the outline glyph drawn over it, like a printed chess diagram.
    return (
      <span className={cls} aria-label={NAME[type]}>
        <span className="fill">{GLYPH[type]}</span>
        <span className="line">{OUTLINE[type]}</span>
      </span>
    );
  }
  return <span className={cls} aria-label={NAME[type]}>{GLYPH[type]}</span>;
}
