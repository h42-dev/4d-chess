export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/**
 * A real piece on the board.
 * `sq` = level * 64 + rank * 8 + file (a1 on the lowest level = 0). Time Travel Chess has one level;
 * 4D Chess has three, with the armies starting on the middle one.
 * `dt` is the piece's time relative to the present:
 *   0  → in the present
 *  <0  → in the past; the gap stays fixed as the game goes on
 *  >0  → in the future; it shrinks by 1 every turn until the piece arrives
 */
export interface Piece {
  id: number;
  type: PieceType;
  color: Color;
  sq: number;
  dt: number;
  moved: boolean;
}

export interface Move {
  pid: number;
  from: number;
  fromDt: number;
  to: number;
  toDt: number;
  /** id of the captured piece */
  capture?: number;
  promo?: PieceType;
  castle?: 'K' | 'Q';
  rookId?: number;
  ep?: boolean;
  /**
   * OG rules: this move captures a piece on a past board, erasing it from history from that turn
   * (the absolute turn number T) onward. `capture` holds the erased piece's id.
   */
  erase?: number;
}

export interface TimeEvent {
  /**
   * arrived: a future piece reached the present · lost: it landed on a taken square ·
   * returned: (OG rules) a past piece was pulled back to the present · erased: (OG rules) a piece
   * was removed from history
   */
  kind: 'arrived' | 'lost' | 'returned' | 'erased';
  type: PieceType;
  color: Color;
  sq: number;
}

/** The rules a game is played with. Standard rules can be changed in house rules mode. */
export interface Rules {
  /** how far each piece can travel back / forward in time in one move */
  ttl: Record<PieceType, { back: number; fwd: number }>;
  /** a piece's TTL also caps how far from the present it can ever be */
  horizon: boolean;
  /** pieces already in the future may jump even further ahead (off by default, so time catches up) */
  futureRunning: boolean;
  /** allow hopping exactly one turn ahead on your own square (effectively a pass) */
  allowPass: boolean;
  /** turns without a capture or pawn move before a draw; 0 = never */
  quietDraw: number;
  /** false = no time travel at all (plain chess, in 2D or 3D) */
  timeTravel: boolean;
  /**
   * snapshot: the past is history you can see but not touch (the main rules).
   * living: "OG rules": past boards are real. Pieces that travel back stay on that board, can
   * capture the pieces there (erasing them from history and replaying every move since), and are
   * pulled back to the present once they fall further behind than their time travel limit.
   */
  history: 'snapshot' | 'living';
  /**
   * OG rules: how many times each piece may erase a piece from history in one game. Counted per
   * piece; a promoted pawn keeps what it has used and takes its new type's limit.
   * (Missing in games saved before this rule existed: the standard limits apply.)
   */
  eraseLimit?: Record<PieceType, number>;
}

/** OG rules: a piece removed from history from turn `ply` onward. */
export interface Erasure {
  ply: number;
  id: number;
}

export interface Result {
  winner: Color | null;
  reason: string;
}

export interface GameState {
  /** spatial levels: 1 for Time Travel Chess, 3 for 4D Chess */
  levels: number;
  rules: Rules;
  /** turns played so far; white moves on even plies */
  ply: number;
  pieces: Piece[];
  /** snapshots[k] = the present board after k turns, 64 chars per level ('.' = empty, upper = white) */
  snapshots: string[];
  /** en-passant target square in the present layer, -1 if none */
  ep: number;
  /** turns since the last capture or pawn move */
  quiet: number;
  result: Result | null;
  /** the pieces at the start, so history can be replayed (OG rules) */
  initial: Piece[];
  /** every move played, in order (replayed when history is rewritten) */
  record: Move[];
  /** OG rules: pieces erased from history */
  erasures: Erasure[];
  /** OG rules: turns whose recorded move no longer happens in the rewritten history */
  voided: number[];
  /** snapIds[k][sq] = id of the piece on that square in snapshot k (0 = empty) */
  snapIds: number[][];
}
