"use client"

type Props = {
  score: number
  timeLeft: number
  holding?: string | null
  onToggleFullscreen?: () => void
  isFullscreen?: boolean
  displayMode?: 'desktop' | 'mobile'
  onToggleDisplayMode?: () => void
}

export function HUD({ score, timeLeft, holding, onToggleFullscreen, isFullscreen, displayMode, onToggleDisplayMode }: Props) {
  return (
    <div className="pointer-events-auto flex w-full items-center justify-between gap-2 rounded-lg bg-background/80 px-3 py-2.5 backdrop-blur-sm border border-border/50 shadow-sm">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="text-sm font-medium">
          <span className="opacity-70">Skor:</span> <strong className="text-primary">{score}</strong>
        </div>
        <div className="text-sm font-medium">
          <span className="opacity-70">Waktu:</span> <strong className="text-primary">{Math.max(0, Math.ceil(timeLeft))}s</strong>
        </div>
        <div className="hidden md:block text-sm font-medium">
          <span className="opacity-70">Holding:</span> <strong className="text-primary">{holding || "-"}</strong>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {typeof displayMode !== 'undefined' && onToggleDisplayMode && (
          <button
            type="button"
            className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 border ${displayMode === 'mobile' ? 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-700' : 'bg-slate-700 text-white border-slate-600 hover:bg-slate-600'} shadow-sm`}
            onClick={onToggleDisplayMode}
          >
            <span className="mr-1">{displayMode === 'mobile' ? '🎮' : '🖥️'}</span>
            <span className="hidden sm:inline">Display: </span>{displayMode === 'mobile' ? 'Mobile' : 'Desktop'}
          </button>
        )}
        {onToggleFullscreen && (
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-200 shadow-sm"
            onClick={onToggleFullscreen}
          >
            <span className="mr-1">{isFullscreen ? "🪟" : "🔳"}</span>
            <span className="hidden sm:inline">{isFullscreen ? "Keluar " : ""}</span>Fullscreen
          </button>
        )}
      </div>
    </div>
  )
}
