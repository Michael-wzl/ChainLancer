import { generateAuditReport, unpinCid } from "./pinataAuditUtils";

async function main() {
  const apply = process.env.APPLY === "true";
  const report = await generateAuditReport();

  console.log(`Found ${report.orphanPins.length} orphan pins eligible for cleanup.`);

  if (!apply) {
    console.log("Dry run only. Set APPLY=true to actually unpin orphan CIDs.");
    return;
  }

  for (const pin of report.orphanPins) {
    console.log(`Unpinning ${pin.cid}...`);
    await unpinCid(pin.cid);
  }

  console.log(`Completed cleanup for ${report.orphanPins.length} orphan pins.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});