import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitBatchForJob } from "../submit.js";
import type OpenAI from "openai";

describe("submitBatchForJob", () => {
  let mockOpenAI: OpenAI;
  let mockFilesUpload: any;
  let mockBatchesCreate: any;

  beforeEach(() => {
    mockFilesUpload = vi.fn();
    mockBatchesCreate = vi.fn();

    mockOpenAI = {
      beta: {
        files: {
          upload: mockFilesUpload,
        },
        batches: {
          create: mockBatchesCreate,
        },
      },
    } as any;
  });

  it("uploads JSONL file and creates batch", async () => {
    const mockBatchLines = [
      { custom_id: "drift|1|feat/a|sha1|2025-05-09", method: "POST", url: "/v1/chat/completions", body: {} },
      { custom_id: "report|1|dev1|2025-05-09", method: "POST", url: "/v1/chat/completions", body: {} },
    ];

    mockFilesUpload.mockResolvedValue({
      id: "file_test123",
    });

    mockBatchesCreate.mockResolvedValue({
      id: "batch_test456",
    });

    const batchId = await submitBatchForJob(mockOpenAI, mockBatchLines);

    expect(batchId).toBe("batch_test456");
    expect(mockFilesUpload).toHaveBeenCalled();
    expect(mockBatchesCreate).toHaveBeenCalledWith({
      input_file_id: "file_test123",
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });
  });

  it("formats batch lines as JSONL", async () => {
    const mockBatchLines = [
      { custom_id: "test1", body: { param: "value1" } },
      { custom_id: "test2", body: { param: "value2" } },
    ];

    mockFilesUpload.mockResolvedValue({
      id: "file_123",
    });

    mockBatchesCreate.mockResolvedValue({
      id: "batch_123",
    });

    await submitBatchForJob(mockOpenAI, mockBatchLines);

    const uploadCall = mockFilesUpload.mock.calls[0];
    const file = uploadCall[0].file as File;
    const content = await file.text();

    expect(content).toContain('"custom_id":"test1"');
    expect(content).toContain('"custom_id":"test2"');
  });
});
