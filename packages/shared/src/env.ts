import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().min(20),
  GH_READ_TOKEN: z.string().startsWith("ghp_"),
  // utopia-hub Supabase — source of HR data (profiles + leave_applications +
  // leave_application_days + profile_utime_employee_map). Read-only access
  // from scanner:sync-hr. Optional so scanner:daily / scanner:weekly still
  // work without HR sync wired (graceful degrade).
  HUB_SUPABASE_URL: z.string().url().optional(),
  HUB_SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Stricter loader for scanner:sync-hr — requires HUB_* present.
export function loadHrEnv(): Env & {
  HUB_SUPABASE_URL: string;
  HUB_SUPABASE_SERVICE_ROLE_KEY: string;
} {
  const env = loadEnv();
  if (!env.HUB_SUPABASE_URL || !env.HUB_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "HR sync requires HUB_SUPABASE_URL + HUB_SUPABASE_SERVICE_ROLE_KEY env vars (set from master.env FLEET_SUPABASE_URL / FLEET_SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return env as Env & {
    HUB_SUPABASE_URL: string;
    HUB_SUPABASE_SERVICE_ROLE_KEY: string;
  };
}
