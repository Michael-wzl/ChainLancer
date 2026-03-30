import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// ─── Mock window.ethereum for wallet tests ───
const mockEthereum = {
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  isMetaMask: true,
};

Object.defineProperty(window, "ethereum", {
  value: mockEthereum,
  writable: true,
  configurable: true,
});

// ─── Mock import.meta.env ───
vi.stubGlobal("import", {
  meta: {
    env: {
      VITE_PINATA_JWT: "test-jwt-token",
      VITE_PINATA_GATEWAY: "test-gateway.mypinata.cloud",
      VITE_PINATA_GATEWAY_URL: "https://test-gateway.mypinata.cloud/ipfs",
      VITE_TARGET_NETWORK: "hardhat",
      VITE_MOCK_USDC_ADDRESS: "0x1234567890123456789012345678901234567890",
      VITE_JOB_ESCROW_ADDRESS: "0x2345678901234567890123456789012345678901",
      VITE_DISPUTE_ADDRESS: "0x3456789012345678901234567890123456789012",
      VITE_REPUTATION_ADDRESS: "0x4567890123456789012345678901234567890123",
      VITE_DATA_AVAILABILITY_ADDRESS: "0x5678901234567890123456789012345678901234",
    },
  },
});

// ─── Mock localStorage ───
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});
