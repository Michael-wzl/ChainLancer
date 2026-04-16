import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";

loadEnv();

const DATA_AVAILABILITY_ABI = [
	"event CIDRegistered(uint256 indexed jobId, string cid, uint8 contentType, address uploader)",
	"function getCIDRecord(bytes32 cidHash) view returns (string cid, uint8 contentType, address uploader, uint256 jobId, uint256 registeredAt, uint256 retentionExpiry)",
];

const PINATA_API_BASE = "https://api.pinata.cloud";

export interface OnChainCidRecord {
	cid: string;
	cidHash: string;
	jobId: number;
	contentType: number;
	uploader: string;
	registeredAt: number;
	retentionExpiry: number;
}

export interface PinataPinRecord {
	cid: string;
	createdAt: string | null;
	metadata?: Record<string, unknown>;
}

export interface AuditReport {
	generatedAt: string;
	onChainCids: OnChainCidRecord[];
	pinataPins: PinataPinRecord[];
	orphanPins: PinataPinRecord[];
	gracePeriodHours: number;
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export function getAuditConfig() {
	return {
		rpcUrl: requireEnv("RPC_URL"),
		dataAvailabilityAddress: requireEnv("DATA_AVAILABILITY_ADDRESS"),
		pinataJwt: requireEnv("PINATA_JWT"),
		startBlock: process.env.START_BLOCK ? Number(process.env.START_BLOCK) : 0,
		gracePeriodHours: process.env.GRACE_PERIOD_HOURS
			? Number(process.env.GRACE_PERIOD_HOURS)
			: 24,
	};
}

export async function fetchOnChainCids(): Promise<OnChainCidRecord[]> {
	const { rpcUrl, dataAvailabilityAddress, startBlock } = getAuditConfig();
	const provider = new ethers.JsonRpcProvider(rpcUrl);
	const contract = new ethers.Contract(
		dataAvailabilityAddress,
		DATA_AVAILABILITY_ABI,
		provider,
	);

	const events = await contract.queryFilter(
		contract.filters.CIDRegistered(),
		startBlock,
		"latest",
	);

	const seen = new Set<string>();
	const records: OnChainCidRecord[] = [];

	for (const event of events) {
		const cid = "args" in event ? String(event.args?.cid ?? "") : "";
		if (!cid || seen.has(cid)) continue;
		seen.add(cid);

		const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
		const record = await contract.getCIDRecord(cidHash);

		records.push({
			cid,
			cidHash,
			jobId: Number(record.jobId),
			contentType: Number(record.contentType),
			uploader: String(record.uploader),
			registeredAt: Number(record.registeredAt),
			retentionExpiry: Number(record.retentionExpiry),
		});
	}

	return records.sort((a, b) => a.registeredAt - b.registeredAt);
}

export async function fetchPinataPins(): Promise<PinataPinRecord[]> {
	const { pinataJwt } = getAuditConfig();

	let offset = 0;
	const pageLimit = 100;
	const pins: PinataPinRecord[] = [];

	while (true) {
		const url = new URL(`${PINATA_API_BASE}/data/pinList`);
		url.searchParams.set("status", "pinned");
		url.searchParams.set("pageLimit", String(pageLimit));
		url.searchParams.set("pageOffset", String(offset));

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${pinataJwt}`,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch Pinata pins: ${response.status} ${errorText}`);
		}

		const body = await response.json() as {
			rows?: Array<{ ipfs_pin_hash: string; date_pinned?: string; metadata?: Record<string, unknown> }>;
			count?: number;
		};
		const rows = body.rows ?? [];
		for (const row of rows) {
			pins.push({
				cid: row.ipfs_pin_hash,
				createdAt: row.date_pinned ?? null,
				metadata: row.metadata,
			});
		}

		if (rows.length < pageLimit) break;
		offset += pageLimit;
	}

	return pins;
}

export function buildAuditReport(
	onChainCids: OnChainCidRecord[],
	pinataPins: PinataPinRecord[],
): AuditReport {
	const { gracePeriodHours } = getAuditConfig();
	const graceCutoffMs = Date.now() - gracePeriodHours * 60 * 60 * 1000;
	const onChainCidSet = new Set(onChainCids.map((record) => record.cid));

	const orphanPins = pinataPins.filter((pin) => {
		if (onChainCidSet.has(pin.cid)) return false;
		if (!pin.createdAt) return true;
		return new Date(pin.createdAt).getTime() <= graceCutoffMs;
	});

	return {
		generatedAt: new Date().toISOString(),
		onChainCids,
		pinataPins,
		orphanPins,
		gracePeriodHours,
	};
}

export async function generateAuditReport(): Promise<AuditReport> {
	const [onChainCids, pinataPins] = await Promise.all([
		fetchOnChainCids(),
		fetchPinataPins(),
	]);

	return buildAuditReport(onChainCids, pinataPins);
}

export async function unpinCid(cid: string): Promise<void> {
	const { pinataJwt } = getAuditConfig();
	const response = await fetch(`${PINATA_API_BASE}/pinning/unpin/${cid}`, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${pinataJwt}`,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to unpin ${cid}: ${response.status} ${errorText}`);
	}
}
