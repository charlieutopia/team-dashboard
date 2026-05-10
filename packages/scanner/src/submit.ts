import OpenAI, { toFile } from "openai";

export async function submitBatchForJob(
  openai: OpenAI,
  batchLines: any[],
): Promise<string> {
  // Build JSONL string
  const jsonlContent = batchLines.map((line) => JSON.stringify(line)).join("\n");

  // Upload file (OpenAI SDK v4: openai.files.create, NOT openai.beta.files.upload)
  const fileResponse = await openai.files.create({
    file: await toFile(Buffer.from(jsonlContent, "utf-8"), "batch.jsonl"),
    purpose: "batch",
  });

  // Submit batch (OpenAI SDK v4: openai.batches.create, NOT openai.beta.batches.create)
  const batchResponse = await openai.batches.create({
    input_file_id: fileResponse.id,
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
  });

  return batchResponse.id;
}
