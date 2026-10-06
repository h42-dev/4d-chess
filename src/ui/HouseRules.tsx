import { STANDARD_RULES } from '../engine/game';
import type { PieceType, Rules } from '../engine/types';
import { NAME } from './pieces';
import { Pc } from './Pc';

const ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

const mapTtl = (f: (t: PieceType, v: { back: number; fwd: number }) => { back: number; fwd: number }): Rules['ttl'] =>
  Object.fromEntries(ORDER.map((t) => [t, f(t, STANDARD_RULES.ttl[t])])) as Rules['ttl'];

const PRESETS: { name: string; note: string; rules: Rules }[] = [
  { name: 'Standard', note: 'The normal rules', rules: STANDARD_RULES },
  {
    name: 'Wild time',
    note: 'Every limit doubled',
    rules: { ...STANDARD_RULES, ttl: mapTtl((_, v) => ({ back: v.back * 2, fwd: v.fwd * 2 })) },
  },
  {
    name: 'Short hops',
    note: 'Everyone can travel 1–2 turns',
    rules: { ...STANDARD_RULES, ttl: mapTtl((t) => (t === 'k' || t === 'q' ? { back: 2, fwd: 2 } : { back: 1, fwd: 1 })) },
  },
  {
    name: 'Equal footing',
    note: 'Every piece gets 4 both ways',
    rules: { ...STANDARD_RULES, ttl: mapTtl(() => ({ back: 4, fwd: 4 })) },
  },
  { name: 'No time travel', note: 'Plain chess (or plain 3D chess)', rules: { ...STANDARD_RULES, timeTravel: false } },
];

const DRAWS = [0, 50, 100, 150, 200, 300];

function Stepper({ value, onChange, label, tone }: { value: number; onChange: (v: number) => void; label: string; tone: string }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(20, v)));
  return (
    <span className={`stepper ${tone}`} aria-label={label}>
      <button type="button" onClick={() => set(value - 1)} disabled={value <= 0} aria-label={`Less ${label}`}>−</button>
      <input
        type="number"
        min={0}
        max={20}
        value={value}
        onChange={(e) => set(Number(e.target.value) || 0)}
        aria-label={label}
      />
      <button type="button" onClick={() => set(value + 1)} disabled={value >= 20} aria-label={`More ${label}`}>+</button>
    </span>
  );
}

function Toggle({ on, onChange, title, note }: { on: boolean; onChange: (v: boolean) => void; title: string; note: string }) {
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

/** Edit the rules for a house-rules game. */
export function HouseRules({ value, onChange }: { value: Rules; onChange: (r: Rules) => void }) {
  const setTtl = (t: PieceType, side: 'back' | 'fwd', v: number) => onChange({ ...value, ttl: { ...value.ttl, [t]: { ...value.ttl[t], [side]: v } } });
  const active = PRESETS.find((p) => JSON.stringify(p.rules) === JSON.stringify(value));

  return (
    <div className="house">
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className={active?.name === p.name ? 'on' : ''} onClick={() => onChange(p.rules)} title={p.note}>
            {p.name}
          </button>
        ))}
      </div>

      <Toggle
        on={value.timeTravel}
        onChange={(v) => onChange({ ...value, timeTravel: v })}
        title="Time travel"
        note="Turn it off for chess without the time dimension"
      />

      <div className={`ttl-edit${value.timeTravel ? '' : ' off'}`}>
        <div className="ttl-edit-head">
          <span>Piece</span>
          <span className="past">Back in time</span>
          <span className="future">Forward in time</span>
        </div>
        {ORDER.map((t) => (
          <div key={t} className="ttl-edit-row">
            <span className="who">
              <Pc type={t} color="w" />
              {NAME[t]}
            </span>
            <Stepper value={value.ttl[t].back} onChange={(v) => setTtl(t, 'back', v)} label={`${NAME[t]} back`} tone="past" />
            <Stepper value={value.ttl[t].fwd} onChange={(v) => setTtl(t, 'fwd', v)} label={`${NAME[t]} forward`} tone="future" />
          </div>
        ))}
      </div>

      <Toggle
        on={value.horizon}
        onChange={(v) => onChange({ ...value, horizon: v })}
        title="Limits are also a horizon"
        note="A piece can never be further from the present than its limit"
      />
      <Toggle
        on={value.futureRunning}
        onChange={(v) => onChange({ ...value, futureRunning: v })}
        title="Future pieces can run further ahead"
        note="Off: once in the future a piece can't jump further ahead, so time catches up and kings can be trapped"
      />
      <Toggle
        on={value.allowPass}
        onChange={(v) => onChange({ ...value, allowPass: v })}
        title="Allow passing"
        note="Let a piece hop one turn ahead on its own square, which skips your turn"
      />
      <label className="toggle-row">
        <span>
          <b>Draw after quiet turns</b>
          <small>Turns without a capture or pawn move</small>
        </span>
        <select value={value.quietDraw} onChange={(e) => onChange({ ...value, quietDraw: Number(e.target.value) })}>
          {DRAWS.map((d) => (
            <option key={d} value={d}>{d === 0 ? 'Never' : d}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** One-line summary of how a rule set differs from the standard rules. */
export function rulesSummary(r: Rules): string {
  const bits: string[] = [];
  if (!r.timeTravel) bits.push('no time travel');
  else {
    const changed = ORDER.filter((t) => r.ttl[t].back !== STANDARD_RULES.ttl[t].back || r.ttl[t].fwd !== STANDARD_RULES.ttl[t].fwd);
    if (changed.length === ORDER.length) bits.push('custom time limits for every piece');
    else if (changed.length) bits.push(`custom limits for ${changed.map((t) => NAME[t].toLowerCase()).join(', ')}`);
    if (!r.horizon) bits.push('no horizon');
    if (r.futureRunning) bits.push('future pieces can run ahead');
    if (r.allowPass) bits.push('passing allowed');
  }
  if (r.quietDraw !== STANDARD_RULES.quietDraw) bits.push(r.quietDraw ? `draw after ${r.quietDraw} quiet turns` : 'no quiet-turn draw');
  return bits.length ? bits.join(' · ') : 'same as standard';
}
