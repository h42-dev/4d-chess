/** Tiny synthesized sound effects, so there are no audio files to load. */
export type Sfx = 'move' | 'capture' | 'past' | 'future' | 'check' | 'lost' | 'end';

let ctx: AudioContext | null = null;

function tone(freq: number, dur: number, opts: { type?: OscillatorType; to?: number; gain?: number; delay?: number } = {}) {
  if (!ctx) ctx = new AudioContext();
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.18, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function play(sfx: Sfx) {
  try {
    switch (sfx) {
      case 'move':
        tone(420, 0.07, { type: 'triangle', gain: 0.22 });
        break;
      case 'capture':
        tone(220, 0.12, { type: 'square', gain: 0.12 });
        tone(140, 0.16, { type: 'triangle', gain: 0.2, delay: 0.03 });
        break;
      case 'past':
        tone(900, 0.35, { to: 260, gain: 0.12 });
        break;
      case 'future':
        tone(260, 0.35, { to: 900, gain: 0.12 });
        break;
      case 'check':
        tone(740, 0.12, { type: 'square', gain: 0.08 });
        tone(740, 0.12, { type: 'square', gain: 0.08, delay: 0.16 });
        break;
      case 'lost':
        tone(500, 0.4, { to: 90, type: 'sawtooth', gain: 0.08 });
        break;
      case 'end':
        tone(523, 0.18, { gain: 0.15 });
        tone(659, 0.18, { gain: 0.15, delay: 0.16 });
        tone(784, 0.3, { gain: 0.15, delay: 0.32 });
        break;
    }
  } catch {
    // audio unavailable — stay silent
  }
}
