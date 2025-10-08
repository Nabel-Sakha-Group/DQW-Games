"use client"

import React from "react"

export type LeaderboardEntry = {
  name: string
  perusahaan?: string
  score: number
  created_at?: string
}

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="rounded-lg border bg-background p-4 shadow-sm w-64">
      <h2 className="font-semibold text-lg mb-3">Leaderboard</h2>
      <ol className="space-y-2">
        {entries.length === 0 ? (
          <li className="text-sm opacity-70">Belum ada skor</li>
        ) : (
          entries.map((entry, i) => (
            <li key={`${entry.name}-${i}`} className="flex items-center justify-between text-sm">
              <span className="font-medium">{i + 1}. {entry.name}{entry.perusahaan ? ` — ${entry.perusahaan}` : ""}</span>
              <span className="font-bold text-blue-600">{entry.score}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  )
}
