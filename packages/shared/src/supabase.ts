import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.js";

export function createServiceRoleClient() {
  const env = loadEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
