import type { Step } from '../types'

const W = 248
const H = 48
const PAD = 5

export function RnormSparkline({
  step,
  layer,
  layers,
}: {
  step: Step
  layer: number
  layers: number
}) {
  const r = step.rnorm ?? []
  if (r.length < 2) return null
  const max = Math.max(...r)
  const min = Math.min(...r)
  const span = max - min || 1
  const x = (i: number) => PAD + (i / (layers - 1)) * (W - 2 * PAD)
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD)
  const pts = r.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const li = Math.min(layer, r.length - 1)

  return (
    <div className="spark-wrap">
      <svg
        className="spark"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="residual rms across layers"
      >
        <polyline className="spark-line" points={pts} />
        <circle className="spark-cur" cx={x(li)} cy={y(r[li])} r={3} />
      </svg>
      <div className="spark-cap">
        rms {r[0]?.toFixed(1)} (layer 0) → {r[r.length - 1]?.toFixed(1)} (layer {r.length - 1}) ·
        layer {li}: <b>{r[li]?.toFixed(1)}</b>
      </div>
    </div>
  )
}
