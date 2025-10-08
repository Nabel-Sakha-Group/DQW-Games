"use client"

// Core canvas game: Pick & Place with conveyor and targets.
// Controls: Arrow/WASD + Space on desktop; on-screen buttons on mobile.

import { useEffect, useRef, useState, useCallback } from "react"
import { HUD } from "./hud"
import MobileControls from "./mobile-controls"
import DesktopControls from "./desktop-controls"
import { useMediaQuery } from "@/components/ui/use-mobile" // returns boolean for mobile width

type ItemType = "bottle" | "pcb" | "glass" | "box"

type Item = {
  id: number
  type: ItemType
  x: number
  y: number
  w: number
  h: number
  vx: number
  grabbed?: boolean
  vy?: number
  landingY?: number
  landingTarget?: Target | null
  landingEvaluated?: boolean
  rotation?: number // Add rotation property for visual effects
}

type Target = {
  type: ItemType
  label: string
  x: number
  y: number
  w: number
  h: number
}

type Lifter = {
  x: number
  y: number
  w: number
  h: number
  speed: number
  vacuum: boolean
  holding?: Item | null
}

type GameState = {
  score: number
  timeLeft: number
  paused: boolean
}

const GAME_SECONDS = 60
const SPAWN_INTERVAL_MIN = 700
const SPAWN_INTERVAL_MAX = 1400
// Visual tuning for how held items attach under the gripper
// Keep the item essentially pinned to the pad bottom (tiny gap to avoid z-fighting)
const ATTACH_GAP = 2  // along the gripper axis (downwards)
const ATTACH_SIDE = -8 // no perpendicular nudge; stick right under the pad center
// Sway tuning (reduce over animation)
const MAX_SWAY_ANGLE = 0.18 // ~10.3 degrees
const SWAY_FOLLOW = 0.12    // how fast the top anchor catches up to center (higher = less sway)
// Fine-tune contact point on the gripper image (as a fraction of head size)
const PAD_SIDE_FRAC = 0.12  // stronger horizontal shift to align with pad center
const PAD_DOWN_FRAC = 0.00  // no extra down push beyond ATTACH_GAP

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export default function GameBoard({ onGameOver }: { onGameOver?: (score: number) => void }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const lifterImgRef = useRef<HTMLImageElement | null>(null) // will load gripper.svg
  const pipeImgRef = useRef<HTMLImageElement | null>(null)

  const isMobile = useMediaQuery()

  // HUD state (decoupled from internal refs to avoid excessive re-render)
  const [hud, setHud] = useState<GameState & { holding?: string | null }>(
    { score: 0, timeLeft: GAME_SECONDS, paused: true, holding: null }
  )
  const [started, setStarted] = useState(false)

  // State for keyboard visual feedback
  const [keyStates, setKeyStates] = useState<{ [k: string]: boolean }>({
    up: false,
    down: false,
    left: false,
    right: false,
  })
  const [vacuumState, setVacuumState] = useState(false)

  // Internal refs for mutable game data
  const lifterRef = useRef<Lifter>({
    x: 120,
    y: 80,
    w: 96,
    h: 56,
    speed: 300,
    vacuum: false,
    holding: null,
  })
  const itemsRef = useRef<Item[]>([])
  const targetsRef = useRef<Target[]>([])
  const keysRef = useRef<{ [k: string]: boolean }>({})
  const conveyorRef = useRef<{ y: number; speed: number }>({ y: 0, speed: 150 })
  const lastSpawnRef = useRef<number>(0)
  const nextSpawnDelayRef = useRef<number>(1500)
  const gameRef = useRef<GameState>({ score: 0, timeLeft: GAME_SECONDS, paused: true })
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number>(0)
  const gameOverFiredRef = useRef(false)
  const scaledRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 })
  const resizeRafRef = useRef<number | null>(null) // rAF id untuk debounce ResizeObserver
  const lifterTargetRef = useRef<{ x: number; y: number }>({ x: 120, y: 80 })
  const lifterVelRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 })
  const anchorXRef = useRef<number>(140) // top source x; eases towards gripper center

  // Spawn a random item with guaranteed spacing to prevent stacking at start
  const spawnItem = useCallback(() => {
    const conveyor = conveyorRef.current
    const types: ItemType[] = ["bottle", "pcb", "glass", "box"]

    // Compute a spawn X that guarantees a minimum gap from existing items (avoid stacking)
    const computeSpawnXLeft = (newWidth: number) => {
      const BASE_GAP = Math.max(60, Math.floor(newWidth * 1.5)) // ensure at least 1.5x width gap
      const existing = itemsRef.current.filter((i) => !i.grabbed)
      if (existing.length === 0) return -newWidth - 20
      const leftmostX = existing.reduce((min, i) => Math.min(min, i.x), Infinity)
      return Math.min(-newWidth - 20, leftmostX - newWidth - BASE_GAP)
    }

    const makeOne = () => {
      const type = types[Math.floor(Math.random() * types.length)]
      const size = getSizeFor(type)
      const x = computeSpawnXLeft(size.w) // always from left moving right
      const it: Item = {
        id: Math.floor(Math.random() * 1e9),
        type,
        x,
        y: conveyor.y - size.h - 4,
        w: size.w,
        h: size.h,
        vx: conveyor.speed,
        rotation: 0,
      }
      itemsRef.current.push(it)
    }

    makeOne()
    // 35% chance to add one more, still spaced using computeSpawnXLeft
    if (Math.random() < 0.35) makeOne()
  }, [])

  // Define callback functions first
  const toggleVacuum = useCallback(() => {
    const lifter = lifterRef.current
    const g = gameRef.current
    if (g.paused || g.timeLeft <= 0) return

    lifter.vacuum = !lifter.vacuum
    setVacuumState(lifter.vacuum)

    if (!lifter.vacuum && lifter.holding) {
      const dropped = lifter.holding
      lifter.holding = null
      dropped.grabbed = false
      dropped.rotation = 0 // Reset rotation when dropped
      dropped.vx = 0
      dropped.vy = 0

      const { bottomX } = getHeadGeo()
      const cx = bottomX // drop vertical alignment

      // find target directly below drop x (horizontal containment)
      const t = targetsRef.current.find((t) => cx >= t.x && cx <= t.x + t.w)
      if (t) {
        dropped.landingY = t.y - dropped.h
        dropped.landingTarget = t
      } else {
        // fall to conveyor and then continue
        dropped.landingY = conveyorRef.current.y - dropped.h
        dropped.landingTarget = null
      }
      dropped.landingEvaluated = false
    }
  }, [])

  // Pause removed entirely per requirement

  

  const startGame = useCallback(() => {
    // fresh start
    itemsRef.current = []
    lifterRef.current.holding = null
    lifterRef.current.vacuum = false
    keysRef.current = {}
    gameRef.current = { score: 0, timeLeft: GAME_SECONDS, paused: false }
    setVacuumState(false)
    setHud({ score: 0, timeLeft: GAME_SECONDS, paused: false, holding: null })
    setStarted(true)
    gameOverFiredRef.current = false
    // spawn a couple items immediately so conveyor isn't empty
    spawnItem()
    if (Math.random() < 0.6) spawnItem()
    lastSpawnRef.current = performance.now()
    nextSpawnDelayRef.current = rand(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
  }, [spawnItem])

  // Load images once
  useEffect(() => {
    const bg = new Image()
    bg.crossOrigin = "anonymous"
    bg.src = "/images/BG.svg"
    bgImgRef.current = bg

    const gripper = new Image()
    gripper.crossOrigin = "anonymous"
    gripper.src = "/images/GRIPPER.svg"
    lifterImgRef.current = gripper

    const tube = new Image()
    tube.crossOrigin = "anonymous"
    tube.src = "/images/PIPA.svg"
    pipeImgRef.current = tube
  }, [])

  // Resize canvas responsively
  useEffect(() => {
    const el = wrapperRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return

    const onResize = () => {
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = requestAnimationFrame(() => {
        const bounds = el.getBoundingClientRect()
        let w = Math.floor(bounds.width)
        let h = Math.floor((w * 9) / 16)
        const viewportH = window.innerHeight
        // On mobile, keep a slightly smaller height cap so overall scale fits better
        const maxH = Math.floor(viewportH * (isMobile ? 0.7 : 0.62))
        if (h > maxH) {
          h = maxH
          w = Math.floor((h * 16) / 9)
        }
        const dpr = Math.min(2, window.devicePixelRatio || 1)

        // Guard: hanya update bila berbeda
        const prev = scaledRef.current
        if (prev.w === w && prev.h === h && prev.dpr === dpr) return

        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
        scaledRef.current = { w, h, dpr }

        // Setup ulang layout berdasarkan ukuran baru
        setupLevel()
      })
    }

    const ro = new ResizeObserver(onResize)
    ro.observe(el)

    // trigger pertama via rAF agar sinkron dengan layout pass browser
    onResize()

    return () => {
      ro.disconnect()
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current)
    }
  }, [isMobile])

  // Setup targets based on size
  function setupLevel() {
    const { w, h } = scaledRef.current
    conveyorRef.current.y = Math.floor(h * 0.72)

    // On small screens, allow smaller minima so assets don't look oversized
    const smallScreen = w < 500
    const targetW = Math.max(smallScreen ? 72 : 100, Math.floor(w * 0.12))
    const targetH = Math.max(smallScreen ? 40 : 50, Math.floor(h * 0.09))
    const baseY = Math.floor(h * 0.32)

    targetsRef.current = [
      {
        type: "bottle",
        label: "Bottle Crate",
        x: Math.floor(w * 0.22) - targetW / 2,
        y: baseY,
        w: targetW,
        h: targetH,
      },
      { type: "pcb", label: "PCB Tray", x: Math.floor(w * 0.46) - targetW / 2, y: baseY, w: targetW, h: targetH },
      { type: "glass", label: "Glass Rack", x: Math.floor(w * 0.65) - targetW / 2, y: baseY, w: targetW, h: targetH },
      { type: "box", label: "Pallet (Box)", x: Math.floor(w * 0.84) - targetW / 2, y: baseY, w: targetW, h: targetH },
    ]

    // Reset lifter bounds a bit below the top
  const gripW = Math.max(smallScreen ? 56 : 72, Math.floor(w * 0.09))
    const gripH = Math.floor(gripW * 0.43)
    lifterRef.current.w = gripW
    lifterRef.current.h = gripH
    lifterRef.current.y = Math.floor(h * 0.12)
    lifterRef.current.x = Math.floor(w * 0.14)
    lifterTargetRef.current = { x: lifterRef.current.x, y: lifterRef.current.y }
    anchorXRef.current = lifterRef.current.x + lifterRef.current.w / 2
  }

  // Keyboard controls
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore keyboard when typing into inputs/textareas/contentEditable
      const t = e.target as HTMLElement | null
      const isEditable = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable === true)
      if (isEditable) {
        return
      }
      const k = e.key.toLowerCase()
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) {
        e.preventDefault()
      }
      if (k === " ") {
        toggleVacuum()
      } else if (k === "arrowleft" || k === "a") {
        keysRef.current.left = true
        setKeyStates(prev => ({ ...prev, left: true }))
      } else if (k === "arrowright" || k === "d") {
        keysRef.current.right = true
        setKeyStates(prev => ({ ...prev, right: true }))
      } else if (k === "arrowup" || k === "w") {
        keysRef.current.up = true
        setKeyStates(prev => ({ ...prev, up: true }))
      } else if (k === "arrowdown" || k === "s") {
        keysRef.current.down = true
        setKeyStates(prev => ({ ...prev, down: true }))
  }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const isEditable = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable === true)
      if (isEditable) {
        return
      }
      const k = e.key.toLowerCase()
      if (k === "arrowleft" || k === "a") {
        keysRef.current.left = false
        setKeyStates(prev => ({ ...prev, left: false }))
      } else if (k === "arrowright" || k === "d") {
        keysRef.current.right = false
        setKeyStates(prev => ({ ...prev, right: false }))
      } else if (k === "arrowup" || k === "w") {
        keysRef.current.up = false
        setKeyStates(prev => ({ ...prev, up: false }))
      } else if (k === "arrowdown" || k === "s") {
        keysRef.current.down = false
        setKeyStates(prev => ({ ...prev, down: false }))
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [toggleVacuum])

  // Game loop
  useEffect(() => {
    let running = true
    const loop = (ts: number) => {
      if (!running) return
      rafRef.current = requestAnimationFrame(loop)

      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return

      const dpr = scaledRef.current.dpr
      const width = canvas.width / dpr
      const height = canvas.height / dpr

      const lastTs = lastTsRef.current || ts
      let dt = (ts - lastTs) / 1000
      dt = Math.min(dt, 0.04) // clamp delta for stability
      lastTsRef.current = ts

      const g = gameRef.current
      if (!g.paused && g.timeLeft > 0) {
        g.timeLeft -= dt
        update(dt)
      }

      // fire game over once
      if (!gameOverFiredRef.current && g.timeLeft <= 0) {
        gameOverFiredRef.current = true
        onGameOver?.(g.score)
      }

      draw(ctx, width, height, dpr)

      // Update HUD at a throttled cadence
      if (Math.floor(ts / 120) !== Math.floor(lastTs / 120)) {
        setHud({
          score: g.score,
          timeLeft: g.timeLeft,
          paused: g.paused,
          holding: lifterRef.current.holding?.type || null,
        })
      }
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      running = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update simulation
  function update(dt: number) {
    const { w, h } = scaledRef.current
    const lifter = lifterRef.current
    const conveyor = conveyorRef.current
    const items = itemsRef.current

    // Move lifter
    const dirX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0)
    const dirY = (keysRef.current.down ? 1 : 0) - (keysRef.current.up ? 1 : 0)
    lifterTargetRef.current.x += dirX * lifter.speed * dt
    lifterTargetRef.current.y += dirY * lifter.speed * dt
    lifterTargetRef.current.x = clamp(lifterTargetRef.current.x, 10, w - lifter.w - 10)
    lifterTargetRef.current.y = clamp(lifterTargetRef.current.y, 10, conveyor.y - lifter.h - 10)

    // critically-damped-ish spring
    const k = 12 // stiffness
    const d = 7 // damping
    const vel = lifterVelRef.current
    const dx = lifterTargetRef.current.x - lifter.x
    const dy = lifterTargetRef.current.y - lifter.y
    const ax = k * dx - d * vel.vx
    const ay = k * dy - d * vel.vy
    vel.vx += ax * dt
    vel.vy += ay * dt
    lifter.x += vel.vx * dt
    lifter.y += vel.vy * dt

  // anchor (top tube source) eases toward gripper center to simulate sway
  const desiredAnchor = lifter.x + lifter.w / 2
  anchorXRef.current += (desiredAnchor - anchorXRef.current) * SWAY_FOLLOW

    // Spawn items
    const now = performance.now()
    if (now - lastSpawnRef.current >= nextSpawnDelayRef.current) {
      spawnItem()
      lastSpawnRef.current = now
      nextSpawnDelayRef.current = rand(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
    }

    // Move items along conveyor OR animate drop with gravity
    for (const it of items) {
      if (!it.grabbed) {
        if (typeof it.landingY === "number") {
          const gAcc = Math.max(900, Math.floor(h * 2.0)) // gravity px/s^2 scaled by canvas
          it.vy = (it.vy ?? 0) + gAcc * dt
          it.y += (it.vy ?? 0) * dt
          // no horizontal motion while dropping
          it.vx = 0

          if (it.y >= it.landingY) {
            it.y = it.landingY
            it.vy = 0
            // Evaluate landing once
            if (!it.landingEvaluated) {
              it.landingEvaluated = true
              const g = gameRef.current
              if (it.landingTarget) {
                // landed on a target -> score then remove
                if (it.landingTarget.type === it.type) {
                  g.score += 100
                } else {
                  g.score -= 50
                }
                const idx = itemsRef.current.findIndex((i) => i.id === it.id)
                if (idx >= 0) itemsRef.current.splice(idx, 1)
              } else {
                // landed on conveyor -> rejoin belt
                it.landingY = undefined
                it.landingTarget = null
                it.landingEvaluated = false
                it.rotation = 0 // Reset rotation when landing on conveyor
                it.vx = conveyor.speed * (it.x < 0 ? 1 : 1) // keep forward left->right
              }
            }
          }
        } else {
          // normal conveyor move
          it.x += it.vx * dt
        }
      }
    }

    // Lifter pick/drop logic: if vacuum on and not holding, grab nearest item within reach
    if (lifter.vacuum && !lifter.holding) {
      let nearest: Item | null = null
      let bestDist = 36
      for (const it of items) {
        if (it.grabbed) continue
        const cx = it.x + it.w / 2
        const cy = it.y + it.h / 2
        const d = Math.hypot(lifter.x + lifter.w / 2 - cx, lifter.y - cy)
        if (d < bestDist) {
          bestDist = d
          nearest = it
        }
      }
      if (nearest) {
        nearest.grabbed = true
        lifter.holding = nearest
      }
    }

    // If holding, attach item to head (align top-center of item to suction pad bottom)
    if (lifter.holding) {
      // Use the same calculation as vacuum glow for consistency
      const { bottomX, bottomY, angle } = getHeadGeo()

      // We draw grabbed items rotated around their center.
      // To make TOP-CENTER of the item sit exactly at the gripper bottom (with a small gap),
      // compute the item's center from the gripper bottom using rotation math.
  const sinA = Math.sin(angle)
  const cosA = Math.cos(angle)
  const gap = ATTACH_GAP + lifter.h * PAD_DOWN_FRAC
  const sideNudge = ATTACH_SIDE + lifter.w * PAD_SIDE_FRAC

  // Desired top-center point of the item in world coords:
  // move a small gap further along the gripper's downward axis (local +y -> -sinA, cosA)
  // plus optional perpendicular nudge along local +x (cosA, sinA)
  const topCx = bottomX - gap * sinA + sideNudge * cosA
  const topCy = bottomY + gap * cosA + sideNudge * sinA

      // For a rectangle rotated by angle around its center, the world position of the
      // top-center (relative (0, -h/2)) is:
      //   (cx + (h/2)*sinA, cy - (h/2)*cosA)
      // So solve back to get the center (cx, cy):
  const halfH = lifter.holding.h / 2
  // Center is obtained by moving from the top point along the item's local +y (down) by h/2
  // In world space, local +y maps to (-sinA, cosA)
  const cx = topCx - halfH * sinA
  const cy = topCy + halfH * cosA

      lifter.holding.x = cx - lifter.holding.w / 2
      lifter.holding.y = cy - lifter.holding.h / 2
  lifter.holding.rotation = angle // match gripper sway
      lifter.holding.vx = 0
      lifter.holding.vy = 0
      lifter.holding.landingY = undefined
      lifter.holding.landingTarget = null
      lifter.holding.landingEvaluated = false
    }

    // Despawn items off screen
    const margin = 40
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      // Despawn only when completely off-screen to the left or right
      if (!it.grabbed && (it.x > w + margin || it.x < -it.w - margin)) {
        items.splice(i, 1)
      }
    }
  }

  // Restart function removed per requirement

  

  function getSizeFor(type: ItemType) {
    const { w } = scaledRef.current
    const smallScreen = w < 500
    // Slightly smaller base on small screens
    const base = Math.max(smallScreen ? 20 : 26, Math.floor(w * (smallScreen ? 0.028 : 0.03)))
    switch (type) {
      case "bottle":
        return { w: base * 0.9, h: base * 1.8 }
      case "pcb":
        return { w: base * 1.8, h: base * 0.9 }
      case "glass":
        return { w: base * 1.6, h: base * 1.1 }
      case "box":
        return { w: base * 1.2, h: base * 1.2 }
    }
  }

  function rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  // Drawing
  function draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    // Background
    if (bgImgRef.current && bgImgRef.current.complete) {
      ctx.drawImage(bgImgRef.current, 0, 0, width, height)
    } else {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--background") || "#f5f5f5"
      ctx.fillRect(0, 0, width, height)
    }

    // Conveyor belt
    const beltY = conveyorRef.current.y
    const beltH = Math.floor(height * 0.05)
    ctx.fillStyle = "#6b7280" // neutral gray for belt surface
    ctx.fillRect(0, beltY, width, beltH)
    // belt arrows
    ctx.fillStyle = "#d1d5db"
    const segW = 22
    for (let x = 0; x < width; x += segW) {
      ctx.beginPath()
      ctx.moveTo(x + 6, beltY + beltH / 2)
      ctx.lineTo(x + 14, beltY + beltH / 2 - 6)
      ctx.lineTo(x + 14, beltY + beltH / 2 + 6)
      ctx.closePath()
      ctx.fill()
    }

    // Targets shelf
    drawTargetsShelf(ctx, width)

    // Targets
    for (const t of targetsRef.current) {
      drawTarget(ctx, t)
    }

    // Conveyor pipe
    const lifter = lifterRef.current
  const anchorX = anchorXRef.current
  const tubeLen = Math.max(10, lifter.y)
  const cx = lifter.x + lifter.w / 2
  const rawAngle = Math.atan2(cx - anchorX, tubeLen)
  const angle = clamp(rawAngle, -MAX_SWAY_ANGLE, MAX_SWAY_ANGLE)
    ctx.save()
    ctx.translate(anchorX, 0)
    ctx.rotate(angle)
    const pipeW = Math.max(32, Math.floor(width * 0.035))
    if (pipeImgRef.current && pipeImgRef.current.complete) {
      ctx.drawImage(pipeImgRef.current, -pipeW / 2, 0, pipeW, tubeLen)
    } else {
      ctx.fillStyle = "#0355a0"
      ctx.fillRect(-pipeW / 2, 0, pipeW, tubeLen)
    }
    ctx.restore()

    // Items (draw BEFORE gripper so the pad sits on top of the held item)
    for (const it of itemsRef.current) {
      drawItem(ctx, it)
    }

    // Lifter head
    ctx.save()
    ctx.translate(anchorX, 0)
    ctx.rotate(angle)
    const headW = lifter.w
    if (lifterImgRef.current && lifterImgRef.current.complete) {
      ctx.drawImage(lifterImgRef.current, -headW / 2, tubeLen - lifter.h, headW, lifter.h)
    } else {
      ctx.fillStyle = "#1f2937"
      ctx.fillRect(-headW / 2, tubeLen - lifter.h, headW, lifter.h)
    }
    ctx.restore()

    // Vacuum glow at suction area (bottom center of head, in world coords)
    const geo = getHeadGeo()
    ctx.fillStyle = lifter.vacuum ? "rgba(56,189,248,0.35)" : "rgba(15,23,42,0.12)"
    ctx.beginPath()
    ctx.ellipse(geo.bottomX, geo.bottomY, 18, 10, 0, 0, Math.PI * 2)
    ctx.fill()

    // Time over overlay
    if (gameRef.current.timeLeft <= 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)"
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = "#fff"
      ctx.font = "700 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText("Waktu Habis!", width / 2, height / 2 - 8)
      ctx.font = "600 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      ctx.fillText(`Skor: ${gameRef.current.score}`, width / 2, height / 2 + 24)
    }

    ctx.restore()
  }

  function drawTarget(ctx: CanvasRenderingContext2D, t: Target) {
    ctx.save()

    // base plate
    ctx.fillStyle = "rgba(31,41,55,0.06)"
    ctx.fillRect(t.x, t.y, t.w, t.h)

    switch (t.type) {
      case "bottle": {
        // crate
        const pad = Math.floor(t.w * 0.08)
        // wood frame
        ctx.fillStyle = "#8b5e34"
        ctx.fillRect(t.x + pad, t.y + pad, t.w - 2 * pad, t.h - 2 * pad)
        // holes
        ctx.fillStyle = "#3f2d1c"
        const cols = 4
        const rows = 2
        const cellW = (t.w - 2 * pad) / cols
        const cellH = (t.h - 2 * pad) / rows
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const cx = t.x + pad + i * cellW + cellW / 2
            const cy = t.y + pad + j * cellH + cellH / 2
            ctx.beginPath()
            ctx.ellipse(cx, cy, Math.min(cellW, cellH) * 0.22, Math.min(cellW, cellH) * 0.22, 0, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        break
      }
      case "pcb": {
        // tray
        const pad = Math.floor(t.w * 0.08)
        ctx.fillStyle = "#0b614b"
        ctx.fillRect(t.x + pad, t.y + pad, t.w - 2 * pad, t.h - 2 * pad)
        ctx.strokeStyle = "#34d399"
        ctx.lineWidth = 2
        // routing lines
        for (let i = 1; i <= 3; i++) {
          const y = t.y + pad + (i * (t.h - 2 * pad)) / 4
          ctx.beginPath()
          ctx.moveTo(t.x + pad + 6, y)
          ctx.lineTo(t.x + t.w - pad - 6, y)
          ctx.stroke()
        }
        // vias
        ctx.fillStyle = "#34d399"
        for (let i = 0; i < 6; i++) {
          const cx = t.x + pad + ((i + 1) * (t.w - 2 * pad)) / 7
          const cy = t.y + t.h / 2
          ctx.beginPath()
          ctx.arc(cx, cy, 3, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }
      case "glass": {
        // rack
        const pad = Math.floor(t.w * 0.08)
        ctx.strokeStyle = "#64748b"
        ctx.lineWidth = 4
        // vertical bars
        const bars = 6
        for (let i = 0; i <= bars; i++) {
          const x = t.x + pad + (i * (t.w - 2 * pad)) / bars
          ctx.beginPath()
          ctx.moveTo(x, t.y + pad)
          ctx.lineTo(x, t.y + t.h - pad)
          ctx.stroke()
        }
        // top/bottom rails
        ctx.beginPath()
        ctx.moveTo(t.x + pad, t.y + pad)
        ctx.lineTo(t.x + t.w - pad, t.y + pad)
        ctx.moveTo(t.x + pad, t.y + t.h - pad)
        ctx.lineTo(t.x + t.w - pad, t.y + t.h - pad)
        ctx.stroke()
        break
      }
      case "box": {
        // pallet
        const pad = Math.floor(t.w * 0.08)
        const slats = 4
        ctx.fillStyle = "#b97728"
        for (let i = 0; i < slats; i++) {
          const y = t.y + pad + (i * (t.h - 2 * pad)) / (slats - 1) - 6
          ctx.fillRect(t.x + pad, y, t.w - 2 * pad, 12)
        }
        ctx.fillStyle = "#8b5e34"
        const blockW = 16
        const blockH = 12
        for (let i = 0; i < 3; i++) {
          const bx = t.x + pad + (i * (t.w - 2 * pad - blockW)) / 2
          const by = t.y + t.h - pad - blockH
          ctx.fillRect(bx, by, blockW, blockH)
        }
        break
      }
    }

    // labels
    ctx.fillStyle = "#111827"
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    ctx.textAlign = "center"
    ctx.fillText(`for ${t.type.toUpperCase()}`, t.x + t.w / 2, t.y - 14)
    ctx.fillText(t.label, t.x + t.w / 2, t.y - 2)

    ctx.restore()
  }

  function drawItem(ctx: CanvasRenderingContext2D, it: Item) {
    ctx.save()

    if (typeof it.landingY === "number") {
      const shadowY = Math.min(it.y + it.h + 6, (it.landingY ?? it.y + it.h) + 6)
      ctx.fillStyle = "rgba(0,0,0,0.18)"
      ctx.beginPath()
      ctx.ellipse(it.x + it.w / 2, shadowY, Math.max(8, it.w * 0.45), 6, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // If grabbed: anchor drawing at the gripper bottom so it sticks to the pad
    if (it.grabbed) {
      const { bottomX, bottomY, angle } = getHeadGeo()
      const sinA = Math.sin(angle)
      const cosA = Math.cos(angle)
  const gap = ATTACH_GAP + lifterRef.current.h * PAD_DOWN_FRAC
  const sideNudge = ATTACH_SIDE + lifterRef.current.w * PAD_SIDE_FRAC
  const topCx = bottomX - gap * sinA + sideNudge * cosA
  const topCy = bottomY + gap * cosA + sideNudge * sinA
      // Place origin at the item's TOP-CENTER attached to the gripper
      ctx.translate(topCx, topCy)
      ctx.rotate(angle)
      // For grabbed items, draw relative to top-center at (0,0): top-left is (-w/2, 0)
    }

    switch (it.type) {
      case "bottle": {
        ctx.fillStyle = "#10b981" // green
        if (it.grabbed) {
          // body at top-center anchored
          ctx.fillRect(-it.w * 0.25, 0, it.w * 0.5, it.h)
          ctx.fillStyle = "#065f46"
          // neck slightly above top
          ctx.fillRect(-it.w * 0.1, -it.h * 0.2, it.w * 0.2, it.h * 0.2)
        } else {
          ctx.fillRect(it.x + it.w * 0.25, it.y, it.w * 0.5, it.h)
          ctx.fillStyle = "#065f46"
          ctx.fillRect(it.x + it.w * 0.4, it.y - it.h * 0.2, it.w * 0.2, it.h * 0.2)
        }
        break
      }
      case "pcb": {
        ctx.fillStyle = "#065f46"
        if (it.grabbed) {
          ctx.fillRect(-it.w / 2, 0, it.w, it.h)
          ctx.fillStyle = "#34d399"
          for (let i = 0; i < 4; i++) {
            ctx.beginPath()
            const circleX = -it.w / 2 + (i + 1) * (it.w / 5)
            const circleY = it.h / 2
            ctx.arc(circleX, circleY, 3, 0, Math.PI * 2)
            ctx.fill()
          }
        } else {
          ctx.fillRect(it.x, it.y, it.w, it.h)
          ctx.fillStyle = "#34d399"
          for (let i = 0; i < 4; i++) {
            ctx.beginPath()
            const circleX = it.x + (i + 1) * (it.w / 5)
            const circleY = it.y + it.h / 2
            ctx.arc(circleX, circleY, 3, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        break
      }
      case "glass": {
        ctx.fillStyle = "rgba(59,130,246,0.25)"
        if (it.grabbed) {
          ctx.fillRect(-it.w / 2, 0, it.w, it.h)
          ctx.strokeStyle = "rgba(37,99,235,0.6)"
          ctx.strokeRect(-it.w / 2, 0, it.w, it.h)
        } else {
          ctx.fillRect(it.x, it.y, it.w, it.h)
          ctx.strokeStyle = "rgba(37,99,235,0.6)"
          ctx.strokeRect(it.x, it.y, it.w, it.h)
        }
        break
      }
      case "box": {
        ctx.fillStyle = "#b45309"
        if (it.grabbed) {
          ctx.fillRect(-it.w / 2, 0, it.w, it.h)
          ctx.strokeStyle = "#92400e"
          ctx.strokeRect(-it.w / 2, 0, it.w, it.h)
          ctx.fillStyle = "#fbbf24"
          ctx.fillRect(-it.w / 2 + 6, it.h * 0.45, it.w - 12, 6) // tape across
        } else {
          ctx.fillRect(it.x, it.y, it.w, it.h)
          ctx.strokeStyle = "#92400e"
          ctx.strokeRect(it.x, it.y, it.w, it.h)
          ctx.fillStyle = "#fbbf24"
          ctx.fillRect(it.x + 6, it.y + it.h * 0.45, it.w - 12, 6)
        }
        break
      }
    }
    ctx.restore()
  }

  // Mobile controls handlers
  const handleDirChange = (dir: "left" | "right" | "up" | "down", pressed: boolean) => {
    keysRef.current[dir] = pressed
    setKeyStates(prev => ({ ...prev, [dir]: pressed }))
  }
  const handleVacuum = () => toggleVacuum()

  // Helper to compute head geometry in world space (anchor, angle, bottom point)
  function getHeadGeo() {
  const lifter = lifterRef.current
  const anchorX = anchorXRef.current
  const tubeLen = Math.max(10, lifter.y)
  const cx = lifter.x + lifter.w / 2
  const rawAngle = Math.atan2(cx - anchorX, tubeLen)
  const angle = clamp(rawAngle, -MAX_SWAY_ANGLE, MAX_SWAY_ANGLE)
    
    // Calculate the actual bottom position of the gripper
    // The gripper head starts at (tubeLen - lifter.h) and extends to tubeLen
    const gripperBottomLocal = tubeLen // The bottom edge of the gripper in local coordinates
    // Local +y maps to (-sinA, cosA) in world space (y downwards). Use that here.
    const sinA = Math.sin(angle)
    const cosA = Math.cos(angle)
    const bottomX = anchorX - sinA * gripperBottomLocal
    const bottomY = cosA * gripperBottomLocal
    
    return { anchorX, tubeLen, angle, bottomX, bottomY }
  }

  // Draw targets shelf
  function drawTargetsShelf(ctx: CanvasRenderingContext2D, width: number) {
    const targets = targetsRef.current
    if (!targets.length) return
    const minY = Math.min(...targets.map((t) => t.y))
    const maxH = Math.max(...targets.map((t) => t.h))
    const shelfY = minY + maxH + 6
    const boardH = 12

    // papan meja
    ctx.fillStyle = "#b97728"
    ctx.fillRect(Math.floor(width * 0.12), shelfY, Math.floor(width * 0.76), boardH)

    // kaki-kaki tepat di bawah tiap target
    ctx.fillStyle = "#8b5e34"
    for (const t of targets) {
      const legW = Math.max(6, Math.floor(t.w * 0.08))
      const legX = t.x + t.w / 2 - legW / 2
      const legH = 18
      ctx.fillRect(legX, shelfY + boardH, legW, legH)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
  <div className="mx-auto max-w-6xl rounded-lg border bg-background p-2 shadow-sm overflow-hidden">
        <div className="relative rounded-md overflow-hidden isolate">
          <canvas ref={canvasRef} className="block w-full rounded-md bg-background" />
          {/* Start overlay */}
          {!started && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-auto p-4">
              <button
                className="rounded-md bg-blue-600 text-white px-6 py-3 text-base font-semibold shadow hover:bg-blue-700 focus:outline-none"
                onClick={startGame}
              >
                Start Game
              </button>
            </div>
          )}
          <div className="pointer-events-none absolute left-2 right-2 top-2 z-10">
            <HUD
              score={hud.score}
              timeLeft={hud.timeLeft}
              holding={hud.holding}
            />
          </div>
        </div>
        
        {/* Show mobile controls below canvas on mobile */}
        {isMobile && (
          <div className="mt-2">
            <MobileControls onDirChange={handleDirChange} onVacuum={handleVacuum} />
          </div>
        )}
        
        {/* Show desktop controls below canvas on desktop */}
        {!isMobile && (
          <div className="mt-2 flex justify-center">
            <DesktopControls 
              keys={keyStates} 
              vacuum={vacuumState}
              onDirChange={handleDirChange}
              onVacuum={handleVacuum} 
            />
          </div>
        )}
        
        <div className="mt-3 text-xs opacity-70">
          {isMobile
            ? "Tips: Gunakan tombol kontrol untuk menggerakkan lifter. Tekan Vacuum untuk mengambil/melepas item."
            : "Tips: Gunakan Arrow Keys/WASD untuk gerak, Spacebar untuk Vacuum. Letakkan item di target yang sesuai."}
        </div>
      </div>
    </div>
  )
}
