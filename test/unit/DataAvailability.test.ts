import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFullPlatformFixture } from "../helpers/fixtures";

describe("DataAvailability", function () {
  // ═══════════════════════════════════════════════════════════
  //                  Register CID
  // ═══════════════════════════════════════════════════════════
  describe("registerCID()", function () {
    it("should register a CID", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      await expect(
        (dataAvailability.connect(deployer) as any).registerCID(
          "QmExampleCID123456789",
          0,  // ContentType.Agreement
          1   // jobId
        )
      ).to.emit(dataAvailability, "CIDRegistered")
        .withArgs(1, "QmExampleCID123456789", 0, deployer.address);

      const record = await dataAvailability.getCIDRecord(
        ethers.keccak256(ethers.toUtf8Bytes("QmExampleCID123456789"))
      );
      expect(record.uploader).to.equal(deployer.address);
    });

    it("should silently handle duplicate CID (idempotent)", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      await (dataAvailability.connect(deployer) as any).registerCID("QmDuplicate", 0, 1);
      // Duplicate CID registration should not revert — returns existing hash (idempotent)
      await (dataAvailability.connect(deployer) as any).registerCID("QmDuplicate", 0, 2);

      // Should still only have 1 CID for job 1
      const cids1 = await dataAvailability.getJobCIDs(1);
      expect(cids1.length).to.equal(1);

      // Job 2 should have 0 CIDs (duplicate was silently ignored)
      const cids2 = await dataAvailability.getJobCIDs(2);
      expect(cids2.length).to.equal(0);
    });

    it("should track job CIDs", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      await (dataAvailability.connect(deployer) as any).registerCID("QmCID1", 0, 1);
      await (dataAvailability.connect(deployer) as any).registerCID("QmCID2", 1, 1);

      const cids = await dataAvailability.getJobCIDs(1);
      expect(cids.length).to.equal(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //               Retention Expiry
  // ═══════════════════════════════════════════════════════════
  describe("setRetentionExpiry()", function () {
    it("should allow ESCROW_ROLE to set retention expiry", async function () {
      const { dataAvailability, jobEscrow, deployer } = await loadFixture(deployFullPlatformFixture);

      // Register a CID first
      await (dataAvailability.connect(deployer) as any).registerCID("QmRetention", 0, 1);

      const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      // Use impersonated signer with ESCROW_ROLE
      const escrowAddress = await jobEscrow.getAddress();
      const escrowSigner = await ethers.getImpersonatedSigner(escrowAddress);
      await ethers.provider.send("hardhat_setBalance", [
        escrowAddress,
        "0xDE0B6B3A7640000", // 1 ETH
      ]);

      await expect(
        (dataAvailability.connect(escrowSigner) as any).setRetentionExpiry(1, expiry)
      ).to.emit(dataAvailability, "RetentionExpirySet");
    });

    it("should reject from unauthorized callers", async function () {
      const { dataAvailability, deployer, client } = await loadFixture(deployFullPlatformFixture);

      await (dataAvailability.connect(deployer) as any).registerCID("QmAuth", 0, 1);

      await expect(
        (dataAvailability.connect(client) as any).setRetentionExpiry(1, 999999)
      ).to.be.reverted;
    });
  });
});
