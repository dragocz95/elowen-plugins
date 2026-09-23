import type { ChatbotAppearance } from '../src/appearanceContract.js';

type Tone = ChatbotAppearance['sound']['tone'];
let context: AudioContext | null = null;

/** Unlock audio only after a visitor gesture. Browsers reject audio started by page scripts. */
export async function unlockSound(): Promise<void> {
  if (typeof window.AudioContext !== 'function') return;
  context ??= new AudioContext();
  if (context.state === 'suspended') await context.resume();
}

export function playTone(tone: Tone, volume: number): void {
  if (tone === 'none' || volume === 0 || context === null || context.state !== 'running') return;
  const notes: Record<Exclude<Tone, 'none'>, number[]> = {
    drop: [660, 440], chime: [523, 784], pop: [560], bell: [784, 1046, 784],
  };
  const now = context.currentTime;
  notes[tone].forEach((frequency, index) => {
    const oscillator = context!.createOscillator();
    const envelope = context!.createGain();
    const start = now + index * .095;
    oscillator.type = tone === 'pop' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume / 100 * .13, start + .015);
    envelope.gain.exponentialRampToValueAtTime(.001, start + .22);
    oscillator.connect(envelope);
    envelope.connect(context!.destination);
    oscillator.start(start);
    oscillator.stop(start + .23);
  });
}
