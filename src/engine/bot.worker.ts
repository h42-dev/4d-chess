import { chooseMove, type BotLevel } from './bot';
import { legalMoves } from './game';
import type { GameState } from './types';

self.onmessage = (e: MessageEvent<{ state: GameState; level: BotLevel; pace?: number; token: number }>) => {
  const { state, level, pace, token } = e.data;
  let move;
  try {
    move = chooseMove(state, level, pace ?? 1);
  } catch (err) {
    // Never leave the game hanging: if the search ever breaks, play any legal move instead.
    console.error('Bot search failed, playing a fallback move', err);
    const legal = legalMoves(state);
    move = legal[Math.floor(Math.random() * legal.length)] ?? null;
  }
  self.postMessage({ move, token });
};
