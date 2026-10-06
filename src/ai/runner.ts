import { legalMoves, moveText, sideToMove } from '../engine/game';
import type { GameState, Move } from '../engine/types';
import { askCustom, askGemini, askOpenAICompatible, type BotRequest } from './http';
import { matchMove, parseReply, positionPrompt, systemPrompt } from './prompt';
import { PROVIDERS, type AiPlayer } from './types';

export interface AiMove {
  move: Move;
  comment?: string;
  /** set when the AI needed a second try */
  note?: string;
}

/** The AI answered, but not with a legal move (even after a second chance). */
export class IllegalAnswerError extends Error {}

async function ask(player: AiPlayer, s: GameState, legal: Move[], history: string[], extra: string | undefined, signal: AbortSignal): Promise<string> {
  const system = systemPrompt(s);
  const user = positionPrompt(s, legal, history, extra);
  switch (player.provider) {
    case 'claude': {
      // Loaded on demand so people who never use Claude don't download the SDK.
      const { askClaude } = await import('./claude');
      return askClaude(player, system, user, signal);
    }
    case 'gemini':
      return askGemini(player, system, user, signal);
    case 'custom': {
      const req: BotRequest = {
        protocol: '4d-chess-bot/1',
        variant: s.levels > 1 ? '4d' : 'time',
        you: sideToMove(s) === 'w' ? 'white' : 'black',
        turn: s.ply,
        position: user,
        legalMoves: legal.map((m) => moveText(s, m)),
        history,
        state: s,
      };
      return askCustom(player, req, signal);
    }
    default:
      return askOpenAICompatible(player, system, user, signal);
  }
}

/** Asks a connected AI for its move in this position. Throws on network/API errors. */
export async function aiChooseMove(s: GameState, player: AiPlayer, history: string[], signal: AbortSignal): Promise<AiMove> {
  const info = PROVIDERS[player.provider];
  if (info.needsKey && !player.apiKey) throw new Error(`${info.label} needs an API key`);
  if (info.needsUrl && !player.baseUrl) throw new Error(`${info.label} needs a URL`);
  const legal = legalMoves(s);

  const first = await ask(player, s, legal, history, undefined, signal);
  const parsed = parseReply(first);
  const move = parsed && matchMove(s, legal, parsed.move);
  if (move) return { move, comment: parsed?.comment };

  // One more chance, telling it what went wrong.
  const said = parsed?.move ?? first.slice(0, 80);
  const retry = await ask(
    player,
    s,
    legal,
    history,
    `Your previous answer "${said}" was not one of the legal moves. Choose again, copying one move exactly from the list.`,
    signal,
  );
  const parsed2 = parseReply(retry);
  const move2 = parsed2 && matchMove(s, legal, parsed2.move);
  if (move2) return { move: move2, comment: parsed2?.comment, note: `First tried "${said}", which isn't legal` };
  throw new IllegalAnswerError(`answered "${parsed2?.move ?? retry.slice(0, 80)}", which isn't a legal move`);
}
