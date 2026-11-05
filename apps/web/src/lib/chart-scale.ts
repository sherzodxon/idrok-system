// Pure geometry for the small SVG charts (no DOM): one linear scale per axis, so marks, grid and labels agree.

export interface Domain {
  min: number;
  max: number;
}

/** Maps a value from the domain to [from, to]; a flat domain maps everything to the middle. */
export function linear(domain: Domain, from: number, to: number): (v: number) => number {
  const span = domain.max - domain.min;
  return (v) => (span === 0 ? (from + to) / 2 : from + ((v - domain.min) / span) * (to - from));
}

/** Rounds the domain outwards to a "nice" step so the grid lines name readable values. */
export function niceDomain(values: number[], ticks = 4, floor?: number, ceil?: number): Domain & { step: number } {
  const finite = values.filter(Number.isFinite);
  let min = floor ?? (finite.length ? Math.min(...finite) : 0);
  let max = ceil ?? (finite.length ? Math.max(...finite) : 1);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  // Fixed bounds: the grid must land on both of them, so the step has to divide the span.
  const fixed = floor !== undefined && ceil !== undefined;
  const divides = (s: number) => Math.abs((max - min) / s - Math.round((max - min) / s)) < 1e-9;
  const step =
    (fixed ? steps.find((s) => divides(s) && (max - min) / s <= ticks + 2) : steps.find((s) => s >= raw)) ??
    steps.find((s) => s >= raw) ??
    10 * mag;
  return {
    min: floor ?? Math.floor(min / step) * step,
    max: ceil ?? Math.ceil(max / step) * step,
    step,
  };
}

export function tickValues(d: Domain & { step: number }): number[] {
  const out: number[] = [];
  for (let v = d.min; v <= d.max + d.step / 1e6; v += d.step) out.push(Number(v.toFixed(6)));
  return out;
}

/** SVG path of a line through the points; `null` values break the line (no data that day). */
export function linePath(points: { x: number; y: number | null }[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.y === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Closed area under each unbroken run of the line, down to `baseY`. */
export function areaPath(points: { x: number; y: number | null }[], baseY: number): string {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push({ x: p.x, y: p.y });
  }
  if (run.length) runs.push(run);
  return runs
    .filter((r) => r.length > 1)
    .map(
      (r) => `${linePath(r)}L${r.at(-1)!.x.toFixed(1)} ${baseY.toFixed(1)}L${r[0]!.x.toFixed(1)} ${baseY.toFixed(1)}Z`,
    )
    .join("");
}

/** Share 0–100 of `value` in `max`, clamped; a zero max is an empty bar. */
export function percentOf(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
