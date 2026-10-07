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

The time limits and future rules below apply to every rule set. How the **past** works is in "OG rules" further
down. **House rules** (in the menu) can change every time limit, switch between living and simple history, turn
time travel off, drop the horizon, allow passing and change the draw rule.

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
- **Time catches up:** a piece already in the future can't jump further ahead (only move in space or back
  toward now). Otherwise kings escape forever by hopping forward, since only queens can reach that far.
- **The future:** a future piece gets one turn closer every turn. When it reaches the present, it's lost if
  anything is on its square. If that's your king, you lose. Moves that would lose your own king this way are illegal.
- **Capturing** means landing on an enemy piece in its own time, so the time gap must be within your TTL.
- **Check** is any enemy piece being able to capture your king, from any time. Checkmate works as usual.
- **Castling** happens within one time. **En passant** works only in the present. **Promotion** works in any time.
- **Draws:** stalemate, only kings left, or 150 turns without a capture or pawn move.

## OG rules (the standard rules)

The original idea: **living history**. These are the default; pick **Simple** in the menu for the easier version
where the past can be seen but not touched (past pieces only block squares, and travellers keep a fixed gap).

- Going back in time puts you on the **real board from then**: back to T=0 and every piece is in its starting
  position (on the middle level in 4D Chess).
- A piece that goes back **stays on that board** (it falls one turn further behind each turn). Once it's further
  back than its time travel limit it's **pulled back** to the present on the same square, and lost if that square is taken.
- Capturing a piece on a past board (not a king) **erases it from history** from that turn on. The game replays every
  move since without it: it vanishes from the present, anything it captured later comes back, and moves that no
  longer make sense didn't happen (crossed out in the move list).
- Each piece may only erase a limited number of times per game: **pawn 1, knight 3, bishop 3, rook 5, queen 5,
  king 8** (changeable in house rules). Counts are per piece; a promoted pawn keeps its count and takes the new limit.
- Clicking an enemy piece takes it normally, in its own time; erasing its past self is a separate choice (the × in
  the corner of its square, or the board from back then).
- Pieces on past boards don't move or attack; only pieces that travelled there act.
- Engine: every game keeps its move record; an erasure replays it (`replay()` in `src/engine/game.ts`).

## 4D Chess: height

- Three 8×8 levels (lower, middle, upper). Both armies start like normal chess on the middle level.
- Squares on other levels are written with an arrow: `e4↑` is the upper level, `e4↓` the lower one.
- Rook: along any one axis (file, rank, or straight up/down). Bishop: diagonals in any plane (two axes at
  once). Queen: rook + bishop + the 3D diagonals. King: one step in any of 26 directions. Knight: 2 along
  one axis and 1 along another.
- Square colours flip on each level (as in 3D chess: colour follows file + rank + level), so a bishop always
  stays on its colour, even when it changes level.
- Pawn: one rank forward, optionally also up/down a level. Two straight ahead on its first move.
  Captures one rank forward and one file sideways, on its level or one up/down.
- Castling stays on one level. En passant only on one level, in the present. Promotion on the last rank of any level.

## Customisation

- **Settings (⚙):** board theme, piece style (solid / classic / letters), time colours (incl. colour-blind
  and high-contrast), coordinates, animations, move hints, sounds, bot thinking time, turning the board for pass & play.
- **Menu:** game, opponent, clock (3+2, 5+3, 10+5, 30+0) and house rules.

## AI players

Pick **AI** in the menu to play an AI of your choice (**You vs AI**) or to watch two AIs play each other
(**AI vs AI**, with pause/resume). Each side can be:

| Player | What you need |
| --- | --- |
| Built-in bot | Nothing (easy / medium / hard) |
| Claude (Anthropic) | An Anthropic API key. Default model `claude-opus-5-5`; also Sonnet 5.5, Haiku 4.5, Fable 5.1. "Thinking" sets the effort. |
| ChatGPT (OpenAI) | An OpenAI API key (default `gpt-6.1-sol`) |
| Gemini (Google) | A Google AI Studio key (default `gemini-3.8-flash`) |
| OpenRouter | One key for hundreds of models (use the id from openrouter.ai/models) |
| Local model | An OpenAI-compatible server such as Ollama (`http://localhost:11434/v1`) or LM Studio. Ollama needs `OLLAMA_ORIGINS` to include this site's address. |
| Your own bot | A URL that speaks the Bot API below |

- **Keys stay in the browser.** They're sent only to the provider you pick, never to this site's server, and are
  remembered on the device only if "Remember API keys" is ticked. Each AI move is one request billed to your key.
- Language models get the rules, an ASCII picture of every level, the pieces away from the present, recent
  moves and the full list of legal moves, and must answer `{"move", "comment"}` JSON. Their comment shows in the
  move log. An illegal answer gets one retry with feedback. If it fails again (or the API errors), the game
  pauses and offers **Try again** or **Let the built-in bot move**.
- Claude uses the official Anthropic SDK (loaded only when a Claude player is in the game) with structured outputs
  and server-side refusal fallbacks (`fallbacks: "default"`).
- **Find my models** asks the provider which models your key can use (Gemini, OpenAI, OpenRouter, local) and
  fills in the list, so you don't have to guess model ids. Providers retire models: e.g. Gemini 2.5 is now limited
  to older accounts, so new keys need a Gemini 3 model such as `gemini-3.8-flash`.
- **Busy or rate-limited providers** (429 / 5xx, e.g. free Gemini keys) are retried briefly inside the request,
  then the game counts down and tries again by itself (10s, 20s, 30s, 45s, 60s, or longer if the provider asks),
  with **Try now** / **Let the built-in bot move**. A used-up daily allowance is reported straight away.
- **Test connection** in the menu makes one request to check the key/URL/model before you start.

### Bot API (your own bot)

The game `POST`s JSON to your URL on each of your bot's turns:

```json
{
  "protocol": "4d-chess-bot/1",
  "variant": "time",            // or "4d"
  "you": "white",
  "turn": 12,
  "position": "…the same text description language models get…",
  "legalMoves": ["e2→e4", "Ng1→f3[t+2]", "Qd1×d7[t−1]", "…"],
  "history": ["e2→e4", "d7→d5[t+1]", "…"],
  "state": { "…": "the full engine state, if you want to compute yourself" }
}
```

Reply with one of the legal moves (or its index), plus an optional comment:

```json
{ "move": "Ng1→f3[t+2]", "comment": "Developing into the future." }
{ "index": 17 }
```

Your server must allow cross-origin requests (send `Access-Control-Allow-Origin: *` and answer `OPTIONS`).
A local bot at `http://localhost:…` works from the live site in Chrome.

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
- `src/ai/`: AI players: prompt + move matching, Claude (Anthropic SDK), OpenAI-compatible, Gemini and Bot API adapters
- `src/ui/`: React UI: board with split time squares, level map (4D), time ribbon, "when?" picker,
  3D stack view, menu, house rules editor, settings

## Roadmap

1. ✅ Engine + board UI + bot + pass & play
2. ✅ 4D Chess (height), house rules, settings, clocks
3. ✅ Online games with friends through share links (Firebase)
4. Tune the bot's time-travel play, piece art
