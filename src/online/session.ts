import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc, type Timestamp } from 'firebase/firestore';
import type { Color, Move, Result, Rules } from '../engine/types';
import type { Clock, Variant } from '../ui/Menu';
import { currentUser, firestore } from './firebase';

/** One online game, stored as a single Firestore document keyed by its share code. */
export interface OnlineGame {
  code: string;
  variant: Variant;
  rules: Rules;
  clock: Clock | null;
  white: string | null;
  black: string | null;
  names: { w: string; b: string };
  moves: Move[];
  /** time left for each side after the last move (ms), when there's a clock */
  times: { w: number; b: number };
  lastMoveAt: Timestamp | null;
  status: 'waiting' | 'active' | 'over';
  /** results that don't come from the board itself: resignation, timeout, agreed draw */
  result: Result | null;
  drawOffer: Color | null;
  /** code of the rematch game, once someone asks for one */
  rematch: string | null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const ref = (code: string) => doc(firestore(), 'games', code);
/** Firestore rejects `undefined`, which optional move fields use. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));


export const shareLink = (code: string) => `${location.origin}${location.pathname}?game=${code}`;

export interface NewGame {
  variant: Variant;
  rules: Rules;
  clock: Clock | null;
  color: Color;
  name: string;
}

export async function createGame(opts: NewGame): Promise<string> {
  const user = await currentUser();
  const start = opts.clock ? opts.clock.minutes * 60_000 : 0;
  for (;;) {
    const code = newCode();
    if ((await getDoc(ref(code))).exists()) continue;
    await setDoc(ref(code), {
      code,
      variant: opts.variant,
      rules: clean(opts.rules),
      clock: opts.clock,
      white: opts.color === 'w' ? user.uid : null,
      black: opts.color === 'b' ? user.uid : null,
      names: { w: opts.color === 'w' ? opts.name : '', b: opts.color === 'b' ? opts.name : '' },
      moves: [],
      times: { w: start, b: start },
      lastMoveAt: null,
      status: 'waiting',
      result: null,
      drawOffer: null,
      rematch: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return code;
  }
}

/**
 * Opens a game: if you're already in it you get your colour back, if a seat is free you take it,
 * otherwise you watch. Returns null as your colour when spectating.
 */
export async function joinGame(code: string, name: string): Promise<{ me: Color | null; uid: string }> {
  const user = await currentUser();
  return runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref(code));
    if (!snap.exists()) throw new Error('not-found');
    const g = snap.data() as OnlineGame;
    if (g.white === user.uid) return { me: 'w' as Color, uid: user.uid };
    if (g.black === user.uid) return { me: 'b' as Color, uid: user.uid };
    const seat: Color | null = g.white === null ? 'w' : g.black === null ? 'b' : null;
    if (!seat) return { me: null, uid: user.uid };
    tx.update(ref(code), {
      [seat === 'w' ? 'white' : 'black']: user.uid,
      names: { ...g.names, [seat]: name },
      status: 'active',
      updatedAt: serverTimestamp(),
    });
    return { me: seat, uid: user.uid };
  });
}

export function watchGame(code: string, onGame: (g: OnlineGame) => void, onError: (e: Error) => void) {
  return onSnapshot(
    ref(code),
    (snap) => {
      if (snap.exists()) onGame(snap.data({ serverTimestamps: 'estimate' }) as OnlineGame);
    },
    onError,
  );
}

/**
 * Adds a move. A plain update (not a transaction) so the move shows up instantly on this screen;
 * the security rules make sure it's your turn and that exactly one move is added.
 */
export async function sendMove(g: OnlineGame, move: Move, over: boolean) {
  const ply = g.moves.length;
  const mover: Color = ply % 2 === 0 ? 'w' : 'b';
  const times = { ...g.times };
  if (g.clock) {
    // The clock starts after White's first move, like over the board.
    if (ply >= 1 && g.lastMoveAt) times[mover] = Math.max(0, times[mover] - (Date.now() - g.lastMoveAt.toMillis()));
    times[mover] += g.clock.increment * 1000;
  }
  await updateDoc(ref(g.code), {
    moves: [...g.moves.map(clean), clean(move)],
    times,
    lastMoveAt: serverTimestamp(),
    drawOffer: null,
    ...(over ? { status: 'over' } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function setResult(code: string, result: Result) {
  await runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref(code));
    if (!snap.exists() || (snap.data() as OnlineGame).result) return;
    tx.update(ref(code), { result, status: 'over', drawOffer: null, updatedAt: serverTimestamp() });
  });
}

export const offerDraw = (code: string, by: Color) => updateDoc(ref(code), { drawOffer: by, updatedAt: serverTimestamp() });
export const declineDraw = (code: string) => updateDoc(ref(code), { drawOffer: null, updatedAt: serverTimestamp() });

/** Starts (or joins) a rematch with colours swapped. Returns the new game's code. */
export async function rematch(g: OnlineGame): Promise<string> {
  await currentUser();
  return runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref(g.code));
    const cur = snap.data() as OnlineGame;
    if (cur.rematch) return cur.rematch;
    const code = newCode();
    const start = cur.clock ? cur.clock.minutes * 60_000 : 0;
    tx.set(ref(code), {
      code,
      variant: cur.variant,
      rules: cur.rules,
      clock: cur.clock,
      white: cur.black,
      black: cur.white,
      names: { w: cur.names.b, b: cur.names.w },
      moves: [],
      times: { w: start, b: start },
      lastMoveAt: null,
      status: 'active',
      result: null,
      drawOffer: null,
      rematch: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(ref(g.code), { rematch: code, updatedAt: serverTimestamp() });
    return code;
  });
}
