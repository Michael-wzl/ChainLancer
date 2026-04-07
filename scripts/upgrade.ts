import { ethers, upgrades } from "hardhat";

/**
 * Upgrade template script.
 * Usage:
 *   PROXY_ADDRESS=0x... CONTRACT_NAME=DataAvailability npx hardhat run scripts/upgrade.ts --network <network>
 *
 * This upgrades the implementation behind an existing UUPS proxy.
 * The caller must hold DEFAULT_ADMIN_ROLE on the proxy contract.
 */
async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;
  const contractName = process.env.CONTRACT_NAME;

  if (!proxyAddress || !contractName) {
    console.error("Usage: PROXY_ADDRESS=0x... CONTRACT_NAME=<name> npx hardhat run scripts/upgrade.ts --network <network>");
    console.error("  CONTRACT_NAME must be one of: DataAvailability, Reputation, Dispute, JobEscrow");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Upgrading contract with account:", deployer.address);
  console.log("Proxy address:", proxyAddress);
  console.log("New implementation:", contractName);

  let NewImplementation;

  // JobEscrow requires linking the external JobEscrowLib library
  if (contractName === "JobEscrow") {
    const libAddress = process.env.JOB_ESCROW_LIB_ADDRESS;
    if (!libAddress) {
      console.log("  JobEscrow requires JobEscrowLib. Deploying library...");
      const JobEscrowLib = await ethers.getContractFactory("JobEscrowLib");
      const lib = await JobEscrowLib.deploy();
      await lib.waitForDeployment();
      const deployedLibAddr = await lib.getAddress();
      console.log("  JobEscrowLib deployed to:", deployedLibAddr);
      NewImplementation = await ethers.getContractFactory(contractName, {
        libraries: { JobEscrowLib: deployedLibAddr },
      });
    } else {
      NewImplementation = await ethers.getContractFactory(contractName, {
        libraries: { JobEscrowLib: libAddress },
      });
    }
  } else {
    NewImplementation = await ethers.getContractFactory(contractName);
  }

  console.log("\nUpgrading...");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, NewImplementation, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await upgraded.waitForDeployment();

  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`\n✅ ${contractName} upgraded successfully!`);
  console.log("   Proxy address (unchanged):", proxyAddress);
  console.log("   New implementation address:", implAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
