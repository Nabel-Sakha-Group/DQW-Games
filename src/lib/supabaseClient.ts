"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
	if (client) return client
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL
	const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
	if (!url || !anonKey) {
		// Avoid throwing during SSR/prerender. Only warn in client.
		if (typeof window !== "undefined") {
			console.warn("Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY")
		}
		// Create a dummy client that will still throw on use; better than crashing build.
		// But to keep API shape, delay creation until env present.
		throw new Error("Supabase env missing")
	}
	client = createClient(url, anonKey)
	return client
}
