import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient<any>> | null = null;

export function getSupabaseAdmin() {
  if (cached) {
    return cached;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  cached = createClient<any>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cached;
}
