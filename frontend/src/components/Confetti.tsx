/**
 * Success confetti. A fixed, deterministic scatter (no randomness, so the
 * markup is stable across renders and snapshots) in the Asasa palette. Purely
 * decorative and hidden from assistive tech.
 */
const PIECES: ReadonlyArray<{ x: number; y: number; r: number; w: number; h: number; c: string }> = [
  { x: 12, y: 26, r: -22, w: 4, h: 12, c: '#8CCB50' },
  { x: 44, y: 8, r: 34, w: 4, h: 10, c: '#0D4A46' },
  { x: 72, y: 44, r: -8, w: 5, h: 5, c: '#F0B429' },
  { x: 96, y: 16, r: 48, w: 4, h: 13, c: '#8CCB50' },
  { x: 128, y: 52, r: 12, w: 4, h: 4, c: '#0D4A46' },
  { x: 158, y: 6, r: -40, w: 4, h: 11, c: '#F0B429' },
  { x: 186, y: 34, r: 26, w: 4, h: 9, c: '#8CCB50' },
  { x: 214, y: 12, r: -14, w: 5, h: 5, c: '#0D4A46' },
  { x: 244, y: 48, r: 40, w: 4, h: 12, c: '#8CCB50' },
  { x: 272, y: 20, r: -30, w: 4, h: 10, c: '#F0B429' },
  { x: 300, y: 40, r: 18, w: 4, h: 4, c: '#0D4A46' },
  { x: 326, y: 10, r: -46, w: 4, h: 12, c: '#8CCB50' },
  { x: 352, y: 36, r: 22, w: 4, h: 9, c: '#F0B429' },
  { x: 24, y: 68, r: 14, w: 4, h: 4, c: '#0D4A46' },
  { x: 116, y: 88, r: -18, w: 4, h: 10, c: '#8CCB50' },
  { x: 206, y: 76, r: 30, w: 4, h: 4, c: '#F0B429' },
  { x: 292, y: 84, r: -24, w: 4, h: 11, c: '#8CCB50' },
  { x: 358, y: 70, r: 10, w: 4, h: 4, c: '#0D4A46' },
];

export function Confetti(): JSX.Element {
  return (
    <svg className="confetti" viewBox="0 0 390 170" aria-hidden="true" focusable="false">
      {PIECES.map((p, i) => (
        <rect
          key={i}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx={1.5}
          fill={p.c}
          opacity={0.85}
          transform={`rotate(${p.r} ${p.x + p.w / 2} ${p.y + p.h / 2})`}
        />
      ))}
    </svg>
  );
}
