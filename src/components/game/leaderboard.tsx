"use client"

import React from "react"

export type LeaderboardEntry = {
  name: string
  perusahaan: string
  score: number
  created_at?: string
}

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="rounded-lg border bg-background shadow-sm w-full max-w-sm">
      <div className="border-b bg-muted/30 p-4 rounded-t-lg">
        <h2 className="font-semibold text-lg">Leaderboard</h2>
      </div>
      <div className="p-4">
        <ol className="space-y-2">
          {entries.length === 0 ? (
            <li className="text-center py-6 text-sm text-muted-foreground">
              <div>Belum ada skor</div>
            </li>
          ) : (
            entries.map((entry, i) => (
              <li key={`${entry.name}-${i}`} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{entry.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{entry.perusahaan}</div>
                  </div>
                </div>
                <div className="font-semibold text-primary">{entry.score}</div>
              </li>
            ))
          )}
        </ol>
        
        {entries.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="font-medium">{entries.length}</div>
                <div className="text-muted-foreground">Players</div>
              </div>
              <div>
                <div className="font-medium">{Math.max(...entries.map(e => e.score))}</div>
                <div className="text-muted-foreground">Best</div>
              </div>
              <div>
                <div className="font-medium">{Math.round(entries.reduce((sum, e) => sum + e.score, 0) / entries.length)}</div>
                <div className="text-muted-foreground">Average</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
