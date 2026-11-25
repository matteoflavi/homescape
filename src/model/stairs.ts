import { sizeOf } from './catalog'
import { WALL_T, type Side as WallSide, type WallRun } from './geometry'
import type { Item } from './types'

/*
 * Stairs: straight (Item.variant unset or 'straight', 1 x 3.2 m) or U-shaped, a switchback with two flights and a half
 * landing (Item.variant 'uLeft' | 'uRight', the way it turns on the landing; 2.1 x 2.6 m). Both rise FLOOR_H (14 steps of
 * 0.2 m) to the floor above. Optional walls along the long sides (Item.walls 'left' | 'right' | 'both'): they render like
 * walls (kit/outdoor.tsx > Stairs), block walking (fps.ts, pets.ts) and items stand against their outer faces
 * (geometry.ts > wallSnap). Local frame: a straight flight climbs toward -z; a U flight climbs toward -z on its first side,
 * turns on the landing at the -z end and climbs back toward +z on the other side, arriving at the +z end.
 */

export const STAIRS_H = 2.8
/** U stairs: width of a flight, gap (the spine wall) between the flights, depth of the landing */
export const U_FLIGHT = 1
export const U_GAP = 0.1
export const U_LANDING = 1
export const U_SIZE = { len: U_FLIGHT * 2 + U_GAP, len2: 2.6 }

export const isUStairs = (it: Pick<Item, 'variant'>) => it.variant === 'uLeft' || it.variant === 'uRight'

/*
 * L stairs (Item.variant 'lLeft' | 'lRight', the way they turn): a first flight climbing toward -z on the side away from
 * the turn, a square corner at the -z end where the stairs turn 90°, and a second flight leaving the corner sideways
 * (local +x for 'lRight') along the -z end, arriving at that side. The corner is a flat landing (Item.cornerSteps 1) or
 * winders, wedge treads fanning around the inner corner (2 or more). Item.steps counts the steps (risers) from floor to
 * floor; the treads are one fewer (the last step is the floor above): first flight, corner, then Item.stepsAfter on the
 * second flight. So the turn can sit anywhere along the climb. Straight treads are L_TREAD deep and the footprint follows
 * from the counts (lStairsSize): changing a count resizes the stairs.
 */
export const L_FLIGHT = 1
export const L_TREAD = 0.27
export const L_STEPS_DEF = 14
export const L_AFTER_DEF = 3
export const isLStairs = (it: Pick<Item, 'variant'>) => it.variant === 'lLeft' || it.variant === 'lRight'
/** Side the second flight leaves toward: +1 local +x (turns right going up), -1 local -x */
export const lTurnSide = (it: Pick<Item, 'variant'>) => (it.variant === 'lRight' ? 1 : -1)
type LCounts = Pick<Item, 'steps' | 'cornerSteps' | 'stepsAfter'>
/** Step counts, kept so that the first flight has at least one tread: steps (risers), treads before, in and after the turn */
export function lSteps(it: LCounts) {
  const n = Math.round(Math.min(24, Math.max(4, it.steps ?? L_STEPS_DEF)))
  const corner = Math.round(Math.min(6, Math.max(1, it.cornerSteps ?? 1)))
  const after = Math.round(Math.min(n - 2 - corner, Math.max(0, it.stepsAfter ?? L_AFTER_DEF)))
  return { n, corner, after, before: n - 1 - corner - after, fan: corner > 1 }
}
/** Footprint of L stairs from their step counts. len: across (local x), len2: along (local z). */
export function lStairsSize(it: LCounts) {
  const { before, after } = lSteps(it)
  return { len: L_FLIGHT + after * L_TREAD, len2: before * L_TREAD + L_FLIGHT }
}
/** Geometry of L stairs in the local frame */
export function lLayout(it: Pick<Item, 'variant' | 'len' | 'len2'> & LCounts) {
  const { w, l } = stairsSize(it)
  const sT = lTurnSide(it)
  const c = lSteps(it)
  const rise = STAIRS_H / c.n
  // First flight centred on fx (the side away from the turn), from +l/2 down to the corner at zL; the corner's inner
  // point (pivot) is where the first flight's inner side meets the corner
  const fx = -sT * (w / 2 - L_FLIGHT / 2)
  const zL = -l / 2 + L_FLIGHT
  return { w, l, sT, ...c, rise, fx, zL, px: fx + (sT * L_FLIGHT) / 2, h1: c.before * rise, h2: (c.before + c.corner) * rise }
}

/** Side of the second flight: +1 local +x (turns right going up), -1 local -x */
export const uSecondSide = (it: Pick<Item, 'variant'>) => (it.variant === 'uRight' ? 1 : -1)

/** Width (local x) and length (local z) of the stairs */
export const stairsSize = (it: Pick<Item, 'len' | 'len2'>) => {
  const [w, l] = sizeOf('stairs', it.len, it.len2)
  return { w, l }
}

/** Turned fraction (0 entering the corner, 1 leaving it) of a local point in the corner, around the pivot */
export function cornerTurn(g: { sT: number; px: number; zL: number }, lx: number, lz: number) {
  const a = Math.atan2(g.zL - lz, -g.sT * (lx - g.px))
  return Math.max(0, Math.min(1, a / (Math.PI / 2)))
}

/**
 * Foot height (m above the floor) at a local point of the stairs, null outside. Straight: a ramp from the +z end up to
 * STAIRS_H at the -z end. U: the first flight from the +z end up to the landing (half height), the landing, then the
 * second flight from the landing up to STAIRS_H at the +z end.
 */
export function stairsHeightLocal(it: Pick<Item, 'variant' | 'len' | 'len2' | 'steps' | 'cornerSteps' | 'stepsAfter'>, lx: number, lz: number): number | null {
  const { w, l } = stairsSize(it)
  if (Math.abs(lx) > w / 2 + 0.05 || Math.abs(lz) > l / 2 + 0.05) return null
  if (isLStairs(it)) return lHeight(it, lx, lz)
  if (!isUStairs(it)) return Math.max(0, Math.min(1, (l / 2 - lz) / l)) * STAIRS_H
  const half = STAIRS_H / 2
  const landing = -l / 2 + U_LANDING
  if (lz <= landing) return half
  const run = l / 2 - landing
  const second = Math.sign(lx || -1) === uSecondSide(it)
  const t = Math.max(0, Math.min(1, (l / 2 - lz) / run))
  return second ? half + (1 - t) * half : t * half
}

/**
 * L stairs: a ramp along the first flight, the corner (flat, or rising with the turned angle for winders), a ramp along
 * the second flight up to STAIRS_H at its far end. null in the empty corner beside the first flight (under the second one
 * there is room to walk).
 */
function lHeight(it: Pick<Item, 'variant' | 'len' | 'len2'> & LCounts, lx: number, lz: number): number | null {
  const g = lLayout(it)
  const inFirst = Math.abs(lx - g.fx) <= L_FLIGHT / 2 + 0.05
  if (lz > g.zL) {
    if (!inFirst) return null
    return Math.max(0, Math.min(1, (g.l / 2 - lz) / (g.l / 2 - g.zL))) * g.h1
  }
  const fromCorner = g.sT * (lx - g.px)
  if (fromCorner <= 0) return g.fan ? g.h1 + cornerTurn(g, lx, lz) * (g.h2 - g.h1) : g.h2
  const run = g.w - L_FLIGHT
  return g.h2 + Math.max(0, Math.min(1, fromCorner / Math.max(run, 0.01))) * (STAIRS_H - g.h2)
}

/** Straight segments (world) of the solid parts that block walking: side walls, and the spine between U flights */
export function stairsSegments(items: Item[]): { a: { x: number; z: number }; b: { x: number; z: number } }[] {
  const out: { a: { x: number; z: number }; b: { x: number; z: number } }[] = []
  for (const it of items) {
    if (it.kind !== 'stairs') continue
    const { w, l } = stairsSize(it)
    const c = Math.cos(it.rot)
    const s = Math.sin(it.rot)
    const at = (lx: number, lz: number) => ({ x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c })
    for (const sx of wallSides(it)) out.push({ a: at(sx * (w / 2 + WALL_T / 2), -l / 2), b: at(sx * (w / 2 + WALL_T / 2), l / 2) })
    if (isUStairs(it)) out.push({ a: at(0, -l / 2 + U_LANDING), b: at(0, l / 2) })
  }
  return out
}

/** Local x sides (-1, +1) that have a wall along them */
export const wallSides = (it: Pick<Item, 'walls' | 'variant'>) => (isLStairs(it) ? [] : it.walls === 'both' ? [-1, 1] : it.walls === 'left' ? [-1] : it.walls === 'right' ? [1] : [])

const SIDE_OF_X: Record<number, WallSide> = { 1: 'left', [-1]: 'right' }
const SIDE_OF_Z: Record<number, WallSide> = { 1: 'back', [-1]: 'front' }

/**
 * Wall runs of the stairs' side walls, outer faces only, for sticking items to them (geometry.ts > wallSnap). Like a room's
 * wall run, `side` says which way the items face: the run's line is the middle of the wall. Only stairs turned by a
 * multiple of 90° (like rooms, walls are axis-aligned).
 */
export function stairsWallRuns(items: Item[]): WallRun[] {
  const runs: WallRun[] = []
  for (const it of items) {
    if (it.kind !== 'stairs' || !it.walls) continue
    const c = Math.round(Math.cos(it.rot) * 1e6) / 1e6
    const s = Math.round(Math.sin(it.rot) * 1e6) / 1e6
    if (Math.abs(c) > 1e-6 && Math.abs(s) > 1e-6) continue
    const { w, l } = stairsSize(it)
    for (const sx of wallSides(it)) {
      // Outward normal of this side in the world (local +x is (c, -s))
      const nx = sx * c
      const nz = -sx * s
      const off = sx * (w / 2 + WALL_T / 2)
      const cx = it.x + off * c
      const cz = it.z - off * s
      // The wall runs along the stairs' length (local z, world direction (s, c))
      const ax = Math.abs(s) * l
      const az = Math.abs(c) * l
      if (Math.abs(nx) > 0.5) runs.push({ side: SIDE_OF_X[Math.sign(nx)], horizontal: false, line: cx, a0: cz - az / 2, a1: cz + az / 2, interior: false, cx: cx - nx, cz })
      else runs.push({ side: SIDE_OF_Z[Math.sign(nz)], horizontal: true, line: cz, a0: cx - ax / 2, a1: cx + ax / 2, interior: false, cx, cz: cz - nz })
    }
  }
  return runs
}
