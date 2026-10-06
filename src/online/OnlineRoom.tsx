import { useEffect, useMemo, useState } from 'react';
import type { Color } from '../engine/types';
import { Game, type OnlineCtl } from '../ui/Game';
import type { GameConfig } from '../ui/Menu';
import { isStandard } from '../ui/settings';
import { savedName } from './config';
import { declineDraw, joinGame, offerDraw, rematch, sendMove, setResult, shareLink, watchGame, type OnlineGame } from './session';

interface Props {
  code: string;
  onLeave: () => void;
  onOpen: (code: string) => void;
  onRules: () => void;
}

/** Joins an online game by its code and keeps the board in sync with it. */
export function OnlineRoom({ code, onLeave, onOpen, onRules }: Props) {
  const [game, setGame] = useState<OnlineGame | null>(null);
  const [me, setMe] = useState<Color | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    joinGame(code, savedName() || 'Player 2')
      .then(({ me }) => {
        if (cancelled) return;
        setMe(me);
        stop = watchGame(code, setGame, (e) => setError(e.message));
      })
      .catch((e: Error) => !cancelled && setError(e.message === 'not-found' ? `There's no game with the code ${code}.` : e.message));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [code]);

  const config: GameConfig | null = useMemo(
    () =>
      game && me !== undefined
        ? {
            variant: game.variant,
            mode: 'online',
            human: me ?? 'w',
            level: 'medium',
            rules: game.rules,
            house: !isStandard(game.rules),
            clock: game.clock,
          }
        : null,
    // The settings of a game never change, so only rebuild when a different game loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game?.code, me],
  );

  if (error) {
    return (
      <div className="room-msg card">
        <h2>Can't open this game</h2>
        <p>{error}</p>
        <button className="primary" onClick={onLeave}>Back to the menu</button>
      </div>
    );
  }
  if (!game || !config) {
    return <div className="room-msg muted">Connecting to game {code}…</div>;
  }

  const ctl: OnlineCtl = {
    game,
    me: me ?? null,
    link: shareLink(code),
    send: (m, over) => {
      sendMove(game, m, over).catch((e: Error) => setError(`Your move didn't go through: ${e.message}`));
    },
    setResult: (r) => void setResult(code, r).catch(() => undefined),
    offerDraw: () => me && void offerDraw(code, me),
    answerDraw: (accept) => void (accept ? setResult(code, { winner: null, reason: 'Draw agreed' }) : declineDraw(code)),
    rematch: () => {
      rematch(game).then(onOpen, (e: Error) => setError(e.message));
    },
  };

  return <Game key={code} config={config} online={ctl} onMenu={onLeave} onRules={onRules} />;
}
