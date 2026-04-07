import { run } from "hardhat";
import { upgrades } from "hardhat";

/**
 * Verify script — verifies deployed contracts on Etherscan/Basescan.
 *
 * For UUPS proxy contracts (DataAvailability, Reputation, Dispute, JobEscrow),
 * we first resolve the implementation address from the proxy, then verify the
 * implementation contract with empty constructor args (since all UUPS
 * implementations use `constructor() { _disableInitializers(); }`).
 *
 * Usage: npx hardhat run scripts/verify.ts --network baseSepolia
 *
 * Requires BASESCAN_API_KEY in .env
 */
async function main() {
  // ── Load deployed contract addresses from environment ──
  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  const DATA_AVAILABILITY_ADDRESS = process.env.DATA_AVAILABILITY_ADDRESS;
  const REPUTATION_ADDRESS = process.env.REPUTATION_ADDRESS;
  const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS;
  const JOB_ESCROW_ADDRESS = process.env.JOB_ESCROW_ADDRESS;

  if (
    !USDC_ADDRESS ||
    !DATA_AVAILABILITY_ADDRESS ||
    !REPUTATION_ADDRESS ||
    !DISPUTE_ADDRESS ||
    !JOB_ESCROW_ADDRESS
  ) {
    console.error("Missing contract addresses in environment variables.");
    console.error(
      "Set: USDC_ADDRESS, DATA_AVAILABILITY_ADDRESS, REPUTATION_ADDRESS,"
    );
    console.error("      DISPUTE_ADDRESS, JOB_ESCROW_ADDRESS");
    process.exit(1);
  }

  console.log("Verifying contracts on block explorer...\n");

  // 1. MockUSDC — standard (non-proxy) contract, no constructor args
  try {
    console.log("1. Verifying MockUSDC...");
    await run("verify:verify", {
      address: USDC_ADDRESS,
      constructorArguments: [],
    });
    console.log("   ✅ MockUSDC verified");
  } catch (e: any) {
    console.log("   ⚠️  MockUSDC:", e.message);
  }

  // 2–5. UUPS Proxy contracts
  // For each proxy we:
  //   a) Resolve the implementation address from the ERC-1967 storage slot
  //   b) Verify the implementation (constructor has zero args: _disableInitializers)
  //   c) Verify the proxy itself (ERC1967Proxy — usually auto-verified)

  const proxyContracts = [
    { name: "DataAvailability", proxy: DATA_AVAILABILITY_ADDRESS },
    { name: "Reputation", proxy: REPUTATION_ADDRESS },
    { name: "Dispute", proxy: DISPUTE_ADDRESS },
    { name: "JobEscrow", proxy: JOB_ESCROW_ADDRESS },
  ];

  for (let i = 0; i < proxyContracts.length; i++) {
    const { name, proxy } = proxyContracts[i];
    const idx = i + 2;
    try {
      console.log(`${idx}. Verifying ${name} (proxy: ${proxy})...`);

      // Get implementation address from ERC-1967 storage slot
      const implAddress =
        await upgrades.erc1967.getImplementationAddress(proxy);
      console.log(`   Implementation address: ${implAddress}`);

      // Verify the implementation contract (no constructor args for UUPS)
      await run("verify:verify", {
        address: implAddress,
        constructorArguments: [],
      });
      console.log(`   ✅ ${name} implementation verified`);

      // Also verify the proxy contract itself
      try {
        await run("verify:verify", {
          address: proxy,
          constructorArguments: [],
        });
        console.log(`   ✅ ${name} proxy verified`);
      } catch (proxyErr: any) {
        // Proxy is often auto-verified or already verified — not critical
        if (proxyErr.message?.includes("Already Verified")) {
          console.log(`   ✅ ${name} proxy already verified`);
        } else {
          console.log(`   ⚠️  ${name} proxy: ${proxyErr.message}`);
        }
      }
    } catch (e: any) {
      if (e.message?.includes("Already Verified")) {
        console.log(`   ✅ ${name} already verified`);
      } else {
        console.log(`   ⚠️  ${name}: ${e.message}`);
      }
    }
  }

  console.log("\n✅ Verification complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
