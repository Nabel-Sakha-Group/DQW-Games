"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type Props = {
  onDirChange: (dir: "left" | "right" | "up" | "down", pressed: boolean) => void
  onVacuum: () => void
  overlay?: boolean
  vacuumActive?: boolean
}

function Joystick({ onVector }: { onVector: (dx: number, dy: number) => void }) {
  const areaRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pos, setPos] = useState<{x:number;y:number}>({x:0,y:0})
  const [active, setActive] = useState(false)
  const radius = 42 // travel radius
  const dead = 10
  const vecRef = useRef<{x:number;y:number}>({x:0,y:0})
  const rafRef = useRef<number | null>(null)

  const updateFromEvent = useCallback((clientX: number, clientY: number) => {
    const area = areaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    const cx = rect.left + rect.width/2
    const cy = rect.top + rect.height/2
    let dx = clientX - cx
    let dy = clientY - cy
    const len = Math.hypot(dx, dy)
    const max = radius
    if (len > max) {
      dx = (dx / len) * max
      dy = (dy / len) * max
    }
    setPos({x:dx, y:dy})
    const mag = Math.max(0, len - dead) / (max - dead)
    // Standard joystick: emit proportionally once past deadzone
    const nx = (len > 0 ? dx/len : 0) * mag
    const ny = (len > 0 ? dy/len : 0) * mag
    vecRef.current = { x: nx, y: ny }
    onVector(nx, ny)
    setActive(mag > 0)
  }, [onVector])

  // No global listeners; rely on pointer capture to keep events flowing

  return (
    <div
      ref={areaRef}
      className="relative h-28 w-28 select-none touch-none rounded-full bg-gradient-to-b from-muted/70 to-muted/40 backdrop-blur-sm border border-border shadow-inner"
      style={{ touchAction: 'none' as React.CSSProperties['touchAction'], WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        setDragging(true)
        updateFromEvent(e.clientX, e.clientY)
        // start keep-alive loop
        const tick = () => {
          onVector(vecRef.current.x, vecRef.current.y)
          rafRef.current = requestAnimationFrame(tick)
        }
        if (!rafRef.current) rafRef.current = requestAnimationFrame(tick)
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        e.preventDefault()
        updateFromEvent(e.clientX, e.clientY)
      }}
      onPointerUp={(e) => {
        e.preventDefault()
        setDragging(false)
        setPos({x:0, y:0})
        setActive(false)
        vecRef.current = {x:0,y:0}
        onVector(0,0)
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      }}
      onPointerCancel={() => { setDragging(false); setPos({x:0, y:0}); setActive(false); vecRef.current = {x:0,y:0}; onVector(0,0); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }}
    >
      {/* guide ring */}
      <div className={"pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border " + (active ? "border-primary/70 shadow-[0_0_12px_rgba(59,130,246,0.35)]" : "border-border/60")} />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/40" />
      {/* knob */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/10"
        style={{ left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)` }}
      />
    </div>
  )
}

export default function MobileControls({ onDirChange, onVacuum, overlay, vacuumActive }: Props) {
  const lastDirs = useRef({left:false,right:false,up:false,down:false})
  const TH = 0.35
  const REL = 0.25

  const applyVector = (x: number, y: number) => {
    const want = { left: x < -TH, right: x > TH, up: y < -TH, down: y > TH }
    const curr = lastDirs.current
    const release = { left: !(x < -REL), right: !(x > REL), up: !(y < -REL), down: !(y > REL) }
    ;(["left","right","up","down"] as const).forEach((d) => {
      // Start direction when crossing threshold
      if (want[d] && !curr[d]) { 
        curr[d] = true; 
        onDirChange(d, true) 
      }
      // Stop direction when releasing below release threshold
      if (release[d] && curr[d]) { 
        curr[d] = false; 
        onDirChange(d, false) 
      }
      // Keep sending "pressed: true" while direction is active (this maintains continuous movement)
      if (curr[d] && want[d]) {
        onDirChange(d, true)
      }
    })
  }

  useEffect(() => {
    const snapshot = { ...lastDirs.current }
    return () => {
      ;(["left","right","up","down"] as const).forEach((d) => { if (snapshot[d]) onDirChange(d, false) })
    }
  }, [onDirChange])

  return (
    <div className={`pointer-events-auto flex w-full items-center justify-between gap-4 ${
      overlay 
        ? "max-w-none mx-0 px-4 pb-2" 
        : "max-w-lg mx-auto mt-2 px-2"
    }`}>
      <div className="flex items-center gap-3">
        <Joystick onVector={(dx, dy) => applyVector(dx, dy)} />
      </div>
      <div className="flex flex-1 justify-end">
        <button 
          className={`relative h-20 w-20 rounded-full border-3 font-semibold text-white shadow-xl transition-all duration-300 focus:outline-none focus:ring-4 active:scale-90 ${
            vacuumActive 
              ? "bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 border-emerald-400 shadow-emerald-500/40 ring-emerald-300" 
              : "bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 border-blue-400 shadow-blue-500/40 ring-blue-300"
          }`}
          onClick={onVacuum}
        >
          {/* Background glow effect */}
          <div className={`absolute inset-0 rounded-full blur-md opacity-30 ${
            vacuumActive ? "bg-emerald-400" : "bg-blue-400"
          }`}></div>
          
          {/* Image container with better sizing */}
          <div className="absolute inset-0 z-10 flex items-center justify-center p-2">
            <img 
              src="/images/logo schmalz.png" 
              alt="Vacuum" 
              className="w-12 h-6 object-contain filter brightness-0 invert"
            />
          </div>
          
          {/* Active indicator */}
          {vacuumActive && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full animate-pulse border-2 border-white"></div>
          )}
        </button>
      </div>
    </div>
  )
}
