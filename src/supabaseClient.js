// ============================================================
// supabaseClient.js
// Minimal Supabase client for PCAL live scoring.
// ============================================================
//
// Install: npm install @supabase/supabase-js@2
//
// Set env vars in .env / .env.local:
//   VITE_SUPABASE_URL=https://msvgstunqxjmmsmmumgg.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon key from Supabase project settings>
//
// If you are already using Supabase elsewhere in the app for
// game_log, you can reuse that existing client and skip this file.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://msvgstunqxjmmsmmumgg.supabase.co";

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "VITE_SUPABASE_ANON_KEY is not set. Live scoring will not work until it's configured."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});
