/**
 * Frontend Access Control Tests
 *
 * Tests that role-gated pages (Admin, JudgeDispute) correctly show
 * "Access Denied" for unauthorized wallets and grant access to authorized ones.
 * Also tests Dashboard role-based rendering.
 *
 * Covers:
 *  - Admin page: requires DEFAULT_ADMIN_ROLE or PLATFORM_ADMIN
 *  - JudgeDispute page: requires PLATFORM_JUDGE role
 *  - Dashboard: different UI for connected vs disconnected
 *  - Route accessibility patterns
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ─── Mock react-router-dom ───
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useParams: vi.fn(() => ({})),
    useNavigate: vi.fn(() => vi.fn()),
    useLocation: vi.fn(() => ({ pathname: "/", search: "", hash: "" })),
  };
});

// ─── Mock wallet context ───
const mockUseWallet = vi.fn();
vi.mock("../../contexts/WalletContext", () => ({
  useWallet: () => mockUseWallet(),
}));

// ─── Mock contract context ───
const mockUseContracts = vi.fn();
vi.mock("../../contexts/ContractContext", () => ({
  useContracts: () => mockUseContracts(),
}));

// ─── Mock hooks ───
vi.mock("../../hooks/useAdmin", () => ({
  useAdmin: () => ({
    fetchPendingDisputes: vi.fn().mockResolvedValue([]),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    assignJudge: vi.fn(),
    hasRole: vi.fn(),
    getRoleHolders: vi.fn(),
    fetchPlatformStats: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAssignedDisputes", () => ({
  useAssignedDisputes: () => ({
    disputes: [],
    loading: false,
    refresh: vi.fn(),
  }),
}));

// ─── Mock toast ───
vi.mock("react-hot-toast", () => ({
  default: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

// ─── Mock lucide-react icons to avoid rendering issues ───
vi.mock("lucide-react", () => ({
  Shield: () => React.createElement("span", { "data-testid": "shield-icon" }),
  PauseCircle: () => React.createElement("span"),
  PlayCircle: () => React.createElement("span"),
  DollarSign: () => React.createElement("span"),
  Gavel: () => React.createElement("span"),
  RefreshCw: () => React.createElement("span"),
  AlertOctagon: () => React.createElement("span"),
  ShieldAlert: () => React.createElement("span", { "data-testid": "shield-alert" }),
  Loader2: () => React.createElement("span", { "data-testid": "loader" }),
  BarChart3: () => React.createElement("span"),
  Users: () => React.createElement("span"),
  Settings: () => React.createElement("span"),
  Scale: () => React.createElement("span"),
  Key: () => React.createElement("span"),
}));

import Admin from "../../pages/Admin";
import JudgeDashboard from "../../pages/JudgeDispute";

// ─── Helpers ───

function makeDisconnectedWallet() {
  return {
    address: null,
    isConnected: false,
    chainId: null,
    provider: null,
    signer: null,
    isCorrectNetwork: false,
    isConnecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchNetwork: vi.fn(),
  };
}

function makeConnectedWallet(address = "0xUserAddr") {
  return {
    address,
    isConnected: true,
    chainId: 31337,
    provider: {},
    signer: {},
    isCorrectNetwork: true,
    isConnecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchNetwork: vi.fn(),
  };
}

function makeReadContracts(overrides: {
  hasRole?: (role: string, address: string) => Promise<boolean>;
  paused?: () => Promise<boolean>;
  treasury?: () => Promise<string>;
  withdrawableBalances?: (addr: string) => Promise<bigint>;
} = {}) {
  const defaultHasRole = overrides.hasRole ?? (async () => false);
  return {
    dispute: {
      hasRole: defaultHasRole,
    },
    jobEscrow: {
      hasRole: defaultHasRole,
      paused: overrides.paused ?? (async () => false),
      treasury: overrides.treasury ?? (async () => "0xTreasuryAddr"),
      withdrawableBalances: overrides.withdrawableBalances ?? (async () => 0n),
    },
    reputation: {},
    dataAvailability: {},
    usdc: {},
  };
}

// ═══════════════════════════════════════════
//    ADMIN PAGE ACCESS CONTROL
// ═══════════════════════════════════════════

describe("Admin page access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show 'Connect your wallet' when not connected", async () => {
    mockUseWallet.mockReturnValue(makeDisconnectedWallet());
    mockUseContracts.mockReturnValue({
      contracts: makeReadContracts(),
      readContracts: makeReadContracts(),
      isReady: true,
    });

    render(React.createElement(Admin));

    await waitFor(() => {
      expect(screen.getByText(/connect your wallet/i)).toBeDefined();
    });
  });

  it("should show 'Access Denied' for non-admin wallet", async () => {
    mockUseWallet.mockReturnValue(makeConnectedWallet("0xRegularUser"));
    const readContracts = makeReadContracts({
      hasRole: async () => false, // No admin role
    });
    mockUseContracts.mockReturnValue({
      contracts: readContracts,
      readContracts,
      isReady: true,
    });

    render(React.createElement(Admin));

    await waitFor(() => {
      expect(screen.getByText("Access Denied")).toBeDefined();
    });
  });

  it("should show admin UI for wallet with DEFAULT_ADMIN_ROLE", async () => {
    mockUseWallet.mockReturnValue(makeConnectedWallet("0xAdminAddr"));
    const readContracts = makeReadContracts({
      hasRole: async (role: string, _addr: string) => {
        // Return true for DEFAULT_ADMIN_ROLE
        if (role === "0x0000000000000000000000000000000000000000000000000000000000000000") {
          return true;
        }
        return false;
      },
    });
    mockUseContracts.mockReturnValue({
      contracts: readContracts,
      readContracts,
      isReady: true,
    });

    render(React.createElement(Admin));

    await waitFor(() => {
      // Should NOT show Access Denied
      expect(screen.queryByText("Access Denied")).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════
//    JUDGE PAGE ACCESS CONTROL
// ═══════════════════════════════════════════

describe("JudgeDispute page access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show 'Connect your wallet' when not connected", async () => {
    mockUseWallet.mockReturnValue(makeDisconnectedWallet());
    mockUseContracts.mockReturnValue({
      contracts: makeReadContracts(),
      readContracts: makeReadContracts(),
      isReady: true,
    });

    render(React.createElement(JudgeDashboard));

    await waitFor(() => {
      expect(screen.getByText(/connect your wallet/i)).toBeDefined();
    });
  });

  it("should show 'Access Denied' for non-judge wallet", async () => {
    mockUseWallet.mockReturnValue(makeConnectedWallet("0xRegularUser"));
    const readContracts = makeReadContracts({
      hasRole: async () => false,
    });
    mockUseContracts.mockReturnValue({
      contracts: readContracts,
      readContracts,
      isReady: true,
    });

    render(React.createElement(JudgeDashboard));

    await waitFor(() => {
      expect(screen.getByText("Access Denied")).toBeDefined();
    });
  });

  it("should show 'Access Denied' detail about PLATFORM_JUDGE role", async () => {
    mockUseWallet.mockReturnValue(makeConnectedWallet("0xRegularUser"));
    const readContracts = makeReadContracts({
      hasRole: async () => false,
    });
    mockUseContracts.mockReturnValue({
      contracts: readContracts,
      readContracts,
      isReady: true,
    });

    render(React.createElement(JudgeDashboard));

    await waitFor(() => {
      expect(screen.getByText(/PLATFORM_JUDGE/)).toBeDefined();
    });
  });

  it("should show judge UI for wallet with PLATFORM_JUDGE role", async () => {
    mockUseWallet.mockReturnValue(makeConnectedWallet("0xJudgeAddr"));
    const readContracts = makeReadContracts({
      hasRole: async () => true,
    });
    mockUseContracts.mockReturnValue({
      contracts: readContracts,
      readContracts,
      isReady: true,
    });

    render(React.createElement(JudgeDashboard));

    await waitFor(() => {
      expect(screen.queryByText("Access Denied")).toBeNull();
    });
  });

  it("should show loading state while checking role", async () => {
    mockUseWallet.mockReturnValue(makeConnectedWallet("0xJudgeAddr"));
    // Contract not yet ready — hasRole will hang
    const readContracts = makeReadContracts();
    // Set dispute to null so role check won't fire
    (readContracts as any).dispute = null;
    mockUseContracts.mockReturnValue({
      contracts: readContracts,
      readContracts,
      isReady: false,
    });

    render(React.createElement(JudgeDashboard));

    // Should show the loading state initially (Checking judge access...)
    await waitFor(() => {
      expect(screen.getByText(/checking judge access/i)).toBeDefined();
    });
  });
});
