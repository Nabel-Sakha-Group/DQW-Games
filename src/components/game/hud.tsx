"use client"

type Props = {
  score: number
  timeLeft: number
  holding?: string | null
  onToggleFullscreen?: () => void
  isFullscreen?: boolean
  displayMode?: 'desktop' | 'mobile'
  onToggleDisplayMode?: () => void
  onRestart?: () => void
  autoDetected?: boolean
}

export function HUD({ score, timeLeft, holding, onToggleFullscreen, isFullscreen, displayMode, onToggleDisplayMode, onRestart, autoDetected }: Props) {
  // Deteksi iOS untuk styling khusus
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  
  // Smaller HUD for iOS non-fullscreen (canvas kecil)
  const isSmallCanvas = isIOS && !isFullscreen
  
  return (
    <div className={`pointer-events-auto flex w-full items-center justify-between rounded-lg bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm ${
      isSmallCanvas ? 'gap-1 px-2 py-1.5' : (isIOS ? 'gap-2 px-3 py-2' : 'gap-2 px-3 py-2.5')
    }`}>
      <div className={`flex items-center min-w-0 flex-1 ${isSmallCanvas ? 'gap-2' : (isIOS ? 'gap-3' : 'gap-3')}`}>
        <div className={`font-medium ${isSmallCanvas ? 'text-xs' : (isIOS ? 'text-sm' : 'text-sm')}`}>
          <span className="opacity-70">Skor:</span> <strong className="text-primary">{score}</strong>
        </div>
        <div className={`font-medium ${isSmallCanvas ? 'text-xs' : (isIOS ? 'text-sm' : 'text-sm')}`}>
          <span className="opacity-70">Waktu:</span> <strong className="text-primary">{Math.max(0, Math.ceil(timeLeft))}s</strong>
        </div>
        <div className={`hidden md:block font-medium ${isSmallCanvas ? 'text-xs' : (isIOS ? 'text-sm' : 'text-sm')}`}>
          <span className="opacity-70">Holding:</span> <strong className="text-primary">{holding || "-"}</strong>
        </div>
      </div>
      <div className={`flex items-center flex-shrink-0 ${isSmallCanvas ? 'gap-1' : 'gap-1.5'}`}>
        {typeof displayMode !== 'undefined' && onToggleDisplayMode && (
          <button
            type="button"
            className={`inline-flex items-center rounded-md font-semibold transition-all duration-200 border shadow-sm touch-manipulation ${
              isSmallCanvas ? 'px-2 py-1 text-xs' : (isIOS ? 'px-3 py-2 text-sm' : 'px-2.5 py-1.5 text-xs')
            } ${displayMode === 'mobile' ? 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-700' : 'bg-slate-700 text-white border-slate-600 hover:bg-slate-600'}`}
            onClick={onToggleDisplayMode}
            title={autoDetected ? `Auto-detected: ${displayMode}` : `Manual: ${displayMode}`}
          >
            <span className={isSmallCanvas ? '' : 'mr-1'}>{displayMode === 'mobile' ? '🎮' : '🖥️'}</span>
            <span className={isSmallCanvas ? 'hidden' : 'hidden sm:inline'}>Display: </span>
            <span className={isSmallCanvas ? 'hidden' : ''}>{displayMode === 'mobile' ? 'Mobile' : 'Desktop'}</span>
            {autoDetected && <span className={`text-green-300 ${isSmallCanvas ? 'hidden' : 'ml-1'}`}>●</span>}
          </button>
        )}
        {onRestart && (
          <button
            type="button"
            className={`inline-flex items-center rounded-md bg-green-600 text-white border-green-500 hover:bg-green-700 font-semibold transition-all duration-200 shadow-sm touch-manipulation ${
              isSmallCanvas ? 'px-2 py-1 text-xs' : (isIOS ? 'px-3 py-2 text-sm' : 'px-2.5 py-1.5 text-xs')
            }`}
            onClick={onRestart}
          >
            <span className={isSmallCanvas ? '' : 'mr-1'}>🔄</span>
            <span className={isSmallCanvas ? 'hidden' : 'hidden sm:inline'}>Restart</span>
          </button>
        )}
        {onToggleFullscreen && (
          <button
            type="button"
            className={`inline-flex items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 font-semibold transition-all duration-200 shadow-sm touch-manipulation ${
              isSmallCanvas ? 'px-2 py-1 text-xs' : (isIOS ? 'px-3 py-2 text-sm' : 'px-3 py-1.5 text-xs')
            }`}
            onClick={onToggleFullscreen}
          >
            <span className={isSmallCanvas ? '' : 'mr-1'}>{isFullscreen ? "🪟" : "🔳"}</span>
            <span className={isSmallCanvas ? 'hidden' : 'hidden sm:inline'}>{isFullscreen ? "Keluar " : ""}</span>
            <span className={isSmallCanvas ? 'hidden' : ''}>Fullscreen</span>
          </button>
        )}
      </div>
    </div>
  )
}
