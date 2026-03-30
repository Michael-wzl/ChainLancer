/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PINATA_JWT: string;
  readonly VITE_PINATA_GATEWAY_URL: string;
  readonly VITE_TARGET_NETWORK: string;
  readonly VITE_MOCK_USDC_ADDRESS: string;
  readonly VITE_JOB_ESCROW_ADDRESS: string;
  readonly VITE_DISPUTE_ADDRESS: string;
  readonly VITE_REPUTATION_ADDRESS: string;
  readonly VITE_DATA_AVAILABILITY_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: import("ethers").Eip1193Provider & {
    isMetaMask?: boolean;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  };
}
