import { inCheck, levelName, moveText, sideToMove, sqName } from '../engine/game';
import type { Color, GameState, Move, PieceType } from '../engine/types';

const NAMES: Record<PieceType, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const colorWord = (c: Color) => (c === 'w' ? 'White' : 'Black');

/** The rules, written for a language model. Depends only on the game's settings, so it's stable across a game. */
export function systemPrompt(s: GameState): string {
  const r = s.rules;
  const ttl = ORDER.map((t) => `${NAMES[t]} −${r.ttl[t].back}/+${r.ttl[t].fwd}`).join(', ');
  const rules: (string | false)[] = [
    '- Normal chess rules apply (check, checkmate, castling, en passant, promotion), plus a time dimension.',
    '- Every turn (one player’s move) the game snapshots the present board. Time T counts turns; the present is "now".',
  ];
  if (r.timeTravel) {
    rules.push(
      `- A move is a normal chess move plus an optional jump in time, within the piece’s time travel limit (back/forward): ${ttl}.`,
      r.horizon && '- A piece can never be further from the present than its limit.',
      !r.futureRunning && '- A piece already in the future cannot jump further into the future.',
      '- A piece can also stay on its square and move only through time.',
      '- Sliding pieces travel through their own time first (blocked paths are blocked), then drop into the target time.',
      '- You can land on a past square only if it was empty back then. A piece in the past stays the same number of turns behind the present.',
      '- A piece in the future gets one turn closer every turn. When it reaches the present it lands, but if any piece is standing on its square it is destroyed. If that is your king, you lose.',
      '- Two pieces can share a square if they are in different times. You capture by landing on an enemy piece in its own time, within your time travel limit.',
      '- Check comes from any piece, in any time, that could capture the king.',
    );
    if (r.history === 'living') {
      rules.push(
        '- OG RULES (living history): past boards are real. Going back to turn T puts your piece on the board exactly as it was at T (at T=0, the starting position). A piece that goes back stays on that board, so it falls one turn further behind every turn, and it is pulled back to the present (same square) once it is further back than its back limit; if that square is taken it is lost.',
        '- On a past board you can capture the pieces that stood there (except kings). That erases the piece from history from that turn on, and every move since is replayed without it, so it disappears from the present and anything it captured later comes back. Captures like this are marked with × in the move list.',
        '- Each piece may erase only a limited number of times per game (standard: pawn 1, knight 3, bishop 3, rook 5, queen 5, king 8). The legal move list already leaves out erasures a piece has no allowance left for.',
      );
    }
  } else {
    rules.push('- House rules: time travel is switched off.');
  }
  if (s.levels > 1) {
    rules.push(
      '- Height: the board has lower, middle and upper levels. Both armies start on the middle level. Squares on the upper level are written with ↑ (e4↑), the lower level with ↓ (e4↓), the middle level plain (e4).',
      '- Rooks move along any one axis (including straight up/down), bishops diagonally in any plane, queens also along 3D diagonals, kings one step in any of 26 directions, knights 2 along one axis and 1 along another. Pawns step forward one rank (optionally also up/down a level) and capture one rank forward and one file sideways, on the same level or one up/down.',
    );
  }
  return [
    `You are playing ${s.levels > 1 ? '4D Chess (an 8×8 board with 3 levels of height, plus time)' : 'Time Travel Chess (normal 8×8 chess plus time)'}.`,
    '',
    'Rules:',
    ...rules.filter((l): l is string => !!l),
    '',
    'Move notation: piece letter (none for pawns) + from-square + optional [t−n]/[t+n] for its time, then → (move) or × (capture), then the to-square + optional time. Example: Qd1→d4[t−2] moves the queen from d1 (now) to d4 two turns in the past.',
    '',
    'You will get the position and the list of every legal move. Pick the strongest one. Think about material, king safety, threats across time, and pieces that will land soon.',
    'Answer with JSON only: {"move": "<one legal move, written exactly as in the list>", "comment": "<one short sentence explaining your idea>"}',
  ].join('\n');
}

function boardText(s: GameState, z: number): string {
  const snap = s.snapshots[s.ply];
  const rows = ['    a b c d e f g h'];
  for (let r = 7; r >= 0; r--) {
    let row = ` ${r + 1}  `;
    for (let f = 0; f < 8; f++) row += snap[z * 64 + r * 8 + f] + ' ';
    rows.push(row.trimEnd());
  }
  return rows.join('\n');
}

/** The current position and legal moves, written for a language model. */
export function positionPrompt(s: GameState, legal: Move[], history: string[], extra?: string): string {
  const me = sideToMove(s);
  const out: string[] = [];
  out.push(`You are ${colorWord(me)}. It is turn T=${s.ply}.`);
  if (inCheck(s, me)) out.push(`You are in CHECK. You must get your king out of check.`);

  out.push('', 'The present board (uppercase = White, lowercase = Black, . = empty; K king, Q queen, R rook, B bishop, N knight, P pawn):');
  if (s.levels > 1) {
    for (let z = s.levels - 1; z >= 0; z--) out.push('', `${levelName(z, s.levels)} level:`, boardText(s, z));
  } else {
    out.push(boardText(s, 0));
  }

  const travellers = s.pieces.filter((p) => p.dt !== 0);
  if (travellers.length) {
    out.push('', 'Pieces away from the present:');
    for (const p of travellers) {
      out.push(
        `- ${colorWord(p.color)} ${NAMES[p.type]} on ${sqName(p.sq, s.levels)}, ${p.dt < 0 ? `${-p.dt} turn${p.dt === -1 ? '' : 's'} in the past` : `in the future, lands in ${p.dt} turn${p.dt === 1 ? '' : 's'}`}`,
      );
    }
  }

  const t = (c: Color) =>
    ORDER.map((type) => {
      const n = s.pieces.filter((p) => p.color === c && p.type === type).length;
      return n ? `${n} ${NAMES[type]}${n > 1 ? 's' : ''}` : '';
    })
      .filter(Boolean)
      .join(', ');
  out.push('', `Material: White has ${t('w')}. Black has ${t('b')}.`);

  if (history.length) {
    out.push('', `Recent moves (oldest first):`, ...history.slice(-8).map((h) => `- ${h}`));
  }

  // Legal moves, grouped by the piece that moves to keep the list compact.
  const groups = new Map<string, string[]>();
  for (const m of legal) {
    if (m.promo && m.promo !== 'q' && m.promo !== 'n') continue; // queen or knight promotions are plenty
    const text = moveText(s, m);
    const i = m.castle ? -1 : Math.max(text.indexOf('→'), text.indexOf('×'));
    const head = i < 0 ? 'Castling' : text.slice(0, i);
    const tail = i < 0 ? text : text.slice(i);
    if (!groups.has(head)) groups.set(head, []);
    groups.get(head)!.push(tail);
  }
  out.push('', `Legal moves (${legal.length}). Each line is a piece followed by its options; join the piece and one option to write a move, e.g. ${exampleMove(s, legal)}:`);
  for (const [head, tails] of groups) out.push(`${head}: ${tails.join(' ')}`);

  if (extra) out.push('', extra);
  out.push('', 'Reply with JSON only: {"move": "...", "comment": "..."}');
  return out.join('\n');
}

function exampleMove(s: GameState, legal: Move[]) {
  const m = legal.find((x) => !x.castle && x.toDt !== x.fromDt) ?? legal[0];
  return m ? moveText(s, m) : 'e2→e4';
}

// ---------------------------------------------------------------------------
// Reading the answer

const norm = (t: string) =>
  t
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/→|->|⟶|=>/g, '>')
    .replace(/×/g, '>')
    .replace(/([1-8][↑↓]?(?:\[[^\]]*\])?)x(?=[a-h][1-8])/g, '$1>')
    .replace(/([1-8][↑↓]?(?:\[[^\]]*\])?)-(?=[a-h][1-8])/g, '$1>')
    .replace(/\[(?:now|t0|t\+0|t-0)\]/gi, '')
    .replace(/0-0-0/g, 'O-O-O')
    .replace(/0-0/g, 'O-O');

/** Pulls {"move": ..., "comment": ...} out of a model's reply, tolerating extra text around it. */
export function parseReply(text: string): { move: string; comment?: string } | null {
  const tryJson = (raw: string) => {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o.move === 'string') return { move: o.move, comment: typeof o.comment === 'string' ? o.comment : undefined };
    } catch {
      /* not JSON */
    }
    return null;
  };
  const direct = tryJson(text.trim());
  if (direct) return direct;
  const fenced = text.match(/\{[\s\S]*\}/);
  if (fenced) {
    const j = tryJson(fenced[0]);
    if (j) return j;
  }
  const m = text.match(/"move"\s*:\s*"([^"]+)"/);
  return m ? { move: m[1] } : null;
}

/** Finds the legal move a model meant, or null. */
export function matchMove(s: GameState, legal: Move[], answer: string): Move | null {
  const want = norm(answer);
  const exact = legal.filter((m) => norm(moveText(s, m)) === want);
  if (exact.length) return exact.find((m) => !m.promo || m.promo === 'q') ?? exact[0];
  // Promotions written without the piece: default to a queen.
  const promo = legal.find((m) => m.promo === 'q' && norm(moveText(s, m)).replace(/=Q$/, '') === want);
  return promo ?? null;
}
