import { generateAuditReport } from "./pinataAuditUtils";

async function main() {
  const report = await generateAuditReport();

  console.log("Pinata CID audit report");
  console.log(`Generated at: ${report.generatedAt}`);
  console.log(`On-chain CIDs: ${report.onChainCids.length}`);
  console.log(`Pinata pins: ${report.pinataPins.length}`);
  console.log(`Orphan pins older than grace period (${report.gracePeriodHours}h): ${report.orphanPins.length}`);

  if (report.orphanPins.length > 0) {
    console.table(
      report.orphanPins.map((pin) => ({
        cid: pin.cid,
        createdAt: pin.createdAt ?? "unknown",
        pinataName: String(pin.metadata?.name ?? ""),
      })),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});