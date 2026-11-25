// Building regression test (user feedback, 9 Oct 2026: "the stairs look like this on the upper floors, fix it; when I go from the
// lower floor to the upper floor or from the top down in fps mode it freezes; homes also need a roof, in a way that lets us see
// inside the home"): in the American sample home the stairwell (an opening in the floor of the upper floor, stairs below, railing,
// not falling in from the side in the walk), items not being rebuilt when the floor changes, drawing of the upper floor and the
// roof in the walk, the automatic display of the roof (comes down from afar, when zooming in, when focusing on a room, lifts in
// edit), the roof setting in the floor menu.
// `npm run dev` must be running first. Run: node tools/building-check.mjs
// Intermediate screenshots: shots/building-*.png. At the end it deletes the sample home and returns to the previous home.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1000)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const shot = (name) => p.screenshot({ path: `shots/building-${name}.png` })
const H = (fn, ...a) => p.evaluate(([f, args]) => window.__homescape[f](...args), [fn, a])
const prev = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  return s.homeId ?? s.homes?.[0]?.id ?? 'home-main'
})
const usId = await H('loadDemo', 'american', true)
await p.waitForTimeout(2500)
const plan = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  s.setMode('view')
  s.select(null)
  const l0 = s.layout.levels.find((l) => (l.elevation ?? 0) === 0)
  const l1 = s.layout.levels.find((l) => (l.elevation ?? 0) === 1)
  const stairs = l0.items.find((i) => i.kind === 'stairs')
  const sofa = l0.items.find((i) => i.kind === 'sofa')
  const bed = l1.items.find((i) => i.kind === 'bed')
  const hall = l1.rooms.find((r) => r.x <= stairs.x && r.x + r.w >= stairs.x && r.z <= stairs.z && r.z + r.d >= stairs.z)
  return { l0: l0.id, l1: l1.id, stairs, sofa: sofa.id, bed: bed.id, hall: hall?.id, fire: l0.items.some((i) => i.kind === 'fireplace') }
})
const setLevel = (id) => p.evaluate((x) => window.__homescape.getState().layout.setLevel(x), id)
const S = plan.stairs
// The stairs start at the local +z end and reach the upper floor at the -z end (the direction depends on the rotation)
const along = (d) => ({ x: S.x + Math.sin(S.rot) * d, z: S.z + Math.cos(S.rot) * d })

// --- Stairwell: an opening in the floor of the upper floor, stairs below ---
await setLevel(plan.l1)
await p.waitForTimeout(800)
const mid = along(0.3)
const down = await H('pick', mid.x, 1.5, mid.z, 0, -1, 0)
const side = along(0)
const off = { x: side.x + Math.cos(S.rot) * 1.2, z: side.z - Math.sin(S.rot) * 1.2 }
const floor = await H('pick', off.x, 1.5, off.z, 0, -1, 0)
ok(down && down.y < -0.2, `On the upper floor the floor above the stairs is open and the stairs show below (hit y ${down?.y?.toFixed(2)}${down?.itemId === S.id ? ', stairs' : ''})`)
ok(floor && Math.abs(floor.y) < 0.1, `Next to the opening the floor of the upper floor is in place (hit y ${floor?.y?.toFixed(2)})`)
// Railing: a handrail at 95 cm on the side edge of the opening (the arrival end is open)
const railSide = along(0)
const nx = Math.cos(S.rot)
const nz = -Math.sin(S.rot)
let railHit = null
for (const sgn of [1, -1]) {
  const from = { x: railSide.x + nx * sgn * 1.0, z: railSide.z + nz * sgn * 1.0 }
  const h = await H('pick', from.x, 0.95, from.z, -nx * sgn, 0, -nz * sgn)
  if (h && h.distance < 0.6) railHit = h
}
ok(Boolean(railHit), `There is a railing next to the opening (${railHit ? `${railHit.distance.toFixed(2)} m` : 'none'})`)
await p.evaluate((id) => window.__homescape.focusRoom(id), plan.hall)
await p.waitForTimeout(2200)
await shot('stairs-upper')

// --- Items are not rebuilt when the floor changes ---
await setLevel(plan.l0)
await p.waitForTimeout(600)
await p.click('#fps-toggle')
await p.waitForSelector('#fps-hud')
await p.waitForTimeout(800)
const sofa0 = await H('itemObject', plan.sofa)
const bed0 = await H('itemObject', plan.bed)
ok(Boolean(bed0) && bed0.y > 2.5, `In the walk mode on the ground floor the upper floor is drawn too (bed on the upper floor, y ${bed0?.y?.toFixed(2)})`)
// Walk up the stairs
const start = along(1.75)
// Forward in the walk mode is (-sin yaw, -cos yaw): for the local -z direction of the stairs yaw = rotation
await H('fpsTeleport', start.x, start.z, S.rot, 0)
await p.waitForTimeout(300)
const t0 = Date.now()
// Frame intervals (the longest frame while the floor changes)
await p.evaluate(() => {
  window.__gaps = []
  let last = performance.now()
  window.__rec = true
  const loop = (t) => {
    window.__gaps.push(t - last)
    last = t
    if (window.__rec) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})
await p.keyboard.down('KeyW')
let switched = false
for (let t = 0; t < 3000 && !switched; t += 100) {
  await p.waitForTimeout(100)
  switched = (await p.evaluate(() => window.__homescape.getState().layout.levelId)) === plan.l1
}
await p.waitForTimeout(500)
await p.keyboard.up('KeyW')
const sofa1 = await H('itemObject', plan.sofa)
const bed1 = await H('itemObject', plan.bed)
const gaps = await p.evaluate(() => {
  window.__rec = false
  return window.__gaps
})
const worst = Math.round(Math.max(...gaps))
const sorted = [...gaps].sort((x, y) => x - y)
ok(switched, `Walking up the stairs in the walk mode reaches the upper floor (${Date.now() - t0} ms)`)
// Even in the test browser that renders in software (SwiftShader) there is no long freeze at the floor change (hundreds of items used to be rebuilt from scratch)
ok(worst < 1000, `Longest frame at the floor change ${worst} ms (median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms, ${gaps.length} frames)`)
ok(sofa0 && sofa1 && sofa0.uuid === sofa1.uuid && bed0.uuid === bed1.uuid, `Items are not rebuilt when the floor changes (the sofa and the bed are the same object; sofa y ${sofa0?.y?.toFixed(2)} -> ${sofa1?.y?.toFixed(2)})`)
ok(sofa1 && Math.abs(sofa1.y + 2.8) < 0.05 && Math.abs(bed1.y) < 0.05, `The floors moved to their new heights (lower floor -2.8 m, upper floor 0)`)
await p.waitForTimeout(600)
// Walking sideways into the opening on the upper floor: the railing stops it, the floor does not change
let beside = null
let sgn = 1
for (const k of [1, -1]) {
  const q = { x: S.x + nx * k * 1.1, z: S.z + nz * k * 1.1 }
  const h = await H('pick', q.x, 1.5, q.z, 0, -1, 0)
  if (!beside && h && Math.abs(h.y) < 0.1) {
    beside = q
    sgn = k
  }
}
// Walks toward the opening (in the -n direction): yaw = atan2(n)
await H('fpsTeleport', beside.x, beside.z, Math.atan2(nx * sgn, nz * sgn), 0)
await p.waitForTimeout(300)
await p.keyboard.down('KeyW')
await p.waitForTimeout(1500)
await p.keyboard.up('KeyW')
const f = await H('fps')
const lvNow = await p.evaluate(() => window.__homescape.getState().layout.levelId)
ok(lvNow === plan.l1 && Math.abs(f.h) < 0.05, `Walking sideways into the opening on the upper floor, the railing stops it (floor ${lvNow === plan.l1 ? '1' : '0'}, height ${f.h.toFixed(2)})`)
// Looking down: railing and stairs
const top = along(-2.3)
await H('fpsTeleport', top.x + nx * 0.8, top.z + nz * 0.8, S.rot + Math.PI * 0.9, -0.55)
await p.waitForTimeout(1500)
await shot('stairs-walk')
// From outside: the two storey home and the roof
await setLevel(plan.l0)
await p.waitForTimeout(400)
// Look at the home from the street
const view = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  const l = s.layout.levels.find((x) => (x.elevation ?? 0) === 0)
  const road = l.rooms.find((r) => r.floor === 'road')
  const inside = l.rooms.filter((r) => r.type !== 'garden' && r.type !== 'terrace' && r.type !== 'balcony')
  const cx = inside.reduce((a, r) => a + r.x + r.w / 2, 0) / inside.length
  const cz = inside.reduce((a, r) => a + r.z + r.d / 2, 0) / inside.length
  return { x: road.x + road.w / 2, z: road.z + road.d / 2, cx, cz }
})
// Look toward the home: forward (-sin, -cos) points at the home
await H('fpsTeleport', view.x, view.z, Math.atan2(view.x - view.cx, view.z - view.cz), 0.12)
await p.waitForTimeout(1600)
const rf = await H('roof')
ok(Object.values(rf.alpha).every((a) => a > 0.99), `In the walk mode the roofs of all floors are visible (${JSON.stringify(rf.alpha)})`)
await shot('walk-outside')
await p.keyboard.press('Escape')
await p.keyboard.press('Escape')
await p.waitForTimeout(600)

// --- Roof: comes down from afar, lifts when zooming in, when focusing on a room, in edit ---
const roofOf = async (id) => (await H('roof')).alpha[id] ?? 0
await setLevel(plan.l1)
await p.click('button:has-text("Whole home")')
await p.waitForTimeout(2500)
ok((await roofOf(plan.l1)) > 0.99 && (await H('roof')).covered, `Looking at the whole home from afar the roof comes down, walls are full height (${(await roofOf(plan.l1)).toFixed(2)})`)
await shot('roof')
// With the roof down, the windows on the exterior walls are full height (user feedback, 9 Oct 2026: "there are no windows in the American home")
const wins = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  const l = s.layout.levels.find((x) => x.id === s.levelId)
  const geo = (r, x, z) => r.x < x && r.x + r.w > x && r.z < z && r.z + r.d > z
  const inside = (x, z) => l.rooms.some((r) => r.type !== 'garden' && r.type !== 'terrace' && r.type !== 'balcony' && [r, ...(r.parts ?? [])].some((q) => geo(q, x, z)))
  // A window facing out: 1 m beyond it in the local -z direction is not indoors
  return l.items
    .filter((i) => i.kind === 'window' && !inside(i.x - Math.sin(i.rot) * 1, i.z - Math.cos(i.rot) * 1))
    .map((i) => ({ id: i.id, x: i.x, z: i.z, rot: i.rot, y: 0.9 + (i.len2 ?? 1.2) * 0.75 }))
})
let winHit = 0
for (const w of wins) {
  const ox = -Math.sin(w.rot)
  const oz = -Math.cos(w.rot)
  const h = await H('pick', w.x + ox * 1.5, w.y, w.z + oz * 1.5, -ox, 0, -oz)
  if (h && h.itemId === w.id) winHit++
}
ok(wins.length > 0 && winHit === wins.length, `With the roof down, the windows on the exterior walls are full height (${winHit}/${wins.length} windows are visible from their upper part)`)
// Walls do not stick out of the roof (user feedback, 9 Oct 2026: "the concrete of the walls of the home has poked through the
// roof and come out"): on the roof of every floor, above the outer half of an exterior wall (4 cm outside the room edge) the top
// surface of the roof is higher than the top of the wall; the underside of the tile roof is not buried in the wall either (computed
// from the triangles of the roof geometry)
const wallTops = (style, above) =>
  p.evaluate(
    async ([style, above]) => {
      const g = await import('/src/model/geometry.ts')
      const { roofGeometry } = await import('/src/scene/roof.ts')
      const s = window.__homescape.getState().layout
      const levels = s.layout.levels.filter((l) => (l.elevation ?? 0) >= 0)
      const indoor = (l) => l.rooms.filter((r) => !g.isOutdoor(r)).flatMap(g.rectsOf)
      const inside = (rs, x, z) => rs.some((q) => x > q.x && x < q.x + q.w && z > q.z && z < q.z + q.d)
      let n = 0
      let clear = 0
      let under = 0
      const low = []
      for (const l of levels) {
        const e = l.elevation ?? 0
        const ups = levels.filter((o) => (o.elevation ?? 0) > e)
        const geo = roofGeometry(l, ups, style)
        if (!geo) continue
        const tris = []
        for (const bg of [geo.top, geo.trim]) {
          const pos = bg.getAttribute('position').array
          const idx = bg.index ? bg.index.array : null
          const cnt = idx ? idx.length : pos.length / 3
          for (let t = 0; t < cnt; t += 3) tris.push([0, 1, 2].map((k) => (idx ? idx[t + k] : t + k) * 3).map((o) => [pos[o], pos[o + 1], pos[o + 2]]))
        }
        const heights = (x, z) => {
          const ys = []
          for (const [a, b, c] of tris) {
            const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
            if (Math.abs(d) < 1e-9) continue
            const w1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d
            const w2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d
            const w3 = 1 - w1 - w2
            if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue
            ys.push(w1 * a[1] + w2 * b[1] + w3 * c[1])
          }
          return ys
        }
        const own = indoor(l)
        const upper = ups.flatMap(indoor)
        for (const q of own)
          for (const [mx, mz, nx, nz] of [
            [q.x + q.w / 2, q.z, 0, -1],
            [q.x + q.w / 2, q.z + q.d, 0, 1],
            [q.x, q.z + q.d / 2, -1, 0],
            [q.x + q.w, q.z + q.d / 2, 1, 0],
          ]) {
            // Outer edge (the outside is not indoors) and the upper floor does not cover this edge
            if (inside(own, mx + nx * 0.3, mz + nz * 0.3) || inside(upper, mx - nx * 0.3, mz - nz * 0.3)) continue
            const ys = heights(mx + nx * 0.04, mz + nz * 0.04)
            n++
            const top = ys.length ? Math.max(...ys) : -1
            if (top > g.WALL_H + above) clear++
            else low.push(top.toFixed(2))
            if (ys.length && Math.min(...ys) >= g.WALL_H - 1e-3) under++
          }
      }
      return { n, clear, under, low }
    },
    [style, above],
  )
{
  const t = await wallTops('tile', 0.02)
  ok(t.n > 6 && t.clear === t.n && t.under === t.n, `The tile roof sits on top of the walls: the top of the exterior walls does not poke through the roof, the roof is not buried in the wall (${t.clear}/${t.n} points above, underside above the wall at ${t.under}/${t.n} points${t.low.length ? `; low: ${t.low.join(', ')}` : ''})`)
}
// The roof surface is made of planes (ridge, hip and valley lines pass through grid points; no sawtooth)
const planes = await p.evaluate(async () => {
  const s = window.__homescape.getState().layout
  const levels = s.layout.levels.filter((l) => (l.elevation ?? 0) >= 0)
  const l = levels.find((x) => x.id === s.levelId)
  const { roofGeometry } = await import('/src/scene/roof.ts')
  const g = roofGeometry(l, levels.filter((o) => (o.elevation ?? 0) > (l.elevation ?? 0)))
  const pos = g.top.getAttribute('position').array
  const idx = g.top.getIndex().array
  const set = new Set()
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]])
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const len = Math.hypot(...n) || 1
    set.add(n.map((x) => Math.round((x / len) * 100)).join(','))
  }
  return { planes: set.size, tris: idx.length / 3 }
})
ok(planes.planes <= 12, `The roof surface is made of flat pieces, no sawtooth on the broken lines (${planes.planes} separate face directions, ${planes.tris} triangles)`)
// The roof button in the right tool column and T: hides the roof if it is visible, brings it down if it is not
await p.click('#roof-toggle')
await p.waitForTimeout(1200)
// The button (and T) toggles between Auto and Hidden (user request: "keep removing the roof when approaching the home, but when
// I press the button it should be completely lifted")
const pref = () => p.evaluate(() => localStorage.getItem('homescape-roof-v2'))
const t1 = { a: await roofOf(plan.l1), pref: await pref() }
await p.click('#roof-toggle')
await p.waitForTimeout(1200)
const t2 = { a: await roofOf(plan.l1), pref: await pref() }
await p.mouse.move(700, 450)
await p.keyboard.press('t')
await p.waitForTimeout(1200)
const t3 = { a: await roofOf(plan.l1), pref: await pref() }
ok(t1.a < 0.01 && t1.pref === 'off' && t2.a > 0.99 && t2.pref === 'auto' && t3.a < 0.01 && t3.pref === 'off', `The roof button lifts it completely, pressing again returns to Auto, and so does T (${t1.pref} ${t1.a.toFixed(2)} / ${t2.pref} ${t2.a.toFixed(2)} / T ${t3.pref} ${t3.a.toFixed(2)})`)
await p.keyboard.press('t')
await p.waitForTimeout(300)
await p.click('button:has-text("Whole home")')
await p.waitForTimeout(2500)
// No gap between the floors (user feedback, 9 Oct 2026: "there is a gap between the floors"): the wall of the lower floor ends at
// 2.6 m, the upper floor starts at 2.8 m; the band of the exterior wall of the upper floor closes the 20 cm in between
const gapProbe = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  const l = s.layout.levels.find((x) => x.id === s.levelId)
  const r = l.rooms.filter((q) => q.type !== 'garden' && q.type !== 'terrace' && q.type !== 'balcony').sort((a, b) => a.x - b.x)[0]
  return { x: r.x, z: r.z + r.d / 2 }
})
// Between 2.6 m and the underside of the slab (2.68 m): -0.16 in the world (upper floor y = 0)
const band = await H('pick', gapProbe.x - 2, -0.16, gapProbe.z, 1, 0, 0)
ok(band && band.distance < 2.2, `No gap between the floors: the space between the top of the lower floor wall and the base of the upper floor is closed (hit ${band?.distance?.toFixed(2)} m)`)
// The exposed roof of the lower floor (garage, kitchen) does not come in front of the windows of the upper floor (user feedback:
// "the garage roof has come in front of the window"): in the 1.5 m in front of an exterior window of the upper floor the roof of
// the lower floor is below the window sill
const blocked = await p.evaluate(async () => {
  const s = window.__homescape.getState().layout
  const levels = s.layout.levels.filter((l) => (l.elevation ?? 0) >= 0)
  const l0 = levels.find((l) => (l.elevation ?? 0) === 0)
  const l1 = levels.find((l) => (l.elevation ?? 0) === 1)
  const { roofGeometry } = await import('/src/scene/roof.ts')
  const g = roofGeometry(l0, [l1])
  const pos = g.top.getAttribute('position').array
  const inside = (x, z) => l1.rooms.some((r) => r.type !== 'garden' && r.type !== 'terrace' && r.type !== 'balcony' && [r, ...(r.parts ?? [])].some((q) => q.x < x && q.x + q.w > x && q.z < z && q.z + q.d > z))
  const wins = l1.items.filter((i) => i.kind === 'window' && !inside(i.x - Math.sin(i.rot), i.z - Math.cos(i.rot)))
  let worst = -9
  let n = 0
  for (const w of wins) {
    const ox = -Math.sin(w.rot)
    const oz = -Math.cos(w.rot)
    const half = (w.len ?? 1.2) / 2
    const sill = 2.8 + 0.9
    let top = -9
    for (let k = 0; k < pos.length; k += 3) {
      const dx = pos[k] - w.x
      const dz = pos[k + 2] - w.z
      const along = dx * ox + dz * oz
      const side = Math.abs(dx * oz - dz * ox)
      if (along > 0.1 && along < 1.5 && side < half) top = Math.max(top, pos[k + 1])
    }
    if (top > -9) n++
    worst = Math.max(worst, top - sill)
  }
  return { n, worst }
})
ok(blocked.worst < 0, `The roof of the lower floor does not come in front of the windows of the upper floor (there is roof in front of ${blocked.n} windows, the highest spot is ${(-blocked.worst).toFixed(2)} m below the sill)`)
await p.evaluate((id) => window.__homescape.focusRoom(id), plan.hall)
await p.waitForTimeout(2200)
ok((await roofOf(plan.l1)) < 0.01 && !(await H('roof')).covered, `Focusing on a room lifts the roof (${(await roofOf(plan.l1)).toFixed(2)})`)
ok((await roofOf(plan.l0)) < 0.01, `Focusing on a room also lifts the exposed roof of the lower floor (garage) (${(await roofOf(plan.l0)).toFixed(2)})`)
await shot('roof-lifted')
await p.click('button:has-text("Whole home")')
await p.waitForTimeout(2500)
for (let i = 0; i < 8; i++) {
  await p.mouse.move(560, 470)
  await p.mouse.wheel(0, -400)
  await p.waitForTimeout(150)
}
await p.waitForTimeout(1500)
const dist = (await H('camera'))?.distance
ok((await roofOf(plan.l1)) < 0.01, `Zooming in lifts the roof (distance ${dist?.toFixed(1)} m)`)
await p.click('button:has-text("Whole home")')
await p.waitForTimeout(2500)
await p.evaluate(() => window.__homescape.setMode('edit'))
await p.waitForTimeout(1500)
ok((await roofOf(plan.l1)) < 0.01, 'There is no roof in edit mode')
await p.evaluate(() => window.__homescape.setMode('view'))
await p.waitForTimeout(1500)
// The exposed roof of the lower floor (garage) is always visible while on the upper floor
await p.click('button:has-text("Whole home")')
await p.waitForTimeout(2500)
ok((await roofOf(plan.l0)) > 0.99, `Looking from afar while on the upper floor, the exposed roof of the lower floor (garage) is visible too (${(await roofOf(plan.l0)).toFixed(2)})`)

// --- Roof setting in the floor menu ---
await p.click('button:has-text("Floor 1")')
await p.waitForTimeout(300)
await p.click('#roof-off')
await p.waitForTimeout(1500)
ok((await roofOf(plan.l1)) < 0.01 && (await roofOf(plan.l0)) < 0.01, 'Roof: with Hidden selected there is no roof at all')
await p.click('#roof-on')
await p.evaluate((id) => window.__homescape.focusRoom(id), plan.hall)
await p.waitForTimeout(2200)
ok((await roofOf(plan.l1)) > 0.99, 'Roof: with Always selected the roof stays even when focusing on a room')
const kept = await p.evaluate(() => localStorage.getItem('homescape-roof-v2'))
ok(kept === 'on', `The roof setting is remembered (${kept})`)
await p.evaluate(() => document.querySelector('#roof-auto')?.click() ?? null)
if (!(await p.$('#roof-auto'))) {
  await p.click('button:has-text("Floor 1")')
  await p.waitForTimeout(300)
}
await p.click('#roof-auto')
await p.waitForTimeout(300)

// --- Light stays within the floor (user feedback, 9 Oct 2026: "the light goes out through the roof of the home") ---
await p.evaluate(() => window.__homescape.setTheme('night'))
await p.waitForTimeout(1200)
const lights = await H('roomLights')
const indoor = lights.filter((l) => l.y && l.y[1] < 10)
ok(indoor.length > 0 && indoor.every((l) => l.y[0] > -0.1 && l.y[1] < 2.7), `Indoor lights stay on their own floor, between the floor and the ceiling (${indoor.length} lights, ${JSON.stringify(indoor[0]?.y)}); they do not light the roof, the floor above or the floor below`)
await p.evaluate(() => window.__homescape.setTheme('day'))

// --- Roof type: concrete flat roof (user request: "we should be able to choose a concrete roof for the home too") ---
const menu = async () => {
  if (!(await p.$('#roof-style-tile'))) await p.click('button:has-text("Floor 1")')
  await p.waitForSelector('#roof-style-tile')
}
await menu()
await p.click('#roof-style-concrete')
await p.keyboard.press('Escape')
await p.click('button:has-text("Whole home")')
await p.waitForTimeout(2200)
const flat = await p.evaluate(async () => {
  const s = window.__homescape.getState().layout
  const levels = s.layout.levels.filter((l) => (l.elevation ?? 0) >= 0)
  const l1 = levels.find((l) => (l.elevation ?? 0) === 1)
  const { roofGeometry } = await import('/src/scene/roof.ts')
  const g = roofGeometry(l1, [], 'concrete')
  const ys = new Set()
  const pos = g.top.getAttribute('position').array
  for (let k = 1; k < pos.length; k += 3) ys.add(pos[k].toFixed(3))
  return { tops: [...ys], maxY: g.box.maxY, parapet: g.trim.getAttribute('position')?.count ?? 0, stored: localStorage.getItem('homescape-roof-style') }
})
ok(flat.tops.length === 1 && Math.abs(flat.maxY - 3.3) < 0.01 && flat.parapet > 0 && /concrete/.test(flat.stored ?? ''), `The concrete roof is a flat slab with a parapet (slab ${flat.tops.join(',')} m, top of the parapet ${flat.maxY.toFixed(2)} m), remembered per home (${flat.stored})`)
ok((await roofOf(plan.l1)) > 0.99, 'The concrete roof comes down from afar too')
{
  const t = await wallTops('concrete', 0.3)
  ok(t.n > 6 && t.clear === t.n, `On the concrete roof the parapet covers the outer half of the exterior wall too (${t.clear}/${t.n} points below the parapet${t.low.length ? `; low: ${t.low.join(', ')}` : ''})`)
}
await shot('concrete-roof')
await menu()
await p.click('#roof-style-tile')
await p.keyboard.press('Escape')

// --- A door with a sensor does not open for a walker (user request: "if a sensor is bound to a door, it will not open even when a
// person comes next to it, it will open only if the sensor is on"); an interior door without a sensor opens ---
{
  await setLevel(plan.l0)
  const doors = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const l = s.layout.levels.find((x) => x.id === s.levelId)
    const sensorOf = (d) => [d.entityId, ...(d.extras ?? [])].filter(Boolean).find((id) => id.startsWith('binary_sensor.') && /door|opening/.test(window.__homescape.entity(id)?.attributes?.device_class ?? ''))
    const withSensor = l.items.find((d) => d.kind === 'door' && sensorOf(d))
    const plain = l.items.find((d) => d.kind === 'door' && !d.entityId && !(d.extras ?? []).length && d !== withSensor)
    return { s: withSensor && { x: withSensor.x, z: withSensor.z, rot: withSensor.rot, sensor: sensorOf(withSensor) }, p: plain && { x: plain.x, z: plain.z, rot: plain.rot } }
  })
  if (doors.s) await p.evaluate((id) => {
    const e = window.__homescape.entity(id)
    window.__homescape.setEntity({ ...e, state: 'off' })
  }, doors.s.sensor)
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.waitForTimeout(600)
  const walkTo = async (d) => {
    // Walk toward the door from 1.6 m behind its inner side (facing the door: forward (-sin, -cos))
    const sx = d.x + Math.sin(d.rot) * 1.6
    const sz = d.z + Math.cos(d.rot) * 1.6
    await H('fpsTeleport', sx, sz, d.rot, 0)
    await p.waitForTimeout(300)
    await p.keyboard.down('KeyW')
    await p.waitForTimeout(700)
    await p.keyboard.up('KeyW')
    await p.waitForTimeout(200)
    return H('doorTraffic')
  }
  const key = (d) => `${d.x.toFixed(2)},${d.z.toFixed(2)}`
  const openS = doors.s ? await walkTo(doors.s) : []
  const openP = doors.p ? await walkTo(doors.p) : []
  ok(Boolean(doors.s) && !openS.includes(key(doors.s)), `A door with a bound door sensor does not open when someone comes next to it (sensor off; doors that opened ${JSON.stringify(openS)})`)
  ok(Boolean(doors.p) && openP.includes(key(doors.p)), 'An interior door without a sensor opens when someone comes next to it')
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
}

// --- U-shaped stairs with walls (GitHub issue #10): two flights and a half landing, the stairwell open on the arrival half,
// side walls that block walking and hold items ---
{
  await setLevel(plan.l0)
  await p.waitForTimeout(300)
  // The sample home's stairs become U-shaped (turning right on the landing) with a wall on the left, in the middle of the foyer
  const Ux = S.x + 0.94
  await p.evaluate(({ id, x }) => window.__homescape.getState().layout.updateItem(id, { x, variant: 'uRight', len: 2.1, len2: 2.6, walls: 'left' }), { id: S.id, x: Ux })
  await p.waitForTimeout(600)
  const m = await p.evaluate(async (id) => {
    const st = await import('/src/model/stairs.ts')
    const sw = await import('/src/model/stairwell.ts')
    const geo = await import('/src/model/geometry.ts')
    const fps = await import('/src/scene/fps.ts')
    const pets = await import('/src/model/pets.ts')
    const s = window.__homescape.getState().layout
    const lv = s.layout.levels.find((l) => (l.elevation ?? 0) === 0)
    const up = s.layout.levels.find((l) => (l.elevation ?? 0) === 1)
    const it = lv.items.find((i) => i.id === id)
    const at = (lx, lz) => ({ x: it.x + lx * Math.cos(it.rot) + lz * Math.sin(it.rot), z: it.z - lx * Math.sin(it.rot) + lz * Math.cos(it.rot) })
    const h = (lx, lz) => st.stairsHeightLocal(it, lx, lz)
    const heights = [h(-0.55, 1.25), h(-0.55, 0.5), h(0.3, -0.8), h(0.55, -0.25), h(0.55, 1.25)].map((v) => Math.round(v * 100) / 100)
    const well = sw.stairwellsOf(s.layout.levels, up).find((w) => w.id === id)
    const rails = well ? sw.railEdges(well, []) : []
    const railLen = rails.reduce((a, e) => a + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), 0)
    const perimeter = well ? 2 * (well.r.w + well.r.d) : 0
    const segs = st.stairsSegments(lv.items)
    const coll = fps.buildColliders(lv).segs.length - fps.buildColliders({ ...lv, items: lv.items.map((i) => (i.id === id ? { ...i, walls: undefined } : i)) }).segs.length
    const wallPt = at(-(1.05 + 0.05), 0)
    const grid = pets.buildPetGrid(lv, 'cat')
    const blocked = !pets.isFree(grid, wallPt.x, wallPt.z)
    // A bookshelf brought near the wall's outer face sticks to it, facing away from the stairs
    const runs = st.stairsWallRuns(lv.items)
    const out = at(-(1.05 + 0.4), 0.2)
    const snap = geo.wallSnap(lv.rooms, out.x, out.z, 0.35, 0.6, 1.2, false, false, undefined, runs)
    return { heights, open: Boolean(well?.openSeg), railShare: perimeter ? railLen / perimeter : 0, segs: segs.length, coll, blocked, runs: runs.length, snap, face: at(-(1.05 + 0.1 + 0.175 + 0.01), 0.2) }
  }, S.id)
  ok(m.heights[0] < 0.2 && Math.abs(m.heights[2] - 1.4) < 0.01 && m.heights[3] > 1.35 && m.heights[3] < 1.6 && m.heights[4] > 2.6, `U stairs: the first flight climbs to the landing at half height, the second flight on to the floor above (${m.heights.join(' / ')} m)`)
  ok(m.open && m.railShare > 0.8 && m.railShare < 0.95, `The stairwell of U stairs is open only on the arrival half of its edge; railings on the rest (${Math.round(m.railShare * 100)}% of the edge)`)
  ok(m.segs === 2 && m.coll === 1 && m.blocked, `The spine between the flights and the side wall block walking and the pets (${m.segs} segments, the wall adds ${m.coll} collider, wall cell blocked ${m.blocked})`)
  ok(m.runs === 1 && m.snap && Math.hypot(m.snap.x - m.face.x, m.snap.z - m.face.z) < 0.03, `Items stick to the outer face of the stairs' wall (${m.runs} wall, snapped ${m.snap ? `${m.snap.x.toFixed(2)}, ${m.snap.z.toFixed(2)}` : 'no'})`)

  // Walk: up the first flight to the landing, then on the landing turn and climb the second flight to the upper floor
  const at = (lx, lz) => ({ x: Ux + lx * Math.cos(S.rot) + lz * Math.sin(S.rot), z: S.z - lx * Math.sin(S.rot) + lz * Math.cos(S.rot) })
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.waitForTimeout(600)
  const a0 = at(-0.55, 1.7)
  await H('fpsTeleport', a0.x, a0.z, S.rot, 0)
  await p.waitForTimeout(400)
  // Walk until the height reaches the landing (half a floor), then stop: further on is the landing's back edge
  await p.keyboard.down('KeyW')
  let onLanding = await H('fps')
  for (let t = 0; t < 3000 && onLanding.h < 1.35; t += 80) {
    await p.waitForTimeout(80)
    onLanding = await H('fps')
  }
  await p.keyboard.up('KeyW')
  ok(onLanding.h > 1.35 && onLanding.h < 1.45, `Walking up the first flight reaches the landing (height ${onLanding.h.toFixed(2)} m)`)
  const b0 = at(0.55, -0.7)
  await H('fpsTeleport', b0.x, b0.z, S.rot + Math.PI, 0)
  await p.waitForTimeout(400)
  await p.keyboard.down('KeyW')
  let upU = false
  for (let t = 0; t < 3500 && !upU; t += 100) {
    await p.waitForTimeout(100)
    upU = (await p.evaluate(() => window.__homescape.getState().layout.levelId)) === plan.l1
  }
  await p.waitForTimeout(400)
  await p.keyboard.up('KeyW')
  ok(upU, 'Walking up the second flight of U stairs reaches the upper floor')
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
  // Pictures from above: the lower floor (stairs with the wall) and the upper floor (the stairwell and its railing)
  await setLevel(plan.l0)
  await H('focusRoom', plan.hall ? (await p.evaluate(() => window.__homescape.getState().layout.layout.levels.find((l) => (l.elevation ?? 0) === 0).rooms.find((r) => r.name && r.x <= 0.5 && r.x + r.w >= 0.5 && r.z <= 7.2 && r.z + r.d >= 7.2)?.id)) : null)
  await p.waitForTimeout(1500)
  await shot('stairs-u-lower')
  await setLevel(plan.l1)
  await H('focusRoom', plan.hall)
  await p.waitForTimeout(1500)
  await shot('stairs-u-upper')
}

// --- L-shaped stairs: a straight flight, a 90° turn (flat landing or winders) anywhere along the climb, then an optional
// second flight; the step counts set the size, the stairwell is L-shaped, the space below the steps stays free ---
{
  await setLevel(plan.l0)
  await p.waitForTimeout(300)
  // Back where the sample home has its stairs (the U test moved them), without walls
  await p.evaluate(({ id, x }) => window.__homescape.getState().layout.updateItem(id, { x, walls: undefined }), { id: S.id, x: S.x })
  const m = await p.evaluate(async (id) => {
    const st = await import('/src/model/stairs.ts')
    const sw = await import('/src/model/stairwell.ts')
    // The store's state is replaced on every change: read it fresh
    const S0 = () => window.__homescape.getState().layout
    const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100)
    const lv = () => S0().layout.levels.find((l) => (l.elevation ?? 0) === 0)
    const up = () => S0().layout.levels.find((l) => (l.elevation ?? 0) === 1)
    const it = () => lv().items.find((i) => i.id === id)
    // Winders: 16 steps, 10 straight treads, 5 winders turning right, nothing after the turn (1 x 3.7 m)
    const wind = { variant: 'lRight', steps: 16, cornerSteps: 5, stepsAfter: 0, walls: undefined }
    const sizeW = st.lStairsSize(wind)
    S0().updateItem(id, { ...wind, ...sizeW })
    const w = it()
    const hw = (lx, lz) => r2(st.stairsHeightLocal(w, lx, lz))
    const winders = { size: sizeW, foot: hw(0, 1.8), top1: hw(0, -0.8), entry: hw(-0.3, -0.9), exit: hw(0.4, -1.75), arrive: hw(0.55, -1.4), corner: hw(0.9, 0.5) }
    const wellW = sw.stairwellsOf(S0().layout.levels, up()).find((x) => x.id === id)
    // Flat landing: 14 steps, 3 treads after the turn turning left (1.81 x 3.43 m)
    const flat = { variant: 'lLeft', steps: 14, cornerSteps: 1, stepsAfter: 3 }
    const sizeF = st.lStairsSize(flat)
    S0().updateItem(id, { ...flat, ...sizeF })
    const f = it()
    const g = st.lLayout(f)
    const hf = (lx, lz) => r2(st.stairsHeightLocal(f, lx, lz))
    const landing = { size: sizeF, a: hf(g.fx - 0.3, -g.l / 2 + 0.2), b: hf(g.fx + 0.3, -g.l / 2 + 0.8), h2: r2(g.h2), arrive: hf(-g.w / 2 + 0.02, -g.l / 2 + 0.5), empty: hf(g.sT * (g.w / 2 - 0.3), g.l / 2 - 0.3) }
    const wellF = sw.stairwellsOf(S0().layout.levels, up()).find((x) => x.id === id)
    const rails = wellF ? sw.railEdges(wellF, []) : []
    return { winders, wellW: wellW?.parts?.length ?? 0, landing, wellF: wellF?.parts?.length ?? 0, holes: wellF ? sw.holeRects(wellF).length : 0, rails: rails.length }
  }, S.id)
  const W = m.winders
  ok(Math.abs(W.size.len - 1) < 0.01 && Math.abs(W.size.len2 - 3.7) < 0.01, `L stairs: the step counts set the size (16 steps, 5 winders: ${W.size.len} x ${W.size.len2} m)`)
  ok(W.foot < 0.2 && Math.abs(W.top1 - 1.75) < 0.05 && W.entry < W.exit && W.entry >= 1.7 && W.exit > 2.4 && W.arrive > 2.7 && W.corner === null, `L stairs with winders: the straight flight, then the winders rise with the turn up to the floor above (${W.foot} / ${W.top1} / ${W.entry} / ${W.exit} / ${W.arrive} m)`)
  ok(m.wellW === 1, `Without steps after the turn the stairwell is the flight's strip only (${m.wellW} part)`)
  const L = m.landing
  ok(Math.abs(L.a - L.b) < 0.01 && Math.abs(L.a - L.h2) < 0.01 && L.arrive > 2.6 && L.empty === null, `L stairs with a flat landing: flat corner at ${L.a} m, the second flight on to the floor above (${L.arrive} m), the corner beside the flight is free`)
  ok(m.wellF === 2 && m.holes === 2 && m.rails >= 4, `The stairwell of L stairs is L-shaped (${m.holes} rectangles) with railings around it (${m.rails} edges)`)
  // Walk up the winder stairs: from the foot of the flight to the corner, then toward the turn side to the upper floor
  await p.evaluate((id) => {
    const s = window.__homescape.getState().layout
    s.updateItem(id, { variant: 'lRight', steps: 16, cornerSteps: 5, stepsAfter: 0, len: 1, len2: 3.7 })
  }, S.id)
  await p.waitForTimeout(500)
  const atL = (lx, lz) => ({ x: S.x + lx * Math.cos(S.rot) + lz * Math.sin(S.rot), z: S.z - lx * Math.sin(S.rot) + lz * Math.cos(S.rot) })
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.waitForTimeout(600)
  const c0 = atL(0, 2.1)
  await H('fpsTeleport', c0.x, c0.z, S.rot, 0)
  await p.waitForTimeout(400)
  await p.keyboard.down('KeyW')
  let top = await H('fps')
  for (let t = 0; t < 3000 && top.h < 1.6; t += 80) {
    await p.waitForTimeout(80)
    top = await H('fps')
  }
  await p.keyboard.up('KeyW')
  ok(top.h >= 1.6, `Walking up the straight flight of L stairs reaches the turn (height ${top.h.toFixed(2)} m)`)
  const c1 = atL(-0.1, -1.6)
  await H('fpsTeleport', c1.x, c1.z, S.rot - Math.PI / 2, 0)
  await p.waitForTimeout(400)
  await p.keyboard.down('KeyW')
  let upL = false
  for (let t = 0; t < 3500 && !upL; t += 100) {
    await p.waitForTimeout(100)
    upL = (await p.evaluate(() => window.__homescape.getState().layout.levelId)) === plan.l1
  }
  await p.waitForTimeout(400)
  await p.keyboard.up('KeyW')
  ok(upL, 'Walking up the winders of L stairs reaches the upper floor')
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
  await setLevel(plan.l0)
  await p.waitForTimeout(300)
}

// --- Cleanup ---
await p.evaluate(
  ([prevId, id]) => {
    const s = window.__homescape.getState().layout
    s.switchHome(prevId)
    s.deleteHome(id)
  },
  [prev, usId],
)
await p.waitForTimeout(600)
ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
