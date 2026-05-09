import type OpenAI from "openai";

export interface PollResult {
  status: "submitted" | "in_progress" | "completed" | "failed" | "cancelled" | "validating" | "finalizing" | "expired";
  outputContent?: string; // JSONL string when completed
  outputFileId?: string;
  errorMessage?: string;
}

export async function pollBatch(openai: OpenAI, batchId: string): Promise<PollResult> {
  const batch = await openai.batches.retrieve(batchId);

  if (batch.status === "completed" && batch.output_file_id) {
    const fileResponse = await openai.files.content(batch.output_file_id);
    const text = await fileResponse.text();
    return { status: "completed", outputContent: text, outputFileId: batch.output_file_id };
  }

  if (batch.status === "failed" || batch.status === "cancelled" || batch.status === "expired") {
    return { status: batch.status, errorMessage: batch.errors?.data?.[0]?.message };
  }

  // in_progress, validating, finalizing, submitted
  return { status: batch.status as any };
}
