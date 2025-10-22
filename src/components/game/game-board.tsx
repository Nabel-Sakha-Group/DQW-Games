"use client"

// Core canvas game: Pick & Place with conveyor and targets.
// Controls: Arrow/WASD + Space on desktop; on-screen buttons on mobile.

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { HUD } from "./hud"
import MobileControls from "./mobile-controls"
import DesktopControls from "./desktop-controls"
import { useMediaQuery } from "@/components/ui/use-mobile" // returns boolean for mobile width
import { getSupabase } from "@/lib/supabaseClient"

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

export default function GameBoard({ onLeaderboardUpdate }: { onLeaderboardUpdate?: () => void }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const lifterImgRef = useRef<HTMLImageElement | null>(null) // will load gripper.svg
  const pipeImgRef = useRef<HTMLImageElement | null>(null)
  // Narrow type for orientation API without using 'any'
  type ScreenOrientationLike = {
    // Use string to avoid depending on lib.dom's OrientationLockType availability across TS versions
    lock?: (orientation: string) => Promise<void> | void
    unlock?: () => void
  }

  const isMobile = useMediaQuery()
  
  // Custom hook untuk mendeteksi device yang perlu mobile controls (termasuk iPad)
  const [needsMobileControls, setNeedsMobileControls] = useState(false)
  
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showRotateHint, setShowRotateHint] = useState(false)
  const [displayMode, setDisplayMode] = useState<'desktop' | 'mobile'>('desktop')
  const [autoDetected, setAutoDetected] = useState(true)

  // Function untuk mendeteksi device type
  const detectDeviceType = useCallback(() => {
    // Guard for SSR: navigator and window aren't available on server
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0))
    const hasPhysicalKeyboard = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : true
    const screenWidth = typeof window !== 'undefined' ? window.screen.width : 1024
    const screenHeight = typeof window !== 'undefined' ? window.screen.height : 768
    const smallScreen = Math.min(screenWidth, screenHeight) <= 768
    const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    
    // Deteksi iPad/tablet (touch device dengan screen besar)
    const isTablet = isTouchDevice && Math.min(screenWidth, screenHeight) > 768
    
    // Deteksi iPad khusus
  const isIPad = (/ipad|macintosh/i.test(ua) && isTouchDevice) || false
    
    // Deteksi mobile device berdasarkan multiple criteria
    const isMobileDevice = (
      // User agent detection (smartphone/mobile)
      /android.*mobile|webos|iphone|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua) ||
      // Touch device dengan screen kecil (smartphone)
      (isTouchDevice && smallScreen && !isTablet) ||
      // Tidak ada hover capability dan screen kecil
      (!hasPhysicalKeyboard && smallScreen)
    )
    
    console.log('Device detection:', {
      userAgent: (ua || '').substring(0, 50) + '...',
      isTouchDevice,
      hasPhysicalKeyboard,
      screenWidth,
      screenHeight,
      smallScreen,
      isTablet,
      isIPad,
      pixelRatio,
      isMobileDevice
    })
    
    // Logic: mobile untuk smartphone, iPad/tablet (karena touch-based), atau device tanpa keyboard fisik
    return (isMobileDevice || isTablet || isIPad) ? 'mobile' : 'desktop'
  }, [])
  const [countdown, setCountdown] = useState<number | null>(null)
  const [gameOver, setGameOver] = useState(false)
  const [finalScore, setFinalScore] = useState(0)
  const [name, setName] = useState("")
  const [perusahaan, setPerusahaan] = useState("")
  const [saving, setSaving] = useState(false)

  // Protection flag to prevent accidental game resets during input interaction
  const [isInputting, setIsInputting] = useState(false)

  // iOS detection for better handling
  const isIOS = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    return /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  }, [])

  // iPad specific detection (covers iPadOS which may report MacIntel)
  const isIPad = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const touch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0))
    return /ipad/i.test(ua) || (/macintosh/i.test(ua) && touch)
  }, [])

  // Debug logging for critical state changes (can be removed after testing)
  useEffect(() => {
    console.log('🎮 Game state:', { gameOver, name: name.length > 0 ? `"${name}"` : 'empty', perusahaan: perusahaan.length > 0 ? `"${perusahaan}"` : 'empty', saving, isInputting })
    
    // Log stack trace when gameOver changes to false unexpectedly
    if (!gameOver && name.length > 0) {
      console.warn('⚠️ GameOver set to false while name was filled! This might be the bug.')
      console.trace('Stack trace:')
    }
  }, [gameOver, name, perusahaan, saving, isInputting])

  // Global event monitoring for debugging mobile input issue
  useEffect(() => {
    const events = [
      'click', 'touchstart', 'touchend', 'touchmove', 'touchcancel',
      'focus', 'blur', 'keydown', 'keyup', 'input', 'change',
      'fullscreenchange', 'orientationchange', 'resize', 'scroll'
    ]
    
    const handlers: Array<() => void> = []
    
    events.forEach(eventType => {
      const handler = (e: Event) => {
        if (gameOver && isInputting) {
          console.log(`🔍 Event during input: ${eventType}`, e.target)
        }
      }
      window.addEventListener(eventType, handler, true) // Use capture phase
      handlers.push(() => window.removeEventListener(eventType, handler, true))
    })
    
    return () => {
      handlers.forEach(cleanup => cleanup())
    }
  }, [gameOver, isInputting])

  // Show rotate hint on touch devices (including iPad) when in fullscreen but portrait
  const checkRotateHint = useCallback(() => {
    if (!needsMobileControls) return setShowRotateHint(false)
    // For iOS, be more lenient with rotation hints - don't show unless very small screen
    if (isIOS) {
      const isPortrait = window.matchMedia("(orientation: portrait)").matches
      const screenHeight = window.screen.height
      const screenWidth = window.screen.width
      // Only show hint if portrait and really small screen (phone-sized)
      const isSmallScreen = Math.min(screenHeight, screenWidth) < 700
      setShowRotateHint(isPortrait && isSmallScreen)
    } else {
      // For non-iOS touch devices (Android tablets, etc), use original logic
      const isPortrait = window.matchMedia("(orientation: portrait)").matches
      setShowRotateHint(isPortrait)
    }
  }, [needsMobileControls, isIOS])

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

  // Prevent scroll during active gameplay on mobile/tablet
  useEffect(() => {
    if (started && !gameOver && (needsMobileControls || isIPad)) {
      // Focus canvas when game starts
      const canvas = canvasRef.current
      if (canvas) {
        canvas.focus()
      }
      
      // Prevent scroll events during gameplay
      const preventScroll = (e: Event) => {
        const target = e.target as HTMLElement
        // Allow interaction with form elements only
        if (target && (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA')) {
          return
        }
        e.preventDefault()
      }
      
      // Add scroll prevention listeners
      document.addEventListener('scroll', preventScroll, { passive: false })
      document.addEventListener('touchmove', preventScroll, { passive: false })
      document.addEventListener('wheel', preventScroll, { passive: false })
      
      return () => {
        document.removeEventListener('scroll', preventScroll)
        document.removeEventListener('touchmove', preventScroll)
        document.removeEventListener('wheel', preventScroll)
      }
    }
  }, [started, gameOver, needsMobileControls, isIPad])

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
  // Layout profile refs
  const beltFracRef = useRef<number>(0.05) // belt height fraction of canvas height
  const itemScaleRef = useRef<number>(1)   // scale multiplier for item sizes

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
    console.log('🔧 Vacuum button pressed!')
    const lifter = lifterRef.current
    const g = gameRef.current
    
    console.log('🔧 Game state:', { paused: g.paused, timeLeft: g.timeLeft, started, gameOver })
    
    if (g.paused || g.timeLeft <= 0) {
      console.log('🔧 Vacuum blocked - game paused or time over')
      return
    }
    
    // Also check if game hasn't started yet
    if (!started) {
      console.log('🔧 Vacuum blocked - game not started')
      return
    }

    lifter.vacuum = !lifter.vacuum
    setVacuumState(lifter.vacuum)
    
    console.log('🔧 Vacuum toggled to:', lifter.vacuum)

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
  }, [started, gameOver])

  // Pause removed entirely per requirement

  

  

  // Fullscreen helpers dengan true iOS fullscreen API
  const requestFullscreenAndLock = useCallback(async (forceIOS = false) => {
    try {
      const el = wrapperRef.current
      const canvas = canvasRef.current
      if (!el || !canvas) return
      
      // iOS Safari - skip fullscreen unless explicitly forced
      if (isIOS && !forceIOS) {
        console.log('🍎 iOS detected - skipping fullscreen (not forced)')
        // Just check for rotate hint without entering fullscreen
        checkRotateHint()
        return
      }
      
      // iOS Safari with forced fullscreen - gunakan canvas requestFullscreen dengan webkit prefixes
      if (isIOS && forceIOS) {
        console.log('🍎 iOS detected - forcing canvas webkit fullscreen')
        
        try {
          // Try multiple iOS Safari fullscreen methods
          const canvasEl = canvas as HTMLCanvasElement & { 
            webkitRequestFullscreen?: () => Promise<void>
            webkitRequestFullScreen?: () => Promise<void>
          }
          
          // Method 1: webkitRequestFullscreen on canvas
          if (canvasEl.webkitRequestFullscreen) {
            console.log('Using webkitRequestFullscreen on canvas')
            await canvasEl.webkitRequestFullscreen()
            setIsFullscreen(true)
            checkRotateHint()
            return
          }
          
          // Method 2: webkitRequestFullScreen (capital S)
          if (canvasEl.webkitRequestFullScreen) {
            console.log('Using webkitRequestFullScreen on canvas')
            await canvasEl.webkitRequestFullScreen()
            setIsFullscreen(true)
            checkRotateHint()
            return
          }
          
          // Method 3: Standard requestFullscreen on canvas
          if (canvasEl.requestFullscreen) {
            console.log('Using standard requestFullscreen on canvas')
            await canvasEl.requestFullscreen()
            setIsFullscreen(true)
            checkRotateHint()
            return
          }
          
          console.log('No fullscreen method available, using enhanced pseudo-fullscreen')
          // Enhanced pseudo-fullscreen with better iOS handling
          setIsFullscreen(true)
          
          // Aggressive Safari UI hiding
          document.body.style.overflow = 'hidden'
          document.documentElement.style.overflow = 'hidden'
          document.body.style.height = '100vh'
          document.documentElement.style.height = '100vh'
          document.body.style.margin = '0'
          document.body.style.padding = '0'
          document.documentElement.style.margin = '0'
          document.documentElement.style.padding = '0'
          
          // Hide Safari address bar with scroll trick
          window.scrollTo(0, 1)
          setTimeout(() => window.scrollTo(0, 0), 50)
          
          // Force viewport to cover entire screen including notch area
          const viewport = document.querySelector('meta[name=viewport]')
          if (viewport) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, minimal-ui, status-bar-height=0')
          }
          
          // Add CSS to ensure full coverage
          const style = document.createElement('style')
          style.textContent = `
            body, html {
              height: 100vh !important;
              width: 100vw !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }
            body {
              -webkit-overflow-scrolling: touch !important;
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
            }
          `
          document.head.appendChild(style)
          
          // Store style element for cleanup
          el.setAttribute('data-fullscreen-style', style.id = 'ios-fullscreen-style')
          
          checkRotateHint()
          return
          
        } catch (error) {
          console.log('iOS canvas fullscreen failed:', error)
        }
      }
      
      // Normal fullscreen untuk non-iOS devices
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
      }
      setIsFullscreen(true)
      
      // Try to lock orientation on supported browsers (mostly Android Chrome) - skip iOS
      if (!isIOS) {
        const orientationLike = (screen as unknown as { orientation?: ScreenOrientationLike }).orientation
        if (orientationLike && typeof orientationLike.lock === "function") {
          try {
            await orientationLike.lock("landscape")
            setShowRotateHint(false)
          } catch {
            // If we couldn't lock, still show hint if portrait on mobile
            checkRotateHint()
          }
        } else {
          checkRotateHint()
        }
      } else {
        // For iOS, don't force orientation but still check for hint (optional)
        checkRotateHint()
      }
    } catch (error) {
      console.log('Fullscreen failed, falling back to pseudo-fullscreen:', error)
      // Fallback to pseudo-fullscreen even on non-iOS if real fullscreen fails
      setIsFullscreen(true)
      checkRotateHint()
    }
  }, [checkRotateHint, isIOS])

  const exitFullscreenAndUnlock = useCallback(async () => {
    console.log('Exit fullscreen called, current fullscreen element:', document.fullscreenElement)
    
    if (isIOS) {
      console.log('🍎 iOS detected - exiting fullscreen')
      
      // Restore iOS styles
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      document.body.style.height = ''
      document.documentElement.style.height = ''
      document.body.style.margin = ''
      document.body.style.padding = ''
      document.documentElement.style.margin = ''
      document.documentElement.style.padding = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      
      // Remove custom fullscreen styles
      const customStyle = document.getElementById('ios-fullscreen-style')
      if (customStyle) {
        customStyle.remove()
      }
      
      // Restore viewport
      const viewport = document.querySelector('meta[name=viewport]')
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=yes')
      }
      
      setIsFullscreen(false)
      setShowRotateHint(false)
      return
    }
    
    try {
      // Force exit fullscreen untuk non-iOS devices
      if (document.fullscreenElement) {
        console.log('Attempting to exit fullscreen...')
        await document.exitFullscreen()
        console.log('Exit fullscreen completed')
      } else {
        console.log('No fullscreen element found')
      }
    } catch (error) {
      console.error('Error exiting fullscreen:', error)
    } finally {
      // Always update state regardless of API success
      console.log('Setting fullscreen state to false')
      setIsFullscreen(false)
      
      // DON'T clear game over state automatically - this was causing the mobile input bug!
      // Only clear game over state when explicitly restarting game, not when exiting fullscreen
      
      // Unlock orientation if previously locked
      try {
        const orientationLike = (screen as unknown as { orientation?: ScreenOrientationLike }).orientation
        if (orientationLike && typeof orientationLike.unlock === "function") {
          orientationLike.unlock()
          console.log('Screen orientation unlocked')
        }
      } catch (orientationError) {
        console.error('Error unlocking orientation:', orientationError)
      }
      setShowRotateHint(false)
      
      // Force a re-render by triggering a resize event
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 100)
    }
  }, [isIOS])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitFullscreenAndUnlock()
    } else {
      // For manual toggle, allow iOS fullscreen (force = true)
      requestFullscreenAndLock(true)
    }
  }, [isFullscreen, exitFullscreenAndUnlock, requestFullscreenAndLock])

  // Listen for fullscreenchange to keep state in sync
  useEffect(() => {
    const canvas = canvasRef.current
    
    const handler = () => {
      const fs = !!document.fullscreenElement
      setIsFullscreen(fs)
      if (!fs) {
        // when leaving by user gestures, also unlock orientation
        try {
          const orientationLike = (screen as unknown as { orientation?: ScreenOrientationLike }).orientation
          if (orientationLike && typeof orientationLike.unlock === "function") {
            orientationLike.unlock()
          }
        } catch {}
        setShowRotateHint(false)
      } else {
        // entering fullscreen - auto-detect device type, force mobile for iPad
        const detectedMode = detectDeviceType()
        console.log(`Auto-detected device type: ${detectedMode}`)
        console.log(`iPad detected: ${isIPad}`)
        // Force mobile mode for iPad in fullscreen
        const finalMode = (detectedMode === 'mobile' || isIPad) ? 'mobile' : detectedMode
        setDisplayMode(finalMode)
        setAutoDetected(true) // Mark as auto-detected
        checkRotateHint()
      }
    }
    
    // Handle webkit fullscreen events for iOS canvas
    const webkitEnterHandler = () => {
      console.log('🍎 iOS canvas entered fullscreen')
      setIsFullscreen(true)
      const detectedMode = detectDeviceType()
      console.log(`Auto-detected device type: ${detectedMode}`)
      console.log(`iPad detected: ${isIPad}`)
      // Force mobile mode for iPad in fullscreen
      const finalMode = (detectedMode === 'mobile' || isIPad) ? 'mobile' : detectedMode
      setDisplayMode(finalMode)
      setAutoDetected(true)
      checkRotateHint()
    }
    
    const webkitExitHandler = () => {
      console.log('🍎 iOS canvas exited fullscreen')
      setIsFullscreen(false)
      setShowRotateHint(false)
    }
    
    // Add normal fullscreen listeners
    document.addEventListener("fullscreenchange", handler)
    
    // Add iOS canvas fullscreen listeners
    if (canvas && isIOS) {
      canvas.addEventListener("webkitfullscreenchange", handler)
      canvas.addEventListener("webkitbeginfullscreen", webkitEnterHandler)
      canvas.addEventListener("webkitendfullscreen", webkitExitHandler)
    }
    
    return () => {
      document.removeEventListener("fullscreenchange", handler)
      if (canvas && isIOS) {
        canvas.removeEventListener("webkitfullscreenchange", handler)
        canvas.removeEventListener("webkitbeginfullscreen", webkitEnterHandler)
        canvas.removeEventListener("webkitendfullscreen", webkitExitHandler)
      }
    }
  }, [checkRotateHint, detectDeviceType, isIOS, isIPad])

  // Auto-detect device type on component mount
  useEffect(() => {
    const detectedMode = detectDeviceType()
    console.log(`Initial device detection: ${detectedMode}`)
    setDisplayMode(detectedMode)
    setAutoDetected(true) // Mark as auto-detected
    
    // Update needsMobileControls for touch devices (including iPad)
    setNeedsMobileControls(detectedMode === 'mobile' || isIPad)
  }, [detectDeviceType, isIPad])

  // (removed countdown useEffect - game over now goes directly to input form)

  // (removed duplicate checkRotateHint)

  // Start game with countdown
  const startGameWithCountdown = useCallback(() => {
    setCountdown(3)
    
    // Auto-focus canvas untuk menghindari scroll issues
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    
    if (canvas) {
      canvas.focus()
      canvas.setAttribute('tabindex', '0')
      
      // Pastikan canvas visible dengan scroll ke posisi optimal
      setTimeout(() => {
        if (needsMobileControls || isIPad) {
          // Scroll agar canvas dan controls area terlihat sempurna
          const gameArea = wrapper || canvas
          // On tablets/iPad, center the game area and nudge a bit so embedded controls remain visible
          if (isIPad && !isFullscreen) {
            gameArea.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
            // Small upward nudge so bottom-anchored controls remain fully visible
            setTimeout(() => {
              try { window.scrollBy({ top: -80, left: 0, behavior: 'smooth' }) } catch { /* ignore */ }
              // Re-focus after small adjustment
              setTimeout(() => canvas.focus(), 300)
            }, 300)
          } else {
            // Phones: keep previous behavior (top-aligned)
            gameArea.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' })
            setTimeout(() => canvas.focus(), 500)
          }
        }
      }, 100)
    }
    
    // Lock scroll pada mobile/tablet saat game aktif
    if (needsMobileControls || isIPad) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    }
    
    // Auto fullscreen saat game start - reset auto-detect untuk re-detect device
    setAutoDetected(true) 
    // Skip auto fullscreen for iOS, let user decide
    if (!isIOS) {
      requestFullscreenAndLock()
    }
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownInterval)
          // Actually start the game
          itemsRef.current = []
          lifterRef.current.holding = null
          lifterRef.current.vacuum = false
          keysRef.current = {}
          gameRef.current = { score: 0, timeLeft: GAME_SECONDS, paused: false }
          setVacuumState(false)
          setHud({ score: 0, timeLeft: GAME_SECONDS, paused: false, holding: null })
          setStarted(true)
          console.log('🎮 startGame - clearing game over state')
          setGameOver(false)
          gameOverFiredRef.current = false
          
          // Final auto-focus setelah game dimulai
          setTimeout(() => {
            const canvas = canvasRef.current
            if (canvas) {
              canvas.focus()
              console.log('🎯 Canvas focused after game start')
            }
          }, 100)
          // spawn a couple items immediately so conveyor isn't empty
          spawnItem()
          if (Math.random() < 0.6) spawnItem()
          lastSpawnRef.current = performance.now()
          nextSpawnDelayRef.current = rand(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
          
          return null
        }
        return prev - 1
      })
    }, 1000)
  }, [spawnItem, requestFullscreenAndLock, isIOS, needsMobileControls, isIPad, isFullscreen])
  
  // Restart game function
  const restartGame = useCallback(() => {
    console.log('🔄 restartGame called - clearing game over state')
    console.trace('restartGame stack trace:')
    
    // Restore scroll saat restart
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    
    setGameOver(false)
    setStarted(false)
    setCountdown(null)
    setName("")
    setPerusahaan("")
    setSaving(false)
    gameOverFiredRef.current = false
    // Reset game state
    gameRef.current = { score: 0, timeLeft: GAME_SECONDS, paused: true }
    setHud({ score: 0, timeLeft: GAME_SECONDS, paused: true, holding: null })
  }, [])

  // Save score function
  const saveScore = useCallback(async () => {
    const player = name.trim()
    const company = perusahaan.trim()
    
    // Validation: both name and company are required
    if (!player || !company) {
      alert("Nama dan Perusahaan wajib diisi!")
      return
    }
    
    setSaving(true)
    
    try {
      const supabase = getSupabase()
      const { error } = await supabase.from("leaderboard").insert({ 
        name: player, 
        perusahaan: company, 
        score: finalScore 
      })
      
      if (error) {
        console.error("Failed to save score:", error.message)
        // Still continue to reset
      } else {
        console.log("Score saved successfully")
        // Refresh leaderboard if callback provided
        onLeaderboardUpdate?.()
      }
    } catch (error) {
      console.error("Supabase not available:", error)
      // Still continue to reset
    }
    
    setSaving(false)
    
    // Reset states tetapi jangan keluar fullscreen di mobile untuk menghindari refresh
    const isMobileDevice = detectDeviceType() === 'mobile'
    
    if (!isMobileDevice && isFullscreen) {
      // Hanya keluar fullscreen di desktop/laptop
      exitFullscreenAndUnlock()
    }
    
    // Reset all states
    console.log('💾 saveScore - resetting game state after save')
    
    // Restore scroll setelah save
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    
    setGameOver(false)
    setName("")
    setPerusahaan("")
    setStarted(false)
    gameOverFiredRef.current = false
    gameRef.current = { score: 0, timeLeft: GAME_SECONDS, paused: true }
    setHud({ score: 0, timeLeft: GAME_SECONDS, paused: true, holding: null })
  }, [name, perusahaan, finalScore, isFullscreen, exitFullscreenAndUnlock, onLeaderboardUpdate, detectDeviceType])

  useEffect(() => {
    checkRotateHint()
    const mq = window.matchMedia("(orientation: portrait)")
    const cb = () => checkRotateHint()
    mq.addEventListener?.("change", cb)
    window.addEventListener("orientationchange", cb)
    return () => {
      mq.removeEventListener?.("change", cb)
      window.removeEventListener("orientationchange", cb)
    }
  }, [checkRotateHint])

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

  // Setup targets based on size (with layout profiles)
  const setupLevel = useCallback(() => {
    const { w, h } = scaledRef.current
    // Layout profile per mode - scaling yang lebih proporsional untuk iOS canvas kecil
    const targetScale = isFullscreen ? 1.15 : (isIOS && !isFullscreen ? 1.15 : (isIOS ? 1.35 : 1.0))
    const lifterScale = isFullscreen ? 1.1 : (isIOS && !isFullscreen ? 1.2 : (isIOS ? 1.3 : 1.0))
    beltFracRef.current = isFullscreen ? 0.06 : (isIOS && !isFullscreen ? 0.055 : (isIOS ? 0.065 : 0.05))
    itemScaleRef.current = isFullscreen ? 1.1 : (isIOS && !isFullscreen ? 1.0 : (isIOS ? 1.3 : 1.0))

  conveyorRef.current.y = Math.floor(h * (isIPad && !isFullscreen ? 0.66 : (isIOS && !isFullscreen ? 0.68 : (isIOS ? 0.70 : 0.72))))

    // Penyesuaian khusus untuk iOS - target boxes lebih kecil di canvas kecil untuk proporsi yang pas
    const smallScreen = w < 500
    const isIOSSmall = isIOS && w < 430 // iPhone 13 width is ~390px
    
  // Scaling yang berbeda untuk fullscreen vs non-fullscreen
  // iPad should get a larger canvasScale (use more of viewport) than phones
  const canvasScale = isFullscreen ? 1.0 : (isIPad ? 1.0 : (isIOS ? 0.75 : 1.0))
    
    const targetW = Math.max(
      isIOSSmall && !isFullscreen ? 60 : (isIOSSmall ? 80 : (smallScreen ? 70 : 100)), 
      Math.floor(w * (isIOS && !isFullscreen ? 0.09 : (isIOS ? 0.12 : 0.12)) * targetScale * canvasScale)
    )
    const targetH = Math.max(
      isIOSSmall && !isFullscreen ? 32 : (isIOSSmall ? 48 : (smallScreen ? 40 : 50)), 
      Math.floor(h * (isIOS && !isFullscreen ? 0.065 : (isIOS ? 0.085 : 0.09)) * targetScale * canvasScale)
    )
    const baseY = Math.floor(h * (isIOSSmall && !isFullscreen ? 0.30 : (isIOSSmall ? 0.32 : (smallScreen ? 0.34 : (isFullscreen ? 0.38 : 0.36)))))

    // Adjust target spacing untuk canvas kecil iOS
    const targetSpacing = isIOS && !isFullscreen ? 
      [0.20, 0.42, 0.62, 0.82] : // Lebih rapat untuk canvas kecil
      [0.22, 0.46, 0.65, 0.84]   // Spacing normal
      
    targetsRef.current = [
      {
        type: "bottle",
        label: "Bottle Crate",
        x: Math.floor(w * targetSpacing[0]) - targetW / 2,
        y: baseY,
        w: targetW,
        h: targetH,
      },
      { type: "pcb", label: "PCB Tray", x: Math.floor(w * targetSpacing[1]) - targetW / 2, y: baseY, w: targetW, h: targetH },
      { type: "glass", label: "Glass Rack", x: Math.floor(w * targetSpacing[2]) - targetW / 2, y: baseY, w: targetW, h: targetH },
      { type: "box", label: "Pallet (Box)", x: Math.floor(w * targetSpacing[3]) - targetW / 2, y: baseY, w: targetW, h: targetH },
    ]

    // Reset lifter bounds a bit below the top - sesuaikan dengan target size yang lebih kecil
    const gripW = Math.max(
      isIOSSmall && !isFullscreen ? 50 : (isIOSSmall ? 65 : (smallScreen ? 60 : 72)), 
      Math.floor(w * (isIOS && !isFullscreen ? 0.075 : (isIOS ? 0.095 : 0.09)) * lifterScale * canvasScale)
    )
    const gripH = Math.floor(gripW * 0.43)
    lifterRef.current.w = gripW
    lifterRef.current.h = gripH
    lifterRef.current.y = Math.floor(h * (isIOS && !isFullscreen ? 0.06 : (isIOS ? 0.08 : 0.12)))
    lifterRef.current.x = Math.floor(w * (isIOS && !isFullscreen ? 0.08 : (isIOS ? 0.10 : 0.14)))
    lifterTargetRef.current = { x: lifterRef.current.x, y: lifterRef.current.y }
    anchorXRef.current = lifterRef.current.x + lifterRef.current.w / 2
  }, [isFullscreen, isIOS, isIPad])

  // Resize canvas responsively
  useEffect(() => {
    const el = wrapperRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return

    const getAdaptiveDpr = (w: number, h: number) => {
      const devDpr = Math.max(1, window.devicePixelRatio || 1)
      // Base caps: lebih generous untuk iOS agar terlihat crisp
      const cap = isIOS
        ? (isFullscreen ? 1.5 : 2.0)
        : isMobile
        ? (isFullscreen ? 1.0 : 1.25)
        : (isFullscreen ? 1.5 : 2.0)
      let dpr = Math.min(devDpr, cap)

      // Pixel budget to avoid fill-rate bottlenecks - lebih besar untuk iOS
      const budget = isIOS
        ? (isFullscreen ? 2.5e6 : 2.0e6)
        : isMobile
        ? (isFullscreen ? 1.6e6 : 1.3e6)
        : (isFullscreen ? 3.2e6 : 2.2e6)
      const px = w * h * dpr * dpr
      if (px > budget) {
        dpr = Math.sqrt(budget / (w * h))
      }
      // Reasonable floor to keep text readable - lebih tinggi untuk iOS
      return Math.max(isIOS ? 1.0 : 0.75, Math.min(dpr, cap))
    }

    const onResize = () => {
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = requestAnimationFrame(() => {
        const bounds = el.getBoundingClientRect()
  let w = Math.floor(bounds.width)
  // Keep a consistent 16:9 aspect outside of fullscreen as before
  let h = Math.floor((w * 9) / 16)
        // When in fullscreen, use as much height as available inside wrapper while preserving 16:9
        if (isFullscreen) {
          const maxH = Math.floor(bounds.height)
          if (h > maxH) {
            h = maxH
            w = Math.floor((h * 16) / 9)
          }
        } else {
          const viewportH = window.innerHeight
          // Berikan lebih banyak ruang untuk iPad/iOS tetapi tetap proporsional
          const maxH = Math.floor(viewportH * (isIPad ? 0.92 : (isIOS ? 0.82 : (isMobile ? 0.75 : 0.62))))
          if (h > maxH) {
            h = maxH
            w = Math.floor((h * 16) / 9)
          }
          // Minimum height yang optimal untuk iPad/iOS
          const minH = isIPad ? 420 : (isIOS ? 350 : (isMobile ? 280 : 0))
          if (h < minH) {
            h = minH
            // keep aspect; don't exceed container width
            w = Math.min(Math.floor((h * 16) / 9), Math.floor(bounds.width))
          }
        }
  const dpr = getAdaptiveDpr(w, h)

        // Guard: hanya update bila berbeda
        const prev = scaledRef.current
        if (prev.w === w && prev.h === h && prev.dpr === dpr) return

        // Apply new canvas size
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
        scaledRef.current = { w, h, dpr }

        // Setup ulang layout berdasarkan ukuran baru (targets, lifter geometry)
        setupLevel()

        // Rescale existing items so their position/size stay proportional
        if (prev.w > 0 && prev.h > 0 && itemsRef.current.length) {
          const scaleX = w / prev.w
          const scaleY = h / prev.h
          const newConveyorY = conveyorRef.current.y
          const prevConveyorY = prev.h * 0.72
          
          for (const it of itemsRef.current) {
            // Detect if item was on conveyor belt before resize (bottom of item near conveyor level)
            const itemBottomY = it.y + it.h
            const wasOnConveyor = Math.abs(itemBottomY - prevConveyorY) <= 20 && !it.vy && !it.grabbed
            
            if (wasOnConveyor) {
              // Item on conveyor: scale X position but snap Y to new conveyor position
              it.x *= scaleX
              // Update size first, then position bottom on conveyor
              const s = getSizeFor(it.type)
              it.w = s.w
              it.h = s.h
              it.y = newConveyorY - s.h
            } else {
              // Item not on conveyor (grabbed, dropping, or in air): normal scaling
              it.x *= scaleX
              it.y *= scaleY
              // Update size
              const s = getSizeFor(it.type)
              it.w = s.w
              it.h = s.h
            }
            
            // Update any pending landing target Y
            if (typeof it.landingY === "number") {
              it.landingY = newConveyorY - it.h
            }
          }
        }
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
  }, [isMobile, isFullscreen, setupLevel, isIOS, isIPad])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip keyboard handling completely during game over
      if (gameOver) {
        return
      }
      
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
      // Skip keyboard handling completely during game over
      if (gameOver) {
        return
      }
      
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
  }, [toggleVacuum, gameOver])

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
        setFinalScore(g.score)
        setGameOver(true) // Show game over screen directly
        // Don't call onGameOver - input form is now part of game over screen
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

    // Move lifter - gunakan analog input jika tersedia, fallback ke digital
    const analog = analogInputRef.current
    const hasAnalogInput = Math.abs(analog.x) > 0.1 || Math.abs(analog.y) > 0.1 // deadzone 0.1
    
    let dirX: number, dirY: number
    
    if (hasAnalogInput) {
      // Gunakan analog input langsung (range -1 sampai 1)
      dirX = analog.x
      dirY = analog.y
    } else {
      // Fallback ke digital input (keyboard)
      dirX = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0)
      dirY = (keysRef.current.down ? 1 : 0) - (keysRef.current.up ? 1 : 0)
    }
    
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
      // Use actual gripper bottom point for reach calculation
      const { bottomX, bottomY } = getHeadGeo()
      // helper: distance from point to rect
      const distToRect = (px: number, py: number, rx: number, ry: number, rw: number, rh: number) => {
        const nx = clamp(px, rx, rx + rw)
        const ny = clamp(py, ry, ry + rh)
        return Math.hypot(px - nx, py - ny)
      }
      let nearest: Item | null = null
      // Threshold follows lifter size and gives a little extra in fullscreen
      let bestDist = Math.max(24, Math.min(lifter.w, lifter.h) * (isFullscreen ? 0.75 : 0.6))
      for (const it of items) {
        if (it.grabbed) continue
        const d = distToRect(bottomX, bottomY, it.x, it.y, it.w, it.h)
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
    const base = Math.max(smallScreen ? 20 : 26, Math.floor(w * (smallScreen ? 0.028 : 0.03))) * itemScaleRef.current
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

    // Define ground level for the whole scene
    const groundY = Math.floor(height * 0.65) // Start ground earlier at 65% height

    // Background
    if (bgImgRef.current && bgImgRef.current.complete) {
      ctx.drawImage(bgImgRef.current, 0, 0, width, height)
    } else {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--background") || "#f5f5f5"
      ctx.fillRect(0, 0, width, height)
    }

    // Ground/Floor - Extended ground to make everything look grounded
    ctx.fillStyle = "#d4d4d8" // Light gray ground
    ctx.fillRect(0, groundY, width, height - groundY)
    
    // Add subtle ground texture
    ctx.fillStyle = "#a1a1aa" // Darker gray for texture lines
    const lineSpacing = 40
    for (let x = 0; x < width; x += lineSpacing) {
      ctx.fillRect(x, groundY, 1, height - groundY)
    }
    for (let y = groundY; y < height; y += lineSpacing) {
      ctx.fillRect(0, y, width, 1)
    }

    // Targets shelf (draw before conveyor so it sits on ground)
    drawTargetsShelf(ctx, width, height)

    // Conveyor belt legs/supports (draw before belt surface)
    const beltY = conveyorRef.current.y
    const beltH = Math.floor(height * beltFracRef.current)
    const legHeight = groundY - (beltY + beltH)
    
    // Draw conveyor support legs
    if (legHeight > 10) { // Only if there's meaningful space
      const legWidth = 12
      const numLegs = Math.max(4, Math.floor(width / 140)) // One leg every ~140px
      
      for (let i = 0; i <= numLegs; i++) {
        const legX = Math.floor((width / numLegs) * i - legWidth / 2)
        if (legX >= 10 && legX + legWidth <= width - 10) {
          // Main leg - dark gray industrial color
          ctx.fillStyle = "#374151"
          ctx.fillRect(legX, beltY + beltH, legWidth, legHeight)
          
          // Add foot plate at bottom for stability
          ctx.fillStyle = "#1f2937"
          ctx.fillRect(legX - 6, groundY - 4, legWidth + 12, 4)
          
          // Add small mounting bracket at top
          ctx.fillStyle = "#4b5563"
          ctx.fillRect(legX - 2, beltY + beltH, legWidth + 4, 6)
        }
      }
    }

    // Conveyor belt surface
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
      const mainFontSize = isIOS ? 32 : 28
      const scoreFontSize = isIOS ? 24 : 20
      ctx.font = `700 ${mainFontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
      ctx.textAlign = "center"
      ctx.fillText("Waktu Habis!", width / 2, height / 2 - 8)
      ctx.font = `600 ${scoreFontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
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

    // labels - lebih besar untuk iOS
    ctx.fillStyle = "#111827"
    const fontSize = isIOS ? 14 : 12
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.textAlign = "center"
    const offsetY1 = isIOS ? -16 : -14
    const offsetY2 = isIOS ? -3 : -2
    ctx.fillText(`for ${t.type.toUpperCase()}`, t.x + t.w / 2, t.y + offsetY1)
    ctx.fillText(t.label, t.x + t.w / 2, t.y + offsetY2)

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
  const analogInputRef = useRef<{x: number, y: number}>({x: 0, y: 0})
  
  const handleDirChange = (dir: "left" | "right" | "up" | "down" | "analog", pressed: boolean | {x: number, y: number}) => {
    if (dir === "analog" && typeof pressed === "object") {
      // Analog input - simpan koordinat joystick
      analogInputRef.current = pressed
    } else if (typeof pressed === "boolean") {
      // Digital input (keyboard fallback)
      keysRef.current[dir as "left" | "right" | "up" | "down"] = pressed
      setKeyStates(prev => ({ ...prev, [dir]: pressed }))
    }
  }
  const handleVacuum = () => {
    console.log('🎮 Mobile vacuum button pressed!')
    toggleVacuum()
  }

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
  function drawTargetsShelf(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const targets = targetsRef.current
    if (!targets.length) return
    
    const groundY = Math.floor(height * 0.65) // Same ground level as main scene
    const minY = Math.min(...targets.map((t) => t.y))
    const maxH = Math.max(...targets.map((t) => t.h))
    const shelfY = minY + maxH + (scaledRef.current.w < 500 ? 10 : 6)
    const boardH = 12

    // papan meja
    ctx.fillStyle = "#b97728"
    ctx.fillRect(Math.floor(width * 0.12), shelfY, Math.floor(width * 0.76), boardH)

    // kaki-kaki tepat di bawah tiap target - extended to ground
    ctx.fillStyle = "#8b5e34"
    for (const t of targets) {
      const legW = Math.max(6, Math.floor(t.w * 0.08))
      const legX = t.x + t.w / 2 - legW / 2
      const legH = groundY - (shelfY + boardH) // Calculate height to reach ground
      if (legH > 0) {
        ctx.fillRect(legX, shelfY + boardH, legW, legH)
        // Add foot at bottom for stability
        ctx.fillRect(legX - 2, groundY - 3, legW + 4, 3)
      }
    }
  }

  return (
    <div 
      ref={wrapperRef} 
      className={
        "relative " + 
        (isFullscreen 
          ? isIOS 
            ? "fixed inset-0 z-50 bg-background overflow-hidden w-screen h-screen" // iOS aggressive fullscreen
            : "fixed inset-0 z-50 bg-background overflow-hidden h-screen w-screen" // Normal fullscreen
          : ""
        )
      }
      style={isFullscreen ? {
        // Aggressive fullscreen styles for complete screen takeover
        height: isIOS ? '100vh' : '100vh',
        width: isIOS ? '100vw' : '100vw',
        position: 'fixed' as const,
        top: 0,
        left: 0,
        zIndex: 9999,
        backgroundColor: 'var(--background)',
        ...(isIOS && {
          // Additional iOS-specific styles to hide Safari UI and handle safe areas
          minHeight: '100vh',
          minWidth: '100vw',
          overflow: 'hidden',
          WebkitOverflowScrolling: 'touch',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)'
        })
      } : undefined}
    >
      <div className={isFullscreen ? "h-full w-full flex flex-col" : (isIPad ? "mx-0 max-w-none bg-background overflow-hidden" : "mx-auto max-w-6xl rounded-lg border bg-background shadow-lg overflow-hidden p-2")}>
        <div className={`relative overflow-hidden isolate ${isFullscreen ? "flex-1 bg-background w-full" : (isIPad ? "bg-background min-h-[80vh] w-full" : "rounded-md bg-muted/30")}`}>
          <canvas
            ref={canvasRef}
            className={`block transition-all duration-200 ${isFullscreen ? "h-full w-full bg-background" : (isIPad ? "w-full bg-background min-h-[60vh] max-h-[66vh]" : "w-full rounded-md bg-background border-2 border-border/20")} focus:outline-none focus:ring-2 focus:ring-blue-500/50`}
            tabIndex={0}
            onTouchStart={(e) => {
              // Prevent scroll when touching canvas during game
              if (started && !gameOver) {
                e.preventDefault()
                const canvas = canvasRef.current
                if (canvas) {
                  canvas.focus()
                  console.log('🎯 Canvas focused via touch')
                }
              }
            }}
            onPointerDown={() => {
              // Auto focus canvas when clicked during game
              if (started && !gameOver) {
                const canvas = canvasRef.current
                if (canvas) {
                  canvas.focus()
                  console.log('🎯 Canvas focused via click')
                }
              }
            }}
            onFocus={() => {
              console.log('🎯 Canvas received focus')
            }}
            style={{
              touchAction: started && !gameOver ? 'none' : 'auto'
            }}
          />
          {/* Embed mobile controls inside the canvas container for compact layout on small screens */}
          {/* Embedded overlay only for iPad/tablet (compact look) */}
          {!isFullscreen && isIPad && (
            <div className="absolute left-0 right-0 bottom-0 z-40 pointer-events-none">
              <div className="pointer-events-auto w-full flex items-center justify-between px-6 pb-4">
                <MobileControls overlay vacuumActive={vacuumState} onDirChange={handleDirChange} onVacuum={handleVacuum} />
              </div>
            </div>
          )}
          {/* Start overlay */}
          {!started && countdown === null && !gameOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-auto p-4">
              <button
                className="rounded-md bg-blue-600 text-white px-6 py-3 text-base font-semibold shadow hover:bg-blue-700 focus:outline-none"
                onClick={() => {
                  // Auto focus ke canvas dan scroll ke game area
                  const canvas = canvasRef.current
                  const wrapper = wrapperRef.current
                  
                  if (canvas && wrapper) {
                    // Focus canvas terlebih dahulu
                    canvas.focus()
                    
                    // Scroll smooth ke game area pada mobile/tablet
                    if (needsMobileControls || isIPad) {
                      wrapper.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center',
                        inline: 'center'
                      })
                    }
                  }
                  
                  // Jalankan countdown setelah focus
                  startGameWithCountdown()
                }}
              >
                Start Game
              </button>
            </div>
          )}
          
          {/* Game Over Screen with Input Form - Responsive for all screen sizes */}
          {gameOver && (
            <div 
              className={`absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm pointer-events-auto p-4 ${
                // Add extra padding on small screens for better spacing, especially on iOS
                isMobile || isIOS ? 'py-6' : 'py-4'
              } overflow-y-auto`}
              style={{
                // Ensure scrolling on very small screens
                minHeight: '100%'
              }}
            >
              <div className={`text-center w-full mx-auto my-auto ${
                // Adjust max width based on screen size and fullscreen status
                // On iOS or when not fullscreen, use smaller containers
                (isFullscreen && !isIOS) ? 'max-w-sm sm:max-w-md' : 'max-w-xs sm:max-w-sm md:max-w-md'
              }`}>
                <div className={`font-bold text-red-500 mb-3 sm:mb-4 ${
                  // Responsive text sizing based on screen and fullscreen status
                  // Smaller text on iOS or non-fullscreen
                  (isFullscreen && !isIOS)
                    ? 'text-4xl sm:text-5xl md:text-6xl' 
                    : 'text-3xl sm:text-4xl md:text-5xl'
                }`}>GAME OVER</div>
                <div className={`font-semibold mb-2 ${
                  (isFullscreen && !isIOS)
                    ? 'text-lg sm:text-xl md:text-2xl' 
                    : 'text-base sm:text-lg md:text-xl'
                }`}>Final Score</div>
                <div className={`font-bold text-primary mb-4 sm:mb-6 ${
                  (isFullscreen && !isIOS)
                    ? 'text-3xl sm:text-4xl' 
                    : 'text-2xl sm:text-3xl'
                }`}>{finalScore}</div>
                
                {/* Input Form - Responsive */}
                <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6 relative z-10">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-left">
                      Nama <span className="text-red-500">*</span>
                    </label>
                    <input
                      ref={(el) => {
                        if (el && gameOver) {
                          console.log('📝 Name input mounted and ready')
                        }
                      }}
                      value={name}
                      onChange={(e) => {
                        console.log('📝 Name input onChange:', e.target.value)
                        setName(e.target.value)
                      }}
                      onFocus={() => {
                        console.log('📝 Name input focused - input now active!')
                        setIsInputting(true)
                      }}
                      onBlur={() => {
                        console.log('📝 Name input blurred')
                        setIsInputting(false)
                      }}
                      placeholder="Nama kamu"
                      className={`w-full rounded border px-3 py-2 sm:py-3 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        // Better background for iOS and better contrast
                        isIOS ? 'bg-white text-black' : 'bg-background'
                      }`}
                      autoFocus
                      disabled={saving}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      tabIndex={0}
                      style={{ 
                        WebkitTapHighlightColor: 'transparent',
                        touchAction: 'manipulation',
                        pointerEvents: 'auto'
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-left">
                      Perusahaan <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={perusahaan}
                      onChange={(e) => {
                        console.log('📝 Company input onChange:', e.target.value)
                        setPerusahaan(e.target.value)
                      }}
                      onFocus={() => {
                        console.log('📝 Company input focused')
                        setIsInputting(true)
                      }}
                      onBlur={() => {
                        console.log('📝 Company input blurred')
                        setIsInputting(false)
                      }}
                      placeholder="Nama perusahaan"
                      className={`w-full rounded border px-3 py-2 sm:py-3 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        // Better background for iOS and better contrast
                        isIOS ? 'bg-white text-black' : 'bg-background'
                      }`}
                      disabled={saving}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      tabIndex={0}
                      style={{ 
                        WebkitTapHighlightColor: 'transparent',
                        touchAction: 'manipulation',
                        pointerEvents: 'auto'
                      }}
                    />
                  </div>
                </div>

                <div className="text-xs text-muted-foreground mb-4 text-center">
                  <span className="text-red-500">*</span> Field wajib diisi
                </div>

                <div className="space-y-2 sm:space-y-3">
                  <button
                    className="w-full rounded-md bg-blue-600 text-white px-4 sm:px-6 py-2 sm:py-3 text-sm sm:text-base font-semibold shadow hover:bg-blue-700 focus:outline-none active:bg-blue-800 touch-manipulation disabled:opacity-50"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      saveScore()
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!saving && name.trim() && perusahaan.trim()) saveScore()
                    }}
                    disabled={saving || !name.trim() || !perusahaan.trim()}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    {saving ? "⏳ Menyimpan..." : "💾 Simpan & Keluar"}
                  </button>
                  <button
                    className="w-full rounded-md bg-green-600 text-white px-4 sm:px-6 py-2 sm:py-3 text-sm sm:text-base font-semibold shadow hover:bg-green-700 focus:outline-none active:bg-green-800 touch-manipulation disabled:opacity-50"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!saving) restartGame()
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!saving) restartGame()
                    }}
                    disabled={saving}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    🔄 Main Lagi
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Countdown overlay */}
          {countdown !== null && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="text-center">
                <div className="text-8xl font-bold text-primary mb-4 animate-pulse">
                  {countdown === 0 ? "GO!" : countdown}
                </div>
                <div className="text-xl text-muted-foreground mb-4">Get ready...</div>
                {isFullscreen && (
                  <div className="text-sm text-muted-foreground/80">
                    {isIOS 
                      ? "🍎 iOS Mode: True fullscreen enabled - like YouTube!" 
                      : "💡 Tip: Gunakan tombol \"Display\" di pojok kanan atas untuk mengatur kontrol"
                    }
                  </div>
                )}
              </div>
            </div>
          )}
          
          <div className={`pointer-events-none absolute ${isFullscreen ? 'left-0 right-0 top-0' : 'left-3 right-3 top-3'} z-10 ${isFullscreen ? 'px-2 pt-2' : ''}`}>
            <HUD
              score={hud.score}
              timeLeft={hud.timeLeft}
              holding={hud.holding}
              onToggleFullscreen={toggleFullscreen}
              isFullscreen={isFullscreen}
              displayMode={isFullscreen ? displayMode : undefined}
              onToggleDisplayMode={isFullscreen ? () => {
                setDisplayMode(prev => prev === 'desktop' ? 'mobile' : 'desktop')
                setAutoDetected(false) // Mark as manually changed
              } : undefined}
              onRestart={restartGame}
              autoDetected={autoDetected}
            />
          </div>
          
          {/* Display Mode toggle moved into HUD for alignment */}

          {/* Rotate hint overlay for mobile in fullscreen portrait */}
          {showRotateHint && isFullscreen && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 text-white p-6">
              <div className="rounded-lg bg-background/90 p-4 text-center text-sm text-foreground">
                <div className="mb-2 font-semibold">Putar perangkat ke lanskap</div>
                <div className="opacity-80">Untuk pengalaman terbaik, gunakan orientasi lanskap saat fullscreen.</div>
              </div>
            </div>
          )}
        </div>
        {/* Mobile controls in fullscreen - always show for iPad when fullscreen */}
        {(() => {
          // For iPad: always show in fullscreen (except during countdown or game over screen)
          if (isIPad && isFullscreen && countdown === null && !gameOver) {
            console.log('🍎 iPad fullscreen controls: showing (simple condition)', { isIPad, isFullscreen, countdown, gameOver })
            return true
          }
          
          // For other devices: use existing logic
          const shouldShowControls = isFullscreen && (displayMode === 'mobile' || needsMobileControls) && !gameOver && countdown === null && started
          console.log('🎮 Other mobile controls render check:', {
            isFullscreen,
            displayMode,
            needsMobileControls,
            gameOver,
            countdown,
            started,
            shouldShowControls
          })
          return shouldShowControls
        })() && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-end justify-stretch px-0 pb-0">
            {/* we re-render controls as overlay with pointer events enabled only on inner */}
            <div className="pointer-events-auto w-full max-w-none">
              <MobileControls overlay vacuumActive={vacuumState} onDirChange={handleDirChange} onVacuum={handleVacuum} />
            </div>
          </div>
        )}
        
        {/* Legacy bottom controls removed — controls are embedded inside the canvas container for compact layout on mobile/iPad */}
        {/* Phone-only bottom controls (non-fullscreen) */}
        {needsMobileControls && !isFullscreen && !isIPad && (
          <div className={`${isIOS ? 'mt-2 p-3' : 'mt-3 p-2'}`}>
            <MobileControls vacuumActive={vacuumState} onDirChange={handleDirChange} onVacuum={handleVacuum} />
          </div>
        )}
        
        {/* Show desktop controls below canvas on desktop (non-fullscreen) */}
        {!needsMobileControls && !isFullscreen && (
          <div className="mt-3 flex justify-center p-2">
            <DesktopControls 
              keys={keyStates} 
              vacuum={vacuumState}
              onDirChange={handleDirChange}
              onVacuum={handleVacuum} 
            />
          </div>
        )}
        
        {/* Tips only show when not in fullscreen */}
        {!isFullscreen && (
          <div className="mt-3 px-3 pb-2 text-xs opacity-70 text-center">
            {needsMobileControls
              ? "Tips: Gunakan tombol kontrol untuk menggerakkan lifter. Tekan Vacuum untuk mengambil/melepas item."
              : "Tips: Gunakan Arrow Keys/WASD untuk gerak, Spacebar untuk Vacuum. Letakkan item di target yang sesuai."}
          </div>
        )}
      </div>
    </div>
  )
}
