"use client"

import { useEffect, useState } from "react"
import GameBoard from "@/components/game/game-board"
import { Leaderboard, type LeaderboardEntry } from "@/components/game/leaderboard"
import { getSupabase } from "@/lib/supabaseClient"

export default function Page() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [scoreToSave, setScoreToSave] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [perusahaan, setPerusahaan] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Load top scores
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn("Supabase env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY and restart dev server.")
    }
    const load = async () => {
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
    }
    load()
  }, [])

  const handleGameOver = (score: number) => {
    setScoreToSave(score)
  }

  const closeModal = () => {
    setScoreToSave(null)
    setName("")
    setPerusahaan("")
    setSaving(false)
    setSaveError(null)
  }

  const saveScore = async () => {
    if (scoreToSave == null) return
    const player = name.trim() || "Player"
    const company = perusahaan.trim() || null
    setSaving(true)
    let supabase
    try {
      supabase = getSupabase()
    } catch {
      setSaveError("Supabase env tidak tersedia di client. Pastikan .env sudah diisi dan server di-restart.")
      setSaving(false)
      return
    }
    const { error } = await supabase.from("leaderboard").insert({ name: player, perusahaan: company, score: scoreToSave })
    setSaving(false)
    if (error) {
      console.error("Supabase insert failed:", error.message)
      setSaveError(`Gagal menyimpan ke database: ${error.message}. Pastikan RLS/policies mengizinkan insert & env sudah benar.`)
      // Keep modal open so user can retry. Optionally still add local fallback:
      setEntries((prev) => [{ name: player, perusahaan: company ?? undefined, score: scoreToSave }, ...prev].slice(0, 10))
      return
    } else {
      // refresh leaderboard from DB
      const { data } = await supabase
        .from("leaderboard")
        .select("name, perusahaan, score, created_at")
        .order("score", { ascending: false })
        .limit(10)
      if (data) setEntries(data as LeaderboardEntry[])
    }
    closeModal()
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
        <header className="text-center py-4 sm:py-6">
        <h1 className="text-balance text-2xl md:text-3xl font-semibold">Pick & Place Factory</h1>
      </header>
      <section className="mx-auto max-w-6xl px-3 sm:px-4 pb-6 sm:pb-8">
        <div className="flex flex-col xl:flex-row gap-4 sm:gap-6 items-start justify-center">
          <div className="flex-shrink-0 w-full max-w-3xl mx-auto xl:mx-0">
            <GameBoard onGameOver={handleGameOver} />
          </div>
          <div className="w-full xl:w-80 xl:sticky xl:top-4 flex-shrink-0 mx-auto xl:mx-0">
            <Leaderboard entries={entries} />
          </div>
        </div>
        {/* Modal: input name & company on game over */}
        {scoreToSave != null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-md bg-background p-4 shadow">
              <h3 className="mb-2 text-lg font-semibold">Simpan Skor</h3>
              <p className="mb-3 text-sm opacity-80">Skor kamu: <span className="font-bold">{scoreToSave}</span></p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs opacity-70 mb-1">Nama</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nama kamu"
                    className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs opacity-70 mb-1">Perusahaan</label>
                  <input
                    value={perusahaan}
                    onChange={(e) => setPerusahaan(e.target.value)}
                    placeholder="Perusahaan (opsional)"
                    className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {saveError && (
                <p className="mt-3 text-sm text-red-600">{saveError}</p>
              )}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button disabled={saving} onClick={closeModal} className="rounded-md border px-3 py-2 text-sm">
                  Batal
                </button>
                <button
                  disabled={saving}
                  onClick={saveScore}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
  <footer className="px-3 sm:px-4 py-6 text-center text-sm opacity-70">
        Gunakan Arrow/WASD untuk bergerak dan Space/“Vacuum” untuk mengambil/menaruh.
      </footer>
    </main>
  )
}
