"use client"

import { useCallback, useRef, useState, useEffect } from "react"
import Image from "next/image"

type Props = {
  onDirChange: (dir: "left" | "right" | "up" | "down" | "analog", pressed: boolean | {x: number, y: number}) => void
  onVacuum: () => void
  overlay?: boolean
  vacuumActive?: boolean
}

function Joystick({ onVector }: { onVector: (dx: number, dy: number) => void }) {
  const areaRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pos, setPos] = useState<{x:number;y:number}>({x:0,y:0})
  const [active, setActive] = useState(false)
  // Deteksi iOS dan iPad untuk ukuran yang lebih besar
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isIPad = typeof window !== 'undefined' ? (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchstart' in window)) : /iPad/i.test(ua)
  const radius = isIPad ? 60 : (isIOS ? 50 : 42) // iPad terbesar, iPhone sedang, Android kecil
  const dead = 4  // Deadzone kecil untuk analog
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
  }, [onVector, radius])

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  // No global listeners; rely on pointer capture to keep events flowing

  return (
    <div
      ref={areaRef}
      className={`relative select-none touch-none rounded-full bg-gradient-to-b from-muted/70 to-muted/40 backdrop-blur-sm border border-border shadow-inner ${
        isIPad ? 'h-36 w-36' : (isIOS ? 'h-32 w-32' : 'h-28 w-28')
      }`}
      style={{ touchAction: 'none' as React.CSSProperties['touchAction'], WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        setDragging(true)
        updateFromEvent(e.clientX, e.clientY)
        
        // Start continuous update loop untuk analog input
        const tick = () => {
          onVector(vecRef.current.x, vecRef.current.y)
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
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
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      }}
      onPointerCancel={(e) => { 
        e.preventDefault()
        setDragging(false) 
        setPos({x:0, y:0}) 
        setActive(false) 
        vecRef.current = {x:0,y:0} 
        onVector(0,0) 
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      }}
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
  // Tidak perlu lastDirs karena kita menggunakan sistem analog langsung
  
  const applyVector = useCallback((x: number, y: number) => {
    // Kirim koordinat analog langsung ke parent
    // x dan y sudah dalam range -1 sampai 1 dari joystick
    onDirChange('analog', { x, y })
  }, [onDirChange])

  // Deteksi iOS untuk styling khusus
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchstart' in window)

  return (
    <div className={`pointer-events-auto flex w-full items-center justify-between ${
      overlay 
        ? `max-w-none mx-0 px-0 pb-1 ${isIPad ? 'gap-6' : (isIOS ? 'gap-4' : 'gap-3')}` 
        : `max-w-lg mx-auto mt-2 px-2 ${isIPad ? 'gap-7' : (isIOS ? 'gap-6' : 'gap-4')}`
    }`}>
      <div className={`flex items-center gap-3 ${isIPad ? '-ml-4' : '-ml-2'}`}>
        <Joystick onVector={(dx, dy) => applyVector(dx, dy)} />
      </div>
      <div className={`flex flex-1 justify-end ${isIPad ? '-mr-4' : '-mr-2'}`}>
        <button 
          className={`relative rounded-full border-3 font-semibold text-white shadow-xl transition-all duration-300 focus:outline-none focus:ring-4 active:scale-90 touch-manipulation ${
            isIPad ? 'h-28 w-28' : (isIOS ? 'h-24 w-24' : 'h-20 w-20')
          } ${
            vacuumActive 
              ? "bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 border-emerald-400 shadow-emerald-500/40 ring-emerald-300" 
              : "bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 border-blue-400 shadow-blue-500/40 ring-blue-300"
          }`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onVacuum()
          }}
          onTouchStart={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onTouchEnd={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onVacuum()
          }}
          style={{ 
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
            userSelect: 'none',
            WebkitUserSelect: 'none'
          }}
        >
          {/* Background glow effect */}
          <div className={`absolute inset-0 rounded-full blur-md opacity-30 ${
            vacuumActive ? "bg-emerald-400" : "bg-blue-400"
          }`}></div>
          
          {/* Image container with better sizing */}
          <div className={`absolute inset-0 z-10 flex items-center justify-center ${isIPad ? 'p-4' : (isIOS ? 'p-3' : 'p-2')}`}>
            <Image 
              src="/images/logo schmalz.png" 
              alt="Vacuum" 
              width={isIPad ? 64 : (isIOS ? 56 : 48)}
              height={isIPad ? 32 : (isIOS ? 28 : 24)}
              className="object-contain filter brightness-0 invert"
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
