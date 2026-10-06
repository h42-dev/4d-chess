import { useState, type ReactNode } from 'react';
import { Pc } from './Pc';
import { DEFAULT_SETTINGS, SettingsContext, useSettings, type BoardTheme, type PieceStyle, type Settings, type TimePalette } from './settings';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

const BOARDS: { id: BoardTheme; name: string }[] = [
  { id: 'wood', name: 'Wood' },
  { id: 'tournament', name: 'Tournament' },
  { id: 'slate', name: 'Slate' },
  { id: 'marble', name: 'Marble' },
  { id: 'midnight', name: 'Midnight' },
];

const PIECES: { id: PieceStyle; name: string }[] = [
  { id: 'solid', name: 'Solid' },
  { id: 'classic', name: 'Classic' },
  { id: 'letters', name: 'Letters' },
];

const PALETTES: { id: TimePalette; name: string; note: string }[] = [
  { id: 'violet', name: 'Violet & cyan', note: 'Default' },
  { id: 'colorblind', name: 'Blue & orange', note: 'Colour-blind friendly' },
  { id: 'neon', name: 'Neon', note: 'High contrast' },
];

const PACES = [
  { v: 0.5, name: 'Quick' },
  { v: 1, name: 'Normal' },
  { v: 2, name: 'Slow & strong' },
];

function Switch({ on, onChange, title, note }: { on: boolean; onChange: (v: boolean) => void; title: string; note: string }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{title}</b>
        <small>{note}</small>
      </span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <i />
      </button>
    </label>
  );
}

export function SettingsModal({ settings, onChange, onClose }: Props) {
  const [tab, setTab] = useState<'look' | 'game'>('look');
  const set = (p: Partial<Settings>) => onChange({ ...settings, ...p });

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h2>Settings</h2>
        <div className="seg tabs">
          <button className={tab === 'look' ? 'on' : ''} onClick={() => setTab('look')}>Look &amp; feel</button>
          <button className={tab === 'game' ? 'on' : ''} onClick={() => setTab('game')}>Game options</button>
        </div>

        {tab === 'look' ? (
          <>
            <h3>Board</h3>
            <div className="swatches">
              {BOARDS.map((b) => (
                <button key={b.id} className={`swatch${settings.boardTheme === b.id ? ' on' : ''}`} data-board-preview={b.id} onClick={() => set({ boardTheme: b.id })}>
                  <span className="sw-board">
                    <i /><i /><i /><i />
                  </span>
                  {b.name}
                </button>
              ))}
            </div>

            <h3>Pieces</h3>
            <div className="swatches">
              {PIECES.map((p) => (
                <button key={p.id} className={`swatch${settings.pieceStyle === p.id ? ' on' : ''}`} onClick={() => set({ pieceStyle: p.id })}>
                  <span className="sw-pieces">
                    <PreviewPieces style={p.id} />
                  </span>
                  {p.name}
                </button>
              ))}
            </div>

            <h3>Time colours</h3>
            <div className="swatches">
              {PALETTES.map((p) => (
                <button key={p.id} className={`swatch${settings.timePalette === p.id ? ' on' : ''}`} data-palette-preview={p.id} onClick={() => set({ timePalette: p.id })}>
                  <span className="sw-time">
                    <i className="past" />
                    <i className="now" />
                    <i className="future" />
                  </span>
                  {p.name}
                  <small>{p.note}</small>
                </button>
              ))}
            </div>

            <Switch on={settings.coords} onChange={(v) => set({ coords: v })} title="Coordinates" note="Letters and numbers along the board edge" />
            <Switch on={settings.animations} onChange={(v) => set({ animations: v })} title="Animations" note="Pieces pop in and time travel swirls" />
          </>
        ) : (
          <>
            <Switch on={settings.hints} onChange={(v) => set({ hints: v })} title="Move hints" note="Dots showing where the selected piece can go" />
            <Switch on={settings.sound} onChange={(v) => set({ sound: v })} title="Sound effects" note="Moves, captures, time travel and check" />
            <Switch on={settings.autoFlip} onChange={(v) => set({ autoFlip: v })} title="Turn the board each move" note="Pass & play: the board faces whoever is moving" />
            <div className="toggle-row">
              <span>
                <b>Bot thinking time</b>
                <small>Longer means stronger, especially on Hard</small>
              </span>
              <div className="seg">
                {PACES.map((p) => (
                  <button key={p.v} className={settings.botPace === p.v ? 'on' : ''} onClick={() => set({ botPace: p.v })}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="settings-foot">
          <button className="link" onClick={() => onChange(DEFAULT_SETTINGS)}>Reset to defaults</button>
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** The piece previews render with the style being previewed, not the current one. */
function PreviewPieces({ style }: { style: PieceStyle }) {
  return (
    <span className={`preview-style ${style}`}>
      <StyleScope style={style}>
        <Pc type="k" color="w" />
        <Pc type="n" color="b" />
      </StyleScope>
    </span>
  );
}

function StyleScope({ style, children }: { style: PieceStyle; children: ReactNode }) {
  const s = useSettings();
  return <SettingsContext.Provider value={{ ...s, pieceStyle: style }}>{children}</SettingsContext.Provider>;
}
