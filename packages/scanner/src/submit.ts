import OpenAI from "openai";

export async function submitBatchForJob(
  openai: OpenAI,
  batchLines: any[],
): Promise<string> {
  // Build JSONL string
  const jsonlContent = batchLines.map((line) => JSON.stringify(line)).join("\n");
  const jsonlBuffer = Buffer.from(jsonlContent, "utf-8");

  // Upload file
  const fileResponse = await (openai.beta as any).files.upload({
    file: new File([jsonlBuffer], "batch.jsonl", { type: "text/plain" }),
    purpose: "batch",
  });

  // Submit batch
  const batchResponse = await (openai.beta as any).batches.create({
    input_file_id: fileResponse.id,
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
  });

  return batchResponse.id;
}
