"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type Props = {
  keys: { [k: string]: boolean }
  vacuum: boolean
  onDirChange: (dir: "left" | "right" | "up" | "down", pressed: boolean) => void
  onVacuum: () => void
}

function ClickableKey({ 
  children, 
  pressed, 
  onPress,
  onRelease,
  className 
}: { 
  children: React.ReactNode
  pressed: boolean
  onPress: () => void
  onRelease: () => void
  className?: string 
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "flex h-8 w-8 items-center justify-center text-xs font-semibold transition-all duration-75 select-none",
        pressed
          ? "border-blue-500 bg-blue-500/20 text-blue-700 shadow-md scale-95"
          : "border-gray-300 bg-white/80 text-gray-600 shadow-sm hover:bg-gray-50",
        className
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        onPress()
      }}
      onMouseUp={(e) => {
        e.preventDefault()
        onRelease()
      }}
      onMouseLeave={(e) => {
        e.preventDefault()
        onRelease()
      }}
      onTouchStart={(e) => {
        e.preventDefault()
        onPress()
      }}
      onTouchEnd={(e) => {
        e.preventDefault()
        onRelease()
      }}
    >
      {children}
    </Button>
  )
}

export default function DesktopControls({ keys, vacuum, onDirChange, onVacuum }: Props) {
  return (
    <div className="pointer-events-auto hidden items-center gap-6 rounded-lg bg-background/80 px-4 py-3 backdrop-blur sm:flex">
      {/* Movement Keys - Clickable */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Gerak:</span>
        <div className="grid grid-cols-3 grid-rows-2 gap-1">
          <div />
          <ClickableKey 
            pressed={keys.up}
            onPress={() => onDirChange("up", true)}
            onRelease={() => onDirChange("up", false)}
          >
            ↑
          </ClickableKey>
          <div />
          <ClickableKey 
            pressed={keys.left}
            onPress={() => onDirChange("left", true)}
            onRelease={() => onDirChange("left", false)}
          >
            ←
          </ClickableKey>
          <ClickableKey 
            pressed={keys.down}
            onPress={() => onDirChange("down", true)}
            onRelease={() => onDirChange("down", false)}
          >
            ↓
          </ClickableKey>
          <ClickableKey 
            pressed={keys.right}
            onPress={() => onDirChange("right", true)}
            onRelease={() => onDirChange("right", false)}
          >
            →
          </ClickableKey>
        </div>
        <div className="text-xs text-muted-foreground">atau WASD</div>
      </div>

      {/* Action Keys */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Aksi:</span>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-16 text-xs font-semibold transition-all duration-75 select-none",
            vacuum
              ? "border-green-500 bg-green-500/20 text-green-700 shadow-md"
              : "border-gray-300 bg-white/80 text-gray-600 shadow-sm hover:bg-gray-50"
          )}
          onClick={onVacuum}
        >
          {vacuum ? "ON" : "OFF"}
        </Button>
        <div className="text-xs text-muted-foreground">Vacuum</div>
      </div>
    </div>
  )
}