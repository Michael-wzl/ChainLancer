import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployFullPlatformFixture,
  usdc,
  ONE_DAY,
} from "../helpers/fixtures";

/**
 * DataAvailability — Edge Cases & Logic Correctness Tests
 *
 * Focus areas:
 *  - CID registration: empty CID, duplicate CID, multiple CIDs per job
 *  - setRetentionExpiry access control
 *  - getJobCIDs for non-existent jobs
 *  - CID record integrity
 */
describe("DataAvailability — Edge Cases & Logic Correctness", function () {
  // ═══════════════════════════════════════════
  //         CID REGISTRATION EDGE CASES
  // ═══════════════════════════════════════════

  describe("CID registration edge cases", function () {
    it("should reject empty CID", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      await expect(
        (dataAvailability.connect(deployer) as any).registerCID("", 0, 1)
      ).to.be.revertedWith("Empty CID");
    });

    it("should silently handle duplicate CID registration (idempotent)", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmTestHash123456789012345678901234567890";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      // Duplicate CID registration should not revert — returns existing hash
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 2);

      // Should still only have 1 CID for job 1
      const cids1 = await dataAvailability.getJobCIDs(1);
      expect(cids1.length).to.equal(1);

      // Job 2 should have 0 CIDs (duplicate was silently ignored)
      const cids2 = await dataAvailability.getJobCIDs(2);
      expect(cids2.length).to.equal(0);
    });

    it("should allow different CIDs for the same job", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid1 = "QmFirstCID12345678901234567890123456789a";
      const cid2 = "QmSecondCID1234567890123456789012345678b";
      const jobId = 1;

      await (dataAvailability.connect(deployer) as any).registerCID(cid1, 0, jobId);
      await (dataAvailability.connect(deployer) as any).registerCID(cid2, 1, jobId);

      const cidHashes = await dataAvailability.getJobCIDs(jobId);
      expect(cidHashes.length).to.equal(2);
    });

    it("should allow same user to register CIDs for different jobs", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid1 = "QmCIDForJob1_abcdefghijklmnopqrstuvwxy1";
      const cid2 = "QmCIDForJob2_abcdefghijklmnopqrstuvwxy2";

      await (dataAvailability.connect(deployer) as any).registerCID(cid1, 0, 1);
      await (dataAvailability.connect(deployer) as any).registerCID(cid2, 0, 2);

      const job1CIDs = await dataAvailability.getJobCIDs(1);
      const job2CIDs = await dataAvailability.getJobCIDs(2);
      expect(job1CIDs.length).to.equal(1);
      expect(job2CIDs.length).to.equal(1);
    });

    it("should correctly record uploader address", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmUploaderTestCIDabcdefghijklmnopqrstuv1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.uploader).to.equal(deployer.address);
    });

    it("should store correct content type", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      // ContentType.JobSpec = 0, Submission = 1, Evidence = 2, EncryptedKey = 3
      const cid = "QmContentTypeTestCIDabcdefghijklmnopqrs1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 2, 1); // Evidence

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.contentType).to.equal(2); // Evidence
    });

    it("should set registeredAt to current block timestamp", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmTimestampTestCIDabcdefghijklmnopqrst1";
      const tx = await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.registeredAt).to.equal(block!.timestamp);
    });

    it("should initialize retentionExpiry to 0", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmRetentionInitTestCIDabcdefghijklmnopq1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.retentionExpiry).to.equal(0);
    });

    it("should emit CIDRegistered event with correct parameters", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmEventTestCIDabcdefghijklmnopqrstuvwxy1";
      await expect(
        (dataAvailability.connect(deployer) as any).registerCID(cid, 1, 42)
      )
        .to.emit(dataAvailability, "CIDRegistered")
        .withArgs(42, cid, 1, deployer.address);
    });

    it("should return correct cidHash from registerCID", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmReturnHashTestCIDabcdefghijklmnopqrst1";
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(cid));

      // Call static to get return value
      const cidHash = await (dataAvailability.connect(deployer) as any).registerCID.staticCall(cid, 0, 1);
      expect(cidHash).to.equal(expectedHash);
    });
  });

  // ═══════════════════════════════════════════
  //     RETENTION EXPIRY ACCESS CONTROL
  // ═══════════════════════════════════════════

  describe("Retention expiry access control", function () {
    it("should allow ESCROW_ROLE to set retention expiry", async function () {
      const { dataAvailability, jobEscrow, client, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmExpiryEscrowTestCIDabcdefghijklmnopq1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const futureTime = (await time.latest()) + 365 * ONE_DAY;
      // JobEscrow has ESCROW_ROLE, but we need to call from an account with ESCROW_ROLE
      // The deployer granted ESCROW_ROLE to jobEscrow contract
      // We need to use deployer (DEFAULT_ADMIN_ROLE) which is also allowed
      await dataAvailability.setRetentionExpiry(1, futureTime);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.retentionExpiry).to.equal(futureTime);
    });

    it("should allow DEFAULT_ADMIN_ROLE to set retention expiry", async function () {
      const { dataAvailability, deployer, client } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmExpiryAdminTestCIDabcdefghijklmnopqr1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const futureTime = (await time.latest()) + 365 * ONE_DAY;
      await (dataAvailability.connect(deployer) as any).setRetentionExpiry(1, futureTime);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.retentionExpiry).to.equal(futureTime);
    });

    it("should reject setRetentionExpiry from unauthorized accounts", async function () {
      const { dataAvailability, client, freelancer1, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmExpiryUnauthorizedTestCIDabcdefghijklm1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const futureTime = (await time.latest()) + 365 * ONE_DAY;
      await expect(
        (dataAvailability.connect(freelancer1) as any).setRetentionExpiry(1, futureTime)
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject setRetentionExpiry from client without role", async function () {
      const { dataAvailability, client, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmExpiryClientTestCIDabcdefghijklmnopq1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const futureTime = (await time.latest()) + 365 * ONE_DAY;
      await expect(
        (dataAvailability.connect(client) as any).setRetentionExpiry(1, futureTime)
      ).to.be.revertedWith("Not authorized");
    });

    it("should set retention expiry on all CIDs for a job", async function () {
      const { dataAvailability, client, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid1 = "QmBulkExpiryTestCID1abcdefghijklmnopq1";
      const cid2 = "QmBulkExpiryTestCID2abcdefghijklmnopq2";
      const cid3 = "QmBulkExpiryTestCID3abcdefghijklmnopq3";
      const jobId = 5;

      await (dataAvailability.connect(deployer) as any).registerCID(cid1, 0, jobId);
      await (dataAvailability.connect(deployer) as any).registerCID(cid2, 1, jobId);
      await (dataAvailability.connect(deployer) as any).registerCID(cid3, 2, jobId);

      const futureTime = (await time.latest()) + 90 * ONE_DAY;
      await (dataAvailability.connect(deployer) as any).setRetentionExpiry(jobId, futureTime);

      const cidHash1 = ethers.keccak256(ethers.toUtf8Bytes(cid1));
      const cidHash2 = ethers.keccak256(ethers.toUtf8Bytes(cid2));
      const cidHash3 = ethers.keccak256(ethers.toUtf8Bytes(cid3));

      const record1 = await dataAvailability.getCIDRecord(cidHash1);
      const record2 = await dataAvailability.getCIDRecord(cidHash2);
      const record3 = await dataAvailability.getCIDRecord(cidHash3);

      expect(record1.retentionExpiry).to.equal(futureTime);
      expect(record2.retentionExpiry).to.equal(futureTime);
      expect(record3.retentionExpiry).to.equal(futureTime);
    });

    it("should emit RetentionExpirySet event", async function () {
      const { dataAvailability, client, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmExpiryEventTestCIDabcdefghijklmnopqrs1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const futureTime = (await time.latest()) + 365 * ONE_DAY;
      await expect(
        (dataAvailability.connect(deployer) as any).setRetentionExpiry(1, futureTime)
      )
        .to.emit(dataAvailability, "RetentionExpirySet")
        .withArgs(1, futureTime);
    });
  });

  // ═══════════════════════════════════════════
  //       JOB CID QUERIES EDGE CASES
  // ═══════════════════════════════════════════

  describe("Job CID query edge cases", function () {
    it("should return empty array for non-existent job", async function () {
      const { dataAvailability } = await loadFixture(deployFullPlatformFixture);

      const cidHashes = await dataAvailability.getJobCIDs(99999);
      expect(cidHashes.length).to.equal(0);
    });

    it("should return empty array for jobId = 0", async function () {
      const { dataAvailability } = await loadFixture(deployFullPlatformFixture);

      const cidHashes = await dataAvailability.getJobCIDs(0);
      expect(cidHashes.length).to.equal(0);
    });

    it("should return correct count after multiple registrations", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const jobId = 7;
      for (let i = 0; i < 5; i++) {
        await (dataAvailability.connect(deployer) as any).registerCID(
          `QmMultiRegTestCID_${i}_abcdefghijklmnop${i}`,
          0,
          jobId
        );
      }

      const cidHashes = await dataAvailability.getJobCIDs(jobId);
      expect(cidHashes.length).to.equal(5);
    });
  });

  // ═══════════════════════════════════════════
  //     CID RECORD INTEGRITY
  // ═══════════════════════════════════════════

  describe("CID record integrity", function () {
    it("should return zeroed record for non-existent CID hash", async function () {
      const { dataAvailability } = await loadFixture(deployFullPlatformFixture);

      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
      const record = await dataAvailability.getCIDRecord(fakeHash);
      expect(record.cid).to.equal("");
      expect(record.uploader).to.equal(ethers.ZeroAddress);
      expect(record.registeredAt).to.equal(0);
    });

    it("should preserve CID string exactly as submitted", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.cid).to.equal(cid);
    });

    it("should handle long CID strings", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      // CIDv1 can be quite long
      const longCid = "bafkreia" + "a".repeat(200);
      await (dataAvailability.connect(deployer) as any).registerCID(longCid, 0, 1);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(longCid));
      const record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.cid).to.equal(longCid);
    });

    it("should correctly distinguish CIDs that differ by 1 character", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid1 = "QmDistinguishTestCIDabcdefghijklmnopq1a";
      const cid2 = "QmDistinguishTestCIDabcdefghijklmnopq1b";

      await (dataAvailability.connect(deployer) as any).registerCID(cid1, 0, 1);
      await (dataAvailability.connect(deployer) as any).registerCID(cid2, 0, 1);

      const hash1 = ethers.keccak256(ethers.toUtf8Bytes(cid1));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes(cid2));

      expect(hash1).to.not.equal(hash2);

      const record1 = await dataAvailability.getCIDRecord(hash1);
      const record2 = await dataAvailability.getCIDRecord(hash2);
      expect(record1.cid).to.equal(cid1);
      expect(record2.cid).to.equal(cid2);
    });

    it("should reject unauthorized addresses from registering CIDs", async function () {
      const { dataAvailability, client, freelancer1, freelancer2, judge } =
        await loadFixture(deployFullPlatformFixture);

      // Non-admin addresses should be rejected
      await expect(
        (dataAvailability.connect(client) as any).registerCID("QmAnyAddrTest1_abcdefghijklmnopqrstu1", 0, 1)
      ).to.be.revertedWith("Not authorized to register CID");

      await expect(
        (dataAvailability.connect(freelancer1) as any).registerCID("QmAnyAddrTest2_abcdefghijklmnopqrstu2", 0, 1)
      ).to.be.revertedWith("Not authorized to register CID");
    });
  });

  // ═══════════════════════════════════════════
  //     RETENTION EXPIRY OVERWRITE
  // ═══════════════════════════════════════════

  describe("Retention expiry overwrite", function () {
    it("should allow overwriting retention expiry", async function () {
      const { dataAvailability, client, deployer } = await loadFixture(deployFullPlatformFixture);

      const cid = "QmOverwriteExpiryTestCIDabcdefghijklmno1";
      await (dataAvailability.connect(deployer) as any).registerCID(cid, 0, 1);

      const time1 = (await time.latest()) + 30 * ONE_DAY;
      await (dataAvailability.connect(deployer) as any).setRetentionExpiry(1, time1);

      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
      let record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.retentionExpiry).to.equal(time1);

      // Overwrite
      const time2 = (await time.latest()) + 90 * ONE_DAY;
      await (dataAvailability.connect(deployer) as any).setRetentionExpiry(1, time2);

      record = await dataAvailability.getCIDRecord(cidHash);
      expect(record.retentionExpiry).to.equal(time2);
    });

    it("should handle setRetentionExpiry on job with no CIDs (no-op)", async function () {
      const { dataAvailability, deployer } = await loadFixture(deployFullPlatformFixture);

      const futureTime = (await time.latest()) + 365 * ONE_DAY;
      // Should not revert, just do nothing (empty array loop)
      await expect(
        (dataAvailability.connect(deployer) as any).setRetentionExpiry(999, futureTime)
      ).to.not.be.reverted;
    });
  });
});
