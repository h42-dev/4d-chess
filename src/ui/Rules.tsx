import { STANDARD_ERASES, STANDARD_RULES } from '../engine/game';
import type { PieceType, Rules as RuleSet } from '../engine/types';
import { NAME } from './pieces';
import { Pc } from './Pc';

const ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

const MOVES_3D: Record<PieceType, string> = {
  k: 'One step in any of the 26 directions, including straight up/down and 3D diagonals.',
  r: 'Any distance along one axis: across files, along ranks, or straight up and down through the levels.',
  b: 'Any distance diagonally within any plane: the usual diagonals, plus diagonals that climb or drop a level each step. The square colours flip on each level, so a bishop always stays on its colour.',
  q: 'Everything the rook and bishop can do, plus the 3D diagonals (file, rank and level change together).',
  n: 'Two steps along one axis and one along another. Any two of file, rank and level.',
  p: 'One rank forward, optionally also up or down a level. Two straight ahead on its first move. Captures one rank forward and one file sideways, on its level or one up/down.',
};

export function Rules({ onClose, rules = STANDARD_RULES, house = false }: { onClose: () => void; rules?: RuleSet; house?: boolean }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal rules" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How to play">
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h2>How to play</h2>
        <p className="lede">
          There are two games. <b>Time Travel Chess</b> is normal chess plus a time dimension.{' '}
          <b>4D Chess</b> adds height too: three levels of board, plus time. Both use the same time rules.
        </p>

        <h3>Time travel limit (TTL){house && ' · house rules'}</h3>
        {rules.timeTravel ? (
          <>
            <p>
              Each piece can shift through time by up to its TTL in one move
              {rules.horizon ? ', and can never be further than that from the present' : ''}.
            </p>
            <div className="ttl-table">
              {ORDER.map((t) => (
                <div key={t} className="ttl-row">
                  <Pc type={t} color="w" />
                  <span>{NAME[t]}</span>
                  <span className="past">−{rules.ttl[t].back}</span>
                  <span className="future">+{rules.ttl[t].fwd}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>These house rules turn time travel off, so it's plain chess.</p>
        )}

        <h3>Moving through time</h3>
        <ul>
          <li>A move is a normal chess move <i>plus</i> an optional jump in time. A piece can also stay on its square and move only through time.</li>
          <li>Pieces travel through <b>their own time</b> first (blocked paths are blocked), then drop into the target time.</li>
          <li>One “turn” is one player's move. Time starts at T=0, so the first move can't go back.</li>
          <li>{rules.allowPass ? 'House rules allow passing: hopping one turn ahead on your own square.' : 'No passing: a piece can’t hop just one turn ahead on its own square.'}</li>
        </ul>

        <h3>The past</h3>
        {rules.history === 'living' ? (
          <ul>
            <li>Going back in time puts you on the <b>real board from then</b>. Go back to T=0 and every piece is in its starting position (on the middle level in 4D Chess).</li>
            <li>You can land on a past square if it was empty back then, or capture the piece that stood there (not a king).</li>
            <li>Capturing a piece on a past board <b>erases it from history</b> from that turn on. Every move since is replayed without it: it vanishes from the present, anything it captured later comes back, and moves that no longer make sense didn't happen (they're crossed out in the move list).</li>
            <li>Each piece can only erase so many times per game: <b>pawn 1, knight 3, bishop 3, rook 5, queen 5, king 8</b>{rules.eraseLimit && JSON.stringify(rules.eraseLimit) !== JSON.stringify(STANDARD_ERASES) ? ' (house rules may change these)' : ''}. Select a piece to see how many it has left. A pawn that promotes keeps its count and gets its new piece's limit.</li>
            <li>Clicking an enemy piece takes it normally, in its own time. To erase it from the past instead, use the <b>×</b> in the corner of its square, or open the board from back then.</li>
            <li>A piece that goes back <b>stays on that board</b>, so it falls one turn further behind each turn. Once it's further back than its time travel limit it's <b>pulled back</b> to the present on the same square, and lost if that square is taken.</li>
            <li>Pieces on past boards don't move or attack. Only pieces that travelled there can act.</li>
          </ul>
        ) : (
          <ul>
            <li>These are the <b>Simple rules</b>: the past is history you can look at but not touch. You can land on a past square only if it was empty back then; the pieces shown there just block it.</li>
            <li>A piece in the past stays the same number of turns behind the present.</li>
          </ul>
        )}

        <h3>The future</h3>
        <ul>
          <li>
            {rules.futureRunning
              ? 'House rules let a piece already in the future jump even further ahead.'
              : 'A piece already in the future can’t jump even further ahead. It can move in space or back toward now, so time always catches up with it, and you can trap a fleeing king by taking its landing square.'}
          </li>
          <li>A piece in the future gets one turn closer every turn. When time catches up it lands, unless anything is standing on its square. Then <b>it is lost</b>, and if it's your king, you lose.</li>
        </ul>

        <h3>Rule sets</h3>
        <p>
          <b>Realistic (OG rules)</b>, with living history, are the standard. Use the slider at the top of the menu to switch to{' '}
          <b>Simple</b>, an easier version where the past can be seen but not touched, or pick <b>House rules</b> to change any setting.
        </p>

        <h3>Capturing &amp; check</h3>
        <ul>
          <li>Capture by landing on a piece in its time. The time gap has to be within your TTL.</li>
          <li>Check, checkmate, castling, en passant and promotion all work as normal. Castling stays within one time and level; en passant happens only in the present.</li>
          <li>{rules.quietDraw ? `The game is drawn after ${rules.quietDraw} turns without a capture or pawn move.` : 'There is no quiet-turn draw in these house rules.'}</li>
        </ul>

        <h3>4D Chess: height</h3>
        <p>
          The board has three 8×8 levels: <b>↑ upper</b>, <b>• middle</b> and <b>↓ lower</b>. Both armies start on the middle level like normal
          chess; the other two begin empty. Squares on other levels are written with an arrow, so e4↑ is e4 on the upper level.
        </p>
        <div className="moves3d">
          {ORDER.map((t) => (
            <div key={t} className="move3d">
              <Pc type={t} color="w" />
              <span>
                <b>{NAME[t]}</b> {MOVES_3D[t]}
              </span>
            </div>
          ))}
        </div>

        <h3>Reading the board</h3>
        <div className="demo-row">
          <div className="demo">
            <div className="hero-sq">
              <span className="past"><Pc type="q" color="b" /></span>
              <span className="now"><Pc type="p" color="w" /></span>
            </div>
            <span>One square, two times. A black queen 2 turns in the past (left) and a white pawn now (right). Earlier is always on the left.</span>
          </div>
          <div className="demo">
            <div className="hero-sq single future-sq">
              <span><Pc type="k" color="w" /></span>
            </div>
            <span>A future-coloured square means the piece is in the future. Its badge (like +3) says how many turns until it lands.</span>
          </div>
        </div>
        <ul>
          <li>Click a piece, then a dot. <b className="now-text">Gold</b> lands now, <b className="past-text">past colour</b> in the past, <b className="future-text">future colour</b> in the future. A number on a dot means you'll pick when.</li>
          <li>Click a selected piece again to move it only through time. Clicking another of your pieces switches to it. To land on a square one of your pieces holds in a different time, click the small dot in that square's corner.</li>
          <li>The <b>time ribbon</b> lists every piece away from the present. Click a time to see the board then.</li>
          <li>In 4D Chess, the <b>level map</b> beside the board shows all three levels. Click one to bring it up on the big board. Its number shows how many moves your piece has there.</li>
          <li>Colours, piece style, hints, sounds and more are in <b>Settings</b> (⚙ at the top).</li>
        </ul>
      </div>
    </div>
  );
}
