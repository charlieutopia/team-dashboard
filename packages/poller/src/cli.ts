import { createClient } from "@supabase/supabase-js";
import {
  createGitHubClient,
  createOpenAIClient,
  loadEnv,
} from "@team-dashboard/shared";
import { pollBatch } from "./poll.js";
import { parseBatchOutput } from "./parse.js";
import { persistReports, persistDrift } from "./persist.js";
import { computeAndPersistStuckSignals } from "./stuck.js";

async function main() {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "team_dashboard" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const openai = createOpenAIClient();
  const octokit = createGitHubClient();

  // KL date = UTC + 8 hours
  const now = new Date();
  const klDate = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  // 1. Read today's batch_jobs row
  const { data: job, error } = await sb
    .from("batch_jobs")
    .select("id, openai_batch_id, status")
    .eq("job_date", klDate)
    .maybeSingle();

  if (error) throw error;

  if (!job) {
    console.log(`No batch_jobs row for ${klDate} — exit 0`);
    return;
  }

  if (job.status === "completed") {
    console.log(`Batch ${job.openai_batch_id} already completed — exit 0`);
    return;
  }

  if (job.status === "failed" || job.status === "cancelled") {
    console.log(
      `Batch ${job.openai_batch_id} status: ${job.status} — exit 0 (no recovery)`,
    );
    return;
  }

  // 2. Poll OpenAI
  console.log(`Polling batch ${job.openai_batch_id}...`);
  const result = await pollBatch(openai, job.openai_batch_id);

  // 3. Handle in-progress states
  if (
    result.status === "in_progress" ||
    result.status === "validating" ||
    result.status === "finalizing" ||
    result.status === "submitted"
  ) {
    await sb
      .from("batch_jobs")
      .update({ status: "in_progress" })
      .eq("id", job.id);
    console.log(
      `Batch ${job.openai_batch_id} still ${result.status} — exit 0 (next cron retry)`,
    );
    return;
  }

  // 4. Handle terminal error states
  if (
    result.status === "failed" ||
    result.status === "cancelled" ||
    result.status === "expired"
  ) {
    await sb
      .from("batch_jobs")
      .update({
        status: "failed",
        error_message: result.errorMessage ?? `Batch status: ${result.status}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.error(`Batch ${job.openai_batch_id} ${result.status}`);
    process.exit(1);
  }

  // 5. Completed state: parse + persist
  if (result.status === "completed" && result.outputContent) {
    console.log(`Parsing batch output...`);
    const items = parseBatchOutput(result.outputContent);
    const reports = items.filter((i) => i.kind === "report") as any;
    const drifts = items.filter((i) => i.kind === "drift") as any;
    console.log(`Parsed ${reports.length} reports + ${drifts.length} drifts`);

    // Persist reports first (drift resolution depends on them)
    console.log("Persisting reports...");
    await persistReports(sb, reports);

    console.log("Persisting drift findings...");
    await persistDrift(sb, drifts);

    // Compute stuck signals
    console.log("Computing stuck signals...");
    const { data: repos, error: reposError } = await sb
      .from("tracked_repos")
      .select("id, full_name")
      .eq("active", true);

    if (reposError) throw reposError;

    if (repos && repos.length > 0) {
      await computeAndPersistStuckSignals(sb, octokit, repos);
    } else {
      console.log("No tracked repos found");
    }

    // Mark batch as completed
    await sb
      .from("batch_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(`Batch ${job.openai_batch_id} processed successfully`);
  }
}

main().catch((err) => {
  console.error("Poller failed:", err);
  process.exit(1);
});
