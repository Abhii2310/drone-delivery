import type { Profile } from '../lib/profile'

const W = 332
const H = 108
const PAD_L = 26
const PAD_B = 14

const KIND_TONE: Record<string, string> = {
  NO_FLY: 'var(--critical)',
  HOSPITAL: 'var(--nominal)',
  EMERGENCY: 'var(--emergency)',
}

export default function AltitudeProfile({ profile, along, alt }: { profile: Profile; along: number; alt: number }) {
  if (profile.totalM === 0) return null
  const ceilings = profile.bands.map((b) => b.ceiling)
  const top = Math.max(160, alt + 40, ...ceilings.map((c) => c + 20))
  const x = (d: number) => PAD_L + (d / profile.totalM) * (W - PAD_L - 6)
  const y = (a: number) => H - PAD_B - (a / top) * (H - PAD_B - 8)

  const path = profile.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.d).toFixed(1)},${y(p.alt).toFixed(1)}`).join(' ')
  const ticks = [0, Math.round(top / 2), Math.round(top)]

  return (
    <svg width={W} height={H} role="img" aria-label="Altitude profile along the route">
      <rect x={PAD_L} y={4} width={W - PAD_L - 6} height={H - PAD_B - 4} fill="none" stroke="var(--rule-soft)" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_L} y1={y(t)} x2={W - 6} y2={y(t)} stroke="var(--rule-soft)" strokeDasharray="2 4" />
          <text x={0} y={y(t) + 3} className="t-mono-sm" fill="var(--muted)">
            {t}
          </text>
        </g>
      ))}

      {/* every zone the route crosses, drawn as its ceiling with the restricted air above it */}
      {profile.bands.map((b, i) => {
        const tone = KIND_TONE[b.kind] ?? 'var(--advisory)'
        return (
          <g key={`${b.zoneId}-${i}`}>
            <rect x={x(b.fromM)} y={4} width={Math.max(1, x(b.toM) - x(b.fromM))} height={Math.max(0, y(b.ceiling) - 4)} fill={tone} opacity={0.12} />
            <line x1={x(b.fromM)} y1={y(b.ceiling)} x2={x(b.toM)} y2={y(b.ceiling)} stroke={tone} strokeWidth={1.5} />
            <text x={x(b.fromM) + 3} y={y(b.ceiling) - 3} className="t-mono-sm" fill={tone}>
              {b.zoneId} {b.ceiling}m
            </text>
          </g>
        )
      })}

      <path d={path} fill="none" stroke="var(--nominal)" strokeWidth={1.5} />

      <g>
        <line x1={x(along)} y1={4} x2={x(along)} y2={H - PAD_B} stroke="var(--paper)" strokeDasharray="2 3" opacity={0.5} />
        <circle cx={x(along)} cy={y(alt)} r={3.5} fill="var(--paper)" />
        <text x={Math.min(x(along) + 5, W - 40)} y={y(alt) - 6} className="t-mono-sm" fill="var(--paper)">
          {alt.toFixed(0)}m
        </text>
      </g>
      <text x={PAD_L} y={H - 3} className="t-mono-sm" fill="var(--muted)">
        0
      </text>
      <text x={W - 42} y={H - 3} className="t-mono-sm" fill="var(--muted)">
        {(profile.totalM / 1000).toFixed(1)}km
      </text>
    </svg>
  )
}
