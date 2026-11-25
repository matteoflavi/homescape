import { isLStairs, isUStairs, L_FLIGHT, lLayout, stairsSize, uSecondSide } from './stairs'
import type { Item, Level, Rect } from './types'

/*
 * Stairwell: stairs on the lower level open a hole of their footprint in the floor of the level above (the stairs below
 * are visible through it); the arrival end of the hole (the top of the stairs, local -z) is open, the other edges get a
 * railing (except an edge on a wall). On the lower level the ceiling of the stairs' room is open at the same spot. The
 * stairs (kit/outdoor.tsx > Stairs) are 1 m wide and 3.2 m long; the hole is 5 cm wider on each side.
 */

export type Side = 'l' | 'r' | 't' | 'b'
type Pt = { x: number; z: number }
export interface Stairwell {
  id: string
  r: Rect
  /** Arrival edge (top of the stairs): no railing */
  open: Side
  /** Only this part of the arrival edge is open (U stairs arrive on one half of it); the rest gets a railing */
  openSeg?: { a: Pt; b: Pt }
  /**
   * The hole when it is not the whole rectangle r (L stairs: the first flight's strip and the second flight's band).
   * r stays the bounding box; the arrival is the openSeg.
   */
  parts?: Rect[]
}

/** The rectangles cut out of the floor above */
export const holeRects = (w: Stairwell): Rect[] => w.parts ?? [w.r]

/**
 * Footprint of the stairs (axis-aligned after rotation, 5 cm wider on each side) and the arrival edge. Straight stairs
 * arrive at their local -z end; U stairs (model/stairs.ts) at their +z end, on the second flight's half only.
 */
export function stairFootprint(it: Item): Stairwell {
  const c = Math.cos(it.rot)
  const s = Math.sin(it.rot)
  const { w, l } = stairsSize(it)
  const hw = w / 2 + 0.05
  const hl = l / 2 + 0.05
  const hx = Math.abs(c) * hw + Math.abs(s) * hl
  const hz = Math.abs(s) * hw + Math.abs(c) * hl
  if (isLStairs(it)) return lFootprint(it)
  const u = isUStairs(it)
  // Arrival direction in the world: local -z is (-sin, -cos), local +z (sin, cos)
  const dx = u ? s : -s
  const dz = u ? c : -c
  const open: Side = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'l' : 'r') : dz < 0 ? 't' : 'b'
  const r = { x: it.x - hx, z: it.z - hz, w: hx * 2, d: hz * 2 }
  if (!u) return { id: it.id, r, open }
  // The second flight's half of the +z edge: from the middle to its outer side
  const at = (lx: number, lz: number) => ({ x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c })
  const sx = uSecondSide(it)
  return { id: it.id, r, open, openSeg: { a: at(0, hl), b: at(sx * hw, hl) } }
}

/**
 * L stairs (model/stairs.ts > lLayout): two rectangles, the first flight's strip over the whole length and the second
 * flight's band beside the landing; they arrive at the far end of the band (the turn side), the rest gets a railing.
 */
function lFootprint(it: Item): Stairwell {
  const c = Math.cos(it.rot)
  const s = Math.sin(it.rot)
  const g = lLayout(it)
  const at = (lx: number, lz: number) => ({ x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c })
  const rectOf = (x0: number, z0: number, x1: number, z1: number): Rect => {
    const pts = [at(x0, z0), at(x1, z0), at(x0, z1), at(x1, z1)]
    const xs = pts.map((p) => p.x)
    const zs = pts.map((p) => p.z)
    return { x: Math.min(...xs), z: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
  }
  const m = 0.05
  const hw = g.w / 2 + m
  const hl = g.l / 2 + m
  // First flight strip (with the landing): local x within fx ± L_FLIGHT/2, the whole length
  const fx0 = g.fx - L_FLIGHT / 2 - m
  const fx1 = g.fx + L_FLIGHT / 2 + m
  const strip = rectOf(fx0, -hl, fx1, hl)
  // Second flight band: from the landing's inner edge to the turn side, along the -z end
  const inner = g.sT > 0 ? fx1 : fx0
  const band = rectOf(inner, -hl, g.sT * hw, g.zL + m)
  const r = rectOf(-hw, -hl, hw, hl)
  const open: Side = (() => {
    const dx = g.sT * c
    const dz = -g.sT * s
    return Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'l' : 'r') : dz < 0 ? 't' : 'b'
  })()
  // Without steps after the turn the stairs arrive at the corner's side: the strip alone
  const parts = g.after > 0 ? [strip, band] : [strip]
  return { id: it.id, r, open, openSeg: { a: at(g.sT * hw, -hl), b: at(g.sT * hw, g.zL + m) }, parts }
}

/** Holes in this level's floor opened by the stairs on the level right below */
export function stairwellsOf(levels: Level[], level: Level): Stairwell[] {
  const e = level.elevation ?? 0
  const below = levels.find((l) => (l.elevation ?? 0) === e - 1)
  return below ? below.items.filter((it) => it.kind === 'stairs').map(stairFootprint) : []
}

/** Holes in the ceiling opened by this level's stairs */
export const ceilingHoles = (level: Level) => level.items.filter((it) => it.kind === 'stairs').flatMap((it) => holeRects(stairFootprint(it)))

const EPS = 1e-6

/** Subtracts the holes from a rectangle: the remaining parts (the rectangle itself without holes) */
export function subtractRects(r: Rect, holes: Rect[]): Rect[] {
  let parts = [r]
  for (const h of holes) {
    const next: Rect[] = []
    for (const p of parts) {
      const x0 = Math.max(p.x, h.x)
      const x1 = Math.min(p.x + p.w, h.x + h.w)
      const z0 = Math.max(p.z, h.z)
      const z1 = Math.min(p.z + p.d, h.z + h.d)
      if (x1 - x0 <= EPS || z1 - z0 <= EPS) {
        next.push(p)
        continue
      }
      // Top and bottom strips at full width, left and right in the middle
      if (z0 - p.z > EPS) next.push({ x: p.x, z: p.z, w: p.w, d: z0 - p.z })
      if (p.z + p.d - z1 > EPS) next.push({ x: p.x, z: z1, w: p.w, d: p.z + p.d - z1 })
      if (x0 - p.x > EPS) next.push({ x: p.x, z: z0, w: x0 - p.x, d: z1 - z0 })
      if (p.x + p.w - x1 > EPS) next.push({ x: x1, z: z0, w: p.x + p.w - x1, d: z1 - z0 })
    }
    parts = next
  }
  return parts.filter((p) => p.w > 0.02 && p.d > 0.02)
}

/** Railing edges of the hole (except the arrival edge and edges on the room boundary, i.e. a wall) */
export function railEdges(w: Stairwell, room: Rect[]): { a: { x: number; z: number }; b: { x: number; z: number } }[] {
  if (w.parts) return partsRailEdges(w, room)
  const { x, z, w: W, d: D } = w.r
  const sides: [Side, { x: number; z: number }, { x: number; z: number }][] = [
    ['t', { x, z }, { x: x + W, z }],
    ['b', { x, z: z + D }, { x: x + W, z: z + D }],
    ['l', { x, z }, { x, z: z + D }],
    ['r', { x: x + W, z }, { x: x + W, z: z + D }],
  ]
  // An edge closer than 12 cm to the room's outer boundary is on a wall: no railing needed
  const onWall = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    const inside = (px: number, pz: number) => room.some((q) => px > q.x && px < q.x + q.w && pz > q.z && pz < q.z + q.d)
    const nx = a.x === b.x ? 0.12 : 0
    const nz = a.z === b.z ? 0.12 : 0
    return !inside(mx + nx, mz + nz) || !inside(mx - nx, mz - nz)
  }
  // The arrival edge of U stairs is open on one half only: the other half (above the first flight) gets a railing
  const parts: [Side, Pt, Pt][] = sides.flatMap(([s, a, b]): [Side, Pt, Pt][] => {
    if (s !== w.open) return [[s, a, b]]
    if (!w.openSeg) return []
    const horiz = a.z === b.z
    const along = (p: Pt) => (horiz ? p.x : p.z)
    const lo = Math.min(along(w.openSeg.a), along(w.openSeg.b))
    const hi = Math.max(along(w.openSeg.a), along(w.openSeg.b))
    const pt = (v: number): Pt => (horiz ? { x: v, z: a.z } : { x: a.x, z: v })
    return ([[along(a), lo], [hi, along(b)]] as [number, number][]).filter(([p, q]) => q - p > 0.05).map(([p, q]): [Side, Pt, Pt] => [s, pt(p), pt(q)])
  })
  // Without a room (walk mode collision) all edges
  return parts.filter(([, a, b]) => !room.length || !onWall(a, b)).map(([, a, b]) => ({ a, b }))
}

/**
 * Railing edges of a hole made of several rectangles (L stairs): every outline edge, split where it meets another part
 * (no railing inside the hole), minus the arrival segment and edges on a wall.
 */
function partsRailEdges(w: Stairwell, room: Rect[]): { a: Pt; b: Pt }[] {
  const parts = w.parts ?? [w.r]
  const inPart = (px: number, pz: number) => parts.some((q) => px > q.x + EPS && px < q.x + q.w - EPS && pz > q.z + EPS && pz < q.z + q.d - EPS)
  const inside = (px: number, pz: number) => room.some((q) => px > q.x && px < q.x + q.w && pz > q.z && pz < q.z + q.d)
  const seg = w.openSeg
  const onOpen = (a: Pt, b: Pt) => {
    if (!seg) return false
    const near = (p: Pt) => Math.abs((seg.b.x - seg.a.x) * (p.z - seg.a.z) - (seg.b.z - seg.a.z) * (p.x - seg.a.x)) < 1e-3 * Math.max(1, Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z))
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    const within = mx >= Math.min(seg.a.x, seg.b.x) - 1e-3 && mx <= Math.max(seg.a.x, seg.b.x) + 1e-3 && mz >= Math.min(seg.a.z, seg.b.z) - 1e-3 && mz <= Math.max(seg.a.z, seg.b.z) + 1e-3
    return near(a) && near(b) && within
  }
  const xs = [...new Set(parts.flatMap((q) => [q.x, q.x + q.w]))]
  const zs = [...new Set(parts.flatMap((q) => [q.z, q.z + q.d]))]
  const out: { a: Pt; b: Pt }[] = []
  for (const q of parts) {
    const edges: [Pt, Pt, number, number][] = [
      [{ x: q.x, z: q.z }, { x: q.x + q.w, z: q.z }, 0, -1],
      [{ x: q.x, z: q.z + q.d }, { x: q.x + q.w, z: q.z + q.d }, 0, 1],
      [{ x: q.x, z: q.z }, { x: q.x, z: q.z + q.d }, -1, 0],
      [{ x: q.x + q.w, z: q.z }, { x: q.x + q.w, z: q.z + q.d }, 1, 0],
    ]
    for (const [a, b, nx, nz] of edges) {
      const horiz = a.z === b.z
      const cuts = (horiz ? xs : zs).filter((v) => v > (horiz ? a.x : a.z) + EPS && v < (horiz ? b.x : b.z) - EPS)
      const stops = [horiz ? a.x : a.z, ...cuts.sort((p, r) => p - r), horiz ? b.x : b.z]
      for (let i = 0; i < stops.length - 1; i++) {
        const p: Pt = horiz ? { x: stops[i], z: a.z } : { x: a.x, z: stops[i] }
        const r: Pt = horiz ? { x: stops[i + 1], z: a.z } : { x: a.x, z: stops[i + 1] }
        const mx = (p.x + r.x) / 2
        const mz = (p.z + r.z) / 2
        if (inPart(mx + nx * 0.02, mz + nz * 0.02)) continue
        if (onOpen(p, r)) continue
        if (room.length && (!inside(mx + nx * 0.12, mz + nz * 0.12) || !inside(mx - nx * 0.12, mz - nz * 0.12))) continue
        out.push({ a: p, b: r })
      }
    }
  }
  return out
}
