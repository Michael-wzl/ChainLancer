import { ethers, run } from "hardhat";

/**
 * Verify script — verifies deployed contracts on Etherscan/Basescan.
 *
 * Usage: npx hardhat run scripts/verify.ts --network baseSepolia
 *
 * Requires ETHERSCAN_API_KEY in .env
 */
async function main() {
  // ── Load deployed contract addresses from environment ──
  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  const DATA_AVAILABILITY_ADDRESS = process.env.DATA_AVAILABILITY_ADDRESS;
  const REPUTATION_ADDRESS = process.env.REPUTATION_ADDRESS;
  const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS;
  const JOB_ESCROW_ADDRESS = process.env.JOB_ESCROW_ADDRESS;
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS;

  if (
    !USDC_ADDRESS ||
    !DATA_AVAILABILITY_ADDRESS ||
    !REPUTATION_ADDRESS ||
    !DISPUTE_ADDRESS ||
    !JOB_ESCROW_ADDRESS ||
    !TREASURY_ADDRESS
  ) {
    console.error("Missing contract addresses in environment variables.");
    console.error("Set: USDC_ADDRESS, DATA_AVAILABILITY_ADDRESS, REPUTATION_ADDRESS,");
    console.error("      DISPUTE_ADDRESS, JOB_ESCROW_ADDRESS, TREASURY_ADDRESS");
    process.exit(1);
  }

  console.log("Verifying contracts on block explorer...\n");

  // 1. MockUSDC (no constructor args)
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

  // 2. DataAvailability (no constructor args)
  try {
    console.log("2. Verifying DataAvailability...");
    await run("verify:verify", {
      address: DATA_AVAILABILITY_ADDRESS,
      constructorArguments: [],
    });
    console.log("   ✅ DataAvailability verified");
  } catch (e: any) {
    console.log("   ⚠️  DataAvailability:", e.message);
  }

  // 3. Reputation (no constructor args)
  try {
    console.log("3. Verifying Reputation...");
    await run("verify:verify", {
      address: REPUTATION_ADDRESS,
      constructorArguments: [],
    });
    console.log("   ✅ Reputation verified");
  } catch (e: any) {
    console.log("   ⚠️  Reputation:", e.message);
  }

  // 4. Dispute (constructor: dataAvailability address)
  try {
    console.log("4. Verifying Dispute...");
    await run("verify:verify", {
      address: DISPUTE_ADDRESS,
      constructorArguments: [DATA_AVAILABILITY_ADDRESS],
    });
    console.log("   ✅ Dispute verified");
  } catch (e: any) {
    console.log("   ⚠️  Dispute:", e.message);
  }

  // 5. JobEscrow (constructor: usdc, dispute, reputation, dataAvailability, treasury)
  try {
    console.log("5. Verifying JobEscrow...");
    await run("verify:verify", {
      address: JOB_ESCROW_ADDRESS,
      constructorArguments: [
        USDC_ADDRESS,
        DISPUTE_ADDRESS,
        REPUTATION_ADDRESS,
        DATA_AVAILABILITY_ADDRESS,
        TREASURY_ADDRESS,
      ],
    });
    console.log("   ✅ JobEscrow verified");
  } catch (e: any) {
    console.log("   ⚠️  JobEscrow:", e.message);
  }

  console.log("\n✅ Verification complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
