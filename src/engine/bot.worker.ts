import { chooseMove, type BotLevel } from './bot';
import type { GameState } from './types';

self.onmessage = (e: MessageEvent<{ state: GameState; level: BotLevel; pace?: number; token: number }>) => {
  const { state, level, pace, token } = e.data;
  self.postMessage({ move: chooseMove(state, level, pace ?? 1), token });
};
