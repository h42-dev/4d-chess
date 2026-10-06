# 4D Chess

Two games in one:

- **Time Travel Chess**: the normal 8×8 board plus time (3 dimensions).
- **4D Chess**: an 8×8 board with 3 levels of height, plus time (4 dimensions).

Pieces can jump into the past or the future, and two pieces can share a square as long as they're in
different times.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # rules engine tests
```

## Rules as implemented

These are the standard rules. **House rules** (in the menu) can change every time limit, turn time travel
off, drop the horizon, allow passing and change the draw rule.

| Piece  | TTL back | TTL forward |
| ------ | -------- | ----------- |
| King   | 5        | 10          |
| Queen  | 9        | 9           |
| Rook   | 5        | 5           |
| Bishop | 3        | 3           |
| Knight | 3        | 3           |
| Pawn   | 1        | 1           |

- **A turn = one player's move.** A snapshot of the present board is taken after every turn. Time starts at
  T=0, so the first move can't go back in time. After it, T=1 and T=0 can be visited.
- **No passing.** A piece can't jump exactly one turn ahead on its own square (from the present or the future).
  The board would be unchanged once time moves on.
- **A move** is a normal chess move plus an optional time shift within the piece's TTL. A piece can also stay
  on its square and move only through time ("straight down through time").
- **Paths are checked in the piece's own time.** It slides through its own time, then drops into the target
  time. So a queen on d8 with d7/d6 empty now can land on d5 two turns ago, even if d7 was occupied back then.
- **TTL is also a horizon.** A piece can never be further from the present than its TTL. Without this, a king
  could keep hopping further into the future and never be reachable. (`TTL_IS_HORIZON` in `src/engine/game.ts`.)
- **The past:** you can land on a past square only if it was empty in that turn's snapshot. A piece in the past
  keeps the same gap behind the present as the game goes on.
- **Time catches up:** a piece already in the future can't jump further ahead (only move in space or back
  toward now). Otherwise kings escape forever by hopping forward, since only queens can reach that far.
- **The future:** a future piece gets one turn closer every turn. When it reaches the present, it's lost if
  anything is on its square. If that's your king, you lose. Moves that would lose your own king this way are illegal.
- **Capturing** means landing on an enemy piece in its own time, so the time gap must be within your TTL.
- **Check** is any enemy piece being able to capture your king, from any time. Checkmate works as usual.
- **Castling** happens within one time. **En passant** works only in the present. **Promotion** works in any time.
- **Draws:** stalemate, only kings left, or 150 turns without a capture or pawn move.

## 4D Chess: height

- Three 8×8 levels (lower, middle, upper). Both armies start like normal chess on the middle level.
- Squares on other levels are written with an arrow: `e4↑` is the upper level, `e4↓` the lower one.
- Rook: along any one axis (file, rank, or straight up/down). Bishop: diagonals in any plane (two axes at
  once). Queen: rook + bishop + the 3D diagonals. King: one step in any of 26 directions. Knight: 2 along
  one axis and 1 along another.
- Pawn: one rank forward, optionally also up/down a level. Two straight ahead on its first move.
  Captures one rank forward and one file sideways, on its level or one up/down.
- Castling stays on one level. En passant only on one level, in the present. Promotion on the last rank of any level.

## Customisation

- **Settings (⚙):** board theme, piece style (solid / classic / letters), time colours (incl. colour-blind
  and high-contrast), coordinates, animations, move hints, sounds, bot thinking time, turning the board for pass & play.
- **Menu:** game, opponent, clock (3+2, 5+3, 10+5, 30+0) and house rules.

## Online play

Pick **Online** in the menu. You get a link (`?game=CODE`) to send a friend, and the game starts when they open it.
Moves sync live through Firebase (Firestore + anonymous sign-in). Clocks, draw offers, resigning, rematches
(colours swapped) and spectators (a third person with the link) all work. Reopening the link in the same
browser puts you back in your seat.

- `firestore.rules`: only the two players can change a game, a seat can only be taken while empty, and a
  move can only be added by the side to move, one at a time. Both apps also replay every move through
  the rules engine and ignore anything illegal.
- Local testing without a Firebase project: `npm run emulators` (needs Java) and `npm run dev:online`, then
  open `http://localhost:5189` and `http://127.0.0.1:5189` as the two players (different addresses give
  different anonymous users).

### Live site

**https://four-d-chess.web.app**, hosted in the Firebase project `paytowingame-a2b6f` (shared with Pay to
Win because the Google account hit its project quota). 4D Chess has its own hosting site (`four-d-chess`)
and the project's Firestore database; Pay to Win only uses the Realtime Database and its own site.

- Config lives in `.env.local` (git-ignored); `.env.example` lists the keys.
- **Every push to `main` deploys automatically** (GitHub Actions: tests → build → Firebase Hosting).
  Pull requests get a temporary preview link. The build reads the Firebase web config from the repo's
  Actions variables, and deploys with the `FIREBASE_SERVICE_ACCOUNT_PAYTOWINGAME_A2B6F` secret.
- Manual deploy: `npm run deploy` (builds, then deploys the `four-d-chess` site + Firestore rules). Firestore
  rule changes still need this, since the GitHub deploy account can only publish the site.

## Layout

- `src/engine/game.ts`: rules engine (move generation, time travel, arrivals, check, notation)
- `src/engine/bot.ts`: alpha-beta bot; runs in a Web Worker (`bot.worker.ts`)
- `src/ui/`: React UI: board with split time squares, level map (4D), time ribbon, "when?" picker,
  3D stack view, menu, house rules editor, settings

## Roadmap

1. ✅ Engine + board UI + bot + pass & play
2. ✅ 4D Chess (height), house rules, settings, clocks
3. ✅ Online games with friends through share links (Firebase)
4. Tune the bot's time-travel play, piece art
