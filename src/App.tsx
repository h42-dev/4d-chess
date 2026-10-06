import { lazy, Suspense, useEffect, useState } from 'react';
import { Game } from './ui/Game';
import { Menu, type GameConfig } from './ui/Menu';
import { Rules } from './ui/Rules';
import { loadSettings, saveSettings, SettingsContext, type Settings } from './ui/settings';
import { SettingsModal } from './ui/SettingsModal';

// Firebase is only loaded when someone actually plays online.
const OnlineRoom = lazy(() => import('./online/OnlineRoom').then((m) => ({ default: m.OnlineRoom })));

export default function App() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [rules, setRules] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // An online game is opened by its link: ?game=CODE
  const [room, setRoom] = useState<string | null>(() => new URLSearchParams(location.search).get('game'));

  const openRoom = (code: string | null) => {
    history.pushState(null, '', code ? `?game=${code}` : location.pathname);
    setRoom(code);
    setConfig(null);
  };
  useEffect(() => {
    const onPop = () => setRoom(new URLSearchParams(location.search).get('game'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Themes are applied as data attributes on <html>, which the stylesheet keys off.
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.board = settings.boardTheme;
    root.palette = settings.timePalette;
    root.pieces = settings.pieceStyle;
    root.motion = settings.animations ? 'on' : 'off';
    saveSettings(settings);
  }, [settings]);

  return (
    <SettingsContext.Provider value={settings}>
      <nav className="top">
        <button className="brand" onClick={() => (room ? openRoom(null) : setConfig(null))}>
          <span className="brand-mark" aria-hidden />
          {config ? (config.variant === '4d' ? '4D Chess' : 'Time Travel Chess') : '4D Chess'}
        </button>
        <div className="top-actions">
          <button className="link" onClick={() => setRules(true)}>Rules</button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </nav>
      {room ? (
        <Suspense fallback={<div className="room-msg muted">Connecting…</div>}>
          <OnlineRoom key={room} code={room} onLeave={() => openRoom(null)} onOpen={openRoom} onRules={() => setRules(true)} />
        </Suspense>
      ) : config ? (
        <Game key={gameKey} config={config} onMenu={() => setConfig(null)} onRules={() => setRules(true)} />
      ) : (
        <Menu
          onStart={(c) => {
            setConfig(c);
            setGameKey((k) => k + 1);
          }}
          onOnline={async (g) => {
            const { createGame } = await import('./online/session');
            openRoom(await createGame(g));
          }}
          onRules={() => setRules(true)}
        />
      )}
      {rules && <Rules onClose={() => setRules(false)} rules={config?.rules} house={config?.house} />}
      {settingsOpen && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
    </SettingsContext.Provider>
  );
}
