import { describe, it, expect, vi } from "vitest";
import { pollBatch } from "../poll";
import type OpenAI from "openai";

describe("pollBatch", () => {
  it("returns completed status with output content when file exists", async () => {
    const mockFileResponse = { text: async () => "line1\nline2\n" };
    const mockOpenAI = {
      batches: {
        retrieve: vi.fn().mockResolvedValue({
          status: "completed",
          output_file_id: "file-123",
        }),
      },
      files: {
        content: vi.fn().mockResolvedValue(mockFileResponse),
      },
    } as any as OpenAI;

    const result = await pollBatch(mockOpenAI, "batch-123");
    expect(result.status).toBe("completed");
    expect(result.outputContent).toBe("line1\nline2\n");
    expect(result.outputFileId).toBe("file-123");
  });

  it("returns in_progress status when batch is still processing", async () => {
    const mockOpenAI = {
      batches: {
        retrieve: vi.fn().mockResolvedValue({
          status: "in_progress",
        }),
      },
    } as any as OpenAI;

    const result = await pollBatch(mockOpenAI, "batch-123");
    expect(result.status).toBe("in_progress");
  });

  it("returns failed status with error message", async () => {
    const mockOpenAI = {
      batches: {
        retrieve: vi.fn().mockResolvedValue({
          status: "failed",
          errors: {
            data: [{ message: "File upload failed" }],
          },
        }),
      },
    } as any as OpenAI;

    const result = await pollBatch(mockOpenAI, "batch-123");
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("File upload failed");
  });

  it("returns cancelled status", async () => {
    const mockOpenAI = {
      batches: {
        retrieve: vi.fn().mockResolvedValue({
          status: "cancelled",
        }),
      },
    } as any as OpenAI;

    const result = await pollBatch(mockOpenAI, "batch-123");
    expect(result.status).toBe("cancelled");
  });

  it("returns validating status", async () => {
    const mockOpenAI = {
      batches: {
        retrieve: vi.fn().mockResolvedValue({
          status: "validating",
        }),
      },
    } as any as OpenAI;

    const result = await pollBatch(mockOpenAI, "batch-123");
    expect(result.status).toBe("validating");
  });

  it("returns expired status", async () => {
    const mockOpenAI = {
      batches: {
        retrieve: vi.fn().mockResolvedValue({
          status: "expired",
        }),
      },
    } as any as OpenAI;

    const result = await pollBatch(mockOpenAI, "batch-123");
    expect(result.status).toBe("expired");
  });
});
