/**
 * Tests for ipfs/gateway.ts — IPFS gateway retrieval
 *
 * Covers Stage 2 §7.2: Gateway retrieval
 * - retrieveFromIPFS fetches text from gateway URL
 * - retrieveJSON parses JSON from IPFS
 * - retrieveBinaryFromIPFS returns Uint8Array
 * - getGatewayUrl builds correct URL
 * - Error handling for fetch failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  retrieveFromIPFS,
  retrieveJSON,
  retrieveBinaryFromIPFS,
  getGatewayUrl,
} from "../../ipfs/gateway";

describe("ipfs/gateway", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("retrieveFromIPFS", () => {
    it("should fetch text content from IPFS gateway", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("Hello from IPFS"),
      } as Response);

      const content = await retrieveFromIPFS("QmTestCID");
      expect(content).toBe("Hello from IPFS");
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("QmTestCID"));
    });

    it("should throw on HTTP error", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(retrieveFromIPFS("QmBadCID")).rejects.toThrow(
        /IPFS retrieval failed: 404/
      );
    });
  });

  describe("retrieveJSON", () => {
    it("should parse JSON from IPFS", async () => {
      const data = { agreement: "terms", value: 1000 };
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(data)),
      } as Response);

      const result = await retrieveJSON<typeof data>("QmJsonCID");
      expect(result).toEqual(data);
    });
  });

  describe("retrieveBinaryFromIPFS", () => {
    it("should return binary content as Uint8Array", async () => {
      const binaryData = new Uint8Array([0, 1, 2, 3, 255]);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(binaryData.buffer),
      } as Response);

      const result = await retrieveBinaryFromIPFS("QmBinCID");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(binaryData);
    });

    it("should throw on binary fetch failure", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(retrieveBinaryFromIPFS("QmBadBin")).rejects.toThrow(
        /IPFS binary retrieval failed/
      );
    });
  });

  describe("getGatewayUrl", () => {
    it("should build a valid gateway URL", () => {
      const url = getGatewayUrl("QmTestCID");
      expect(url).toContain("QmTestCID");
      expect(url).toMatch(/^https?:\/\/.+\/QmTestCID$/);
    });
  });
});
