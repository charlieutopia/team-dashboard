import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { loadHrEnv } from "@team-dashboard/shared";

// Default sync window: 90 days back + 30 days forward.
// Past: enough to backfill the last quarter's KPI history.
// Future: enough to surface approved upcoming leaves on the dashboard.
const DEFAULT_WINDOW_DAYS_BACK = 90;
const DEFAULT_WINDOW_DAYS_FORWARD = 30;

export interface SyncHrDeps {
  destSb: SupabaseClient;
  sourceSb: SupabaseClient;
  windowStart?: string; // YYYY-MM-DD inclusive
  windowEnd?: string; // YYYY-MM-DD inclusive
}

export interface SyncHrResult {
  developers_processed: number;
  developers_skipped_no_profile: number;
  leave_days_synced: number;
}

interface DevRow {
  id: string;
  github_handle: string;
  email: string;
}

interface ProfileRow {
  id: string;
  email: string;
}

interface LeaveAppRow {
  id: string;
  employee_id: string;
  leave_type: string;
  manager_approval: string;
  hr_approval: string;
}

interface LeaveDayRow {
  leave_application_id: string;
  leave_date: string;
  is_half_day: boolean;
  half_segment: string | null;
}

function shiftDate(date: Date, days: number): string {
  const dt = new Date(date.getTime());
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split("T")[0]!;
}

function defaultWindow(): { start: string; end: string } {
  const now = new Date();
  return {
    start: shiftDate(now, -DEFAULT_WINDOW_DAYS_BACK),
    end: shiftDate(now, DEFAULT_WINDOW_DAYS_FORWARD),
  };
}

export async function syncHr(deps: SyncHrDeps): Promise<SyncHrResult> {
  const { destSb, sourceSb } = deps;
  const win = defaultWindow();
  const windowStart = deps.windowStart ?? win.start;
  const windowEnd = deps.windowEnd ?? win.end;

  const counters: SyncHrResult = {
    developers_processed: 0,
    developers_skipped_no_profile: 0,
    leave_days_synced: 0,
  };

  // 1. Read developers from dest
  const devRes = await destSb
    .from("developers")
    .select("id, github_handle, email");
  if (devRes.error) {
    throw new Error(`developers query failed: ${devRes.error.message}`);
  }
  const developers = ((devRes.data ?? []) as DevRow[]).filter((d) => d.email);

  if (developers.length === 0) return counters;

  // 2. Map dev emails to source profile ids (single round-trip)
  const profileRes = await sourceSb
    .from("profiles")
    .select("id, email")
    .in(
      "email",
      developers.map((d) => d.email),
    );
  if (profileRes.error) {
    throw new Error(`profiles query failed: ${profileRes.error.message}`);
  }
  const profiles = (profileRes.data ?? []) as ProfileRow[];
  const emailToProfileId = new Map(profiles.map((p) => [p.email, p.id]));

  // 3. Bulk fetch leave applications across all matched profiles (approved-only)
  const profileIds = profiles.map((p) => p.id);
  let leaveApps: LeaveAppRow[] = [];
  if (profileIds.length > 0) {
    const appRes = await sourceSb
      .from("leave_applications")
      .select(
        "id, employee_id, leave_type, manager_approval, hr_approval",
      )
      .in("employee_id", profileIds)
      .eq("manager_approval", "approved")
      .eq("hr_approval", "approved");
    if (appRes.error) {
      throw new Error(
        `leave_applications query failed: ${appRes.error.message}`,
      );
    }
    leaveApps = (appRes.data ?? []) as LeaveAppRow[];
  }

  // 4. Bulk fetch per-date rows in window for all matched applications
  let leaveDays: LeaveDayRow[] = [];
  if (leaveApps.length > 0) {
    const dayRes = await sourceSb
      .from("leave_application_days")
      .select("leave_application_id, leave_date, is_half_day, half_segment")
      .in(
        "leave_application_id",
        leaveApps.map((a) => a.id),
      )
      .gte("leave_date", windowStart)
      .lte("leave_date", windowEnd);
    if (dayRes.error) {
      throw new Error(
        `leave_application_days query failed: ${dayRes.error.message}`,
      );
    }
    leaveDays = (dayRes.data ?? []) as LeaveDayRow[];
  }

  // 5. Index per developer: profile_id -> leave_app metadata; leave_app_id -> days
  const profileToApps = new Map<string, LeaveAppRow[]>();
  for (const app of leaveApps) {
    const arr = profileToApps.get(app.employee_id) ?? [];
    arr.push(app);
    profileToApps.set(app.employee_id, arr);
  }
  const appIdToDays = new Map<string, LeaveDayRow[]>();
  for (const d of leaveDays) {
    const arr = appIdToDays.get(d.leave_application_id) ?? [];
    arr.push(d);
    appIdToDays.set(d.leave_application_id, arr);
  }

  // 6. Per developer: delete window rows, insert current rows
  for (const dev of developers) {
    const profileId = emailToProfileId.get(dev.email);
    if (!profileId) {
      counters.developers_skipped_no_profile += 1;
      continue;
    }
    counters.developers_processed += 1;

    // Delete stale rows in the sync window for this dev
    const delRes = await destSb
      .from("developer_leave_days")
      .delete()
      .eq("developer_id", dev.id)
      .gte("leave_date", windowStart)
      .lte("leave_date", windowEnd);
    if (delRes.error) {
      console.error(
        `delete failed for ${dev.github_handle}: ${delRes.error.message}`,
      );
      continue;
    }

    // Build insert batch from approved leaves intersected with the window
    const apps = profileToApps.get(profileId) ?? [];
    const dedupe = new Map<string, any>(); // leave_date -> row (avoid (developer, date) unique conflicts if 2 apps cover same date)
    for (const app of apps) {
      const days = appIdToDays.get(app.id) ?? [];
      for (const d of days) {
        const existing = dedupe.get(d.leave_date);
        const row = {
          developer_id: dev.id,
          leave_date: d.leave_date,
          leave_type: app.leave_type,
          is_half_day: d.is_half_day,
          half_segment: d.half_segment,
          source_leave_application_id: app.id,
        };
        // If duplicate (same date from two apps), prefer a full-day record over a half-day,
        // since full-day is the conservative "on leave" assumption.
        if (!existing) {
          dedupe.set(d.leave_date, row);
        } else if (existing.is_half_day && !d.is_half_day) {
          dedupe.set(d.leave_date, row);
        }
      }
    }

    const batch = Array.from(dedupe.values());
    if (batch.length === 0) continue;

    const insRes = await destSb.from("developer_leave_days").insert(batch);
    if (insRes.error) {
      console.error(
        `insert failed for ${dev.github_handle}: ${insRes.error.message}`,
      );
      continue;
    }
    counters.leave_days_synced += batch.length;
  }

  return counters;
}

async function main() {
  const env = loadHrEnv();

  const destSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;

  const sourceSb = createClient(
    env.HUB_SUPABASE_URL,
    env.HUB_SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  ) as unknown as SupabaseClient;

  const result = await syncHr({ destSb, sourceSb });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("sync-hr failed:", err);
    process.exit(1);
  });
}
