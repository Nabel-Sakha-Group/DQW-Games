"use client"

import { Button } from "@/components/ui/button"
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
    const nx = (len > 0 ? dx/len : 0) * mag
    const ny = (len > 0 ? dy/len : 0) * mag
    vecRef.current = { x: nx, y: ny }
    onVector(nx, ny)
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
        vecRef.current = {x:0,y:0}
        onVector(0,0)
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      }}
      onPointerCancel={() => { setDragging(false); setPos({x:0, y:0}); vecRef.current = {x:0,y:0}; onVector(0,0); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }}
    >
      {/* guide ring */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/60" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/40" />
      {/* knob */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/10"
        style={{ left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)` }}
      />
      {!dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] opacity-60">Drag</div>
      )}
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
      if (want[d] && !curr[d]) { curr[d] = true; onDirChange(d, true) }
      if (release[d] && curr[d]) { curr[d] = false; onDirChange(d, false) }
    })
  }

  useEffect(() => {
    const snapshot = { ...lastDirs.current }
    return () => {
      ;(["left","right","up","down"] as const).forEach((d) => { if (snapshot[d]) onDirChange(d, false) })
    }
  }, [onDirChange])

  return (
    <div className={"pointer-events-auto mx-auto mt-2 flex w-full items-center justify-between gap-4 px-2 " + (overlay ? "max-w-none" : "max-w-lg") }>
      <div className="flex items-center gap-3">
        <Joystick onVector={(dx, dy) => applyVector(dx, dy)} />
      </div>
      <div className="flex flex-1 justify-end">
        <Button className={"h-12 w-32 text-base font-semibold " + (vacuumActive ? "bg-emerald-600 hover:bg-emerald-700" : "")} onClick={onVacuum}>
          Vacuum
        </Button>
      </div>
    </div>
  )
}
