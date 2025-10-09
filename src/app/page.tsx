"use client"

import { useEffect, useState, useCallback } from "react"
import GameBoard from "@/components/game/game-board"
import { Leaderboard, type LeaderboardEntry } from "@/components/game/leaderboard"
import { getSupabase } from "@/lib/supabaseClient"

export default function Page() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])

  // Load top scores
  const loadLeaderboard = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn("Supabase env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY and restart dev server.")
      return
    }
    let supabase
    try {
      supabase = getSupabase()
    } catch {
      return
    }
    const { data, error } = await supabase
      .from("leaderboard")
      .select("name, perusahaan, score, created_at")
      .order("score", { ascending: false })
      .limit(10)
    if (error) {
      console.error("Failed to load leaderboard:", error.message)
    } else if (data) {
      setEntries(data as LeaderboardEntry[])
    }
  }, [])

  useEffect(() => {
    loadLeaderboard()
  }, [loadLeaderboard])

  return (
    <main className="min-h-dvh bg-background text-foreground">
        <header className="text-center py-4 sm:py-6">
        <h1 className="text-balance text-2xl md:text-3xl font-semibold">Pick & Place Factory</h1>
      </header>
      <section className="mx-auto max-w-6xl px-3 sm:px-4 pb-6 sm:pb-8">
        <div className="flex flex-col xl:flex-row gap-4 sm:gap-6 items-start justify-center">
          <div className="flex-shrink-0 w-full max-w-3xl mx-auto xl:mx-0">
            <GameBoard onLeaderboardUpdate={loadLeaderboard} />
          </div>
          <div className="w-full xl:w-80 xl:sticky xl:top-4 flex-shrink-0 mx-auto xl:mx-0">
            <Leaderboard entries={entries} />
          </div>
        </div>
      </section>
  <footer className="px-3 sm:px-4 py-6 text-center text-sm opacity-70">
        Gunakan Arrow/WASD untuk bergerak dan Space/“Vacuum” untuk mengambil/menaruh.
      </footer>
    </main>
  )
}
