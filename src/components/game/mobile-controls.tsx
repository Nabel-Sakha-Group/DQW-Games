"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type Props = {
  onDirChange: (dir: "left" | "right" | "up" | "down", pressed: boolean) => void
  onVacuum: () => void
}

function HoldButton({
  label,
  onDown,
  onUp,
  className,
}: {
  label: string
  onDown: () => void
  onUp: () => void
  className?: string
}) {
  return (
    <Button
      variant="secondary"
      className={cn("h-10 w-10 select-none", className)}
      onMouseDown={(e) => {
        e.preventDefault()
        onDown()
      }}
      onMouseUp={(e) => {
        e.preventDefault()
        onUp()
      }}
      onMouseLeave={(e) => {
        e.preventDefault()
        onUp()
      }}
      onTouchStart={(e) => {
        e.preventDefault()
        onDown()
      }}
      onTouchEnd={(e) => {
        e.preventDefault()
        onUp()
      }}
    >
      {label}
    </Button>
  )
}

export default function MobileControls({ onDirChange, onVacuum }: Props) {
  return (
    <div className="pointer-events-auto mx-auto mt-2 grid w-full max-w-lg grid-cols-3 items-center justify-items-center gap-2">
      <div className="col-span-2 grid grid-cols-3 grid-rows-2 gap-1.5">
        <div />
        <HoldButton label="↑" onDown={() => onDirChange("up", true)} onUp={() => onDirChange("up", false)} />
        <div />
        <HoldButton label="←" onDown={() => onDirChange("left", true)} onUp={() => onDirChange("left", false)} />
        <HoldButton label="↓" onDown={() => onDirChange("down", true)} onUp={() => onDirChange("down", false)} />
        <HoldButton label="→" onDown={() => onDirChange("right", true)} onUp={() => onDirChange("right", false)} />
      </div>
      <Button className="h-10 w-full" onClick={onVacuum}>
        Vacuum
      </Button>
    </div>
  )
}
