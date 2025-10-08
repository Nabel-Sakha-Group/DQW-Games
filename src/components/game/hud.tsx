"use client"

type Props = {
  score: number
  timeLeft: number
  holding?: string | null
}

export function HUD({ score, timeLeft, holding }: Props) {
  return (
    <div className="pointer-events-auto flex w-full items-center justify-between gap-2 rounded-md bg-background/70 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="text-sm md:text-base">
          <span className="opacity-70">Skor:</span> <strong>{score}</strong>
        </div>
        <div className="text-sm md:text-base">
          <span className="opacity-70">Waktu:</span> <strong>{Math.max(0, Math.ceil(timeLeft))}s</strong>
        </div>
        <div className="hidden sm:block text-sm md:text-base">
          <span className="opacity-70">Holding:</span> <strong>{holding || "-"}</strong>
        </div>
      </div>
    </div>
  )
}
