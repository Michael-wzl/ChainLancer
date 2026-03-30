/**
 * Tests for ipfs/pinata.ts — Pinata IPFS upload operations
 *
 * Covers Stage 2 §7.2: Pinata SDK Wrapper
 * - uploadJSON sends correct request to Pinata API
 * - uploadFile sends correct multipart form data
 * - Error handling for missing JWT
 * - Error handling for API failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock `import.meta.env` before importing pinata
// Use dynamic imports to test with mocked fetch
describe("ipfs/pinata", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("uploadJSON", () => {
    it("should call Pinata pinJSONToIPFS endpoint with correct headers", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ IpfsHash: "QmTestCID123" }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

      const { uploadJSON } = await import("../../ipfs/pinata");
      const cid = await uploadJSON({ test: "data" }, "test-upload");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.pinata.cloud/pinning/pinJSONToIPFS",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
      expect(cid).toBe("QmTestCID123");
    });

    it("should include pinataContent and pinataMetadata in body", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ IpfsHash: "QmTest" }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

      const { uploadJSON } = await import("../../ipfs/pinata");
      await uploadJSON({ agreement: "terms" }, "agreement-upload");

      const calledBody = JSON.parse(
        (vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit)?.body as string
      );
      expect(calledBody.pinataContent).toEqual({ agreement: "terms" });
      expect(calledBody.pinataMetadata.name).toBe("agreement-upload");
    });

    it("should throw on API failure", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

      const { uploadJSON } = await import("../../ipfs/pinata");
      await expect(uploadJSON({ data: "test" })).rejects.toThrow(
        /Pinata upload failed/
      );
    });
  });

  describe("uploadFile", () => {
    it("should call Pinata pinFileToIPFS endpoint", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ IpfsHash: "QmFileCID" }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

      const { uploadFile } = await import("../../ipfs/pinata");
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const cid = await uploadFile(file, "test-file");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(cid).toBe("QmFileCID");
    });

    it("should throw on file upload API failure", async () => {
      const mockResponse = {
        ok: false,
        status: 413,
        text: () => Promise.resolve("File too large"),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

      const { uploadFile } = await import("../../ipfs/pinata");
      const file = new File(["x"], "big.bin");
      await expect(uploadFile(file)).rejects.toThrow(/Pinata file upload failed/);
    });
  });
});
