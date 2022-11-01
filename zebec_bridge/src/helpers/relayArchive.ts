import axios from 'axios';

import {
  ChainId,
  toChainName,
  uint8ArrayToHex,
} from '@certusone/wormhole-sdk';

import { getRelayerEnvironment } from '../configureEnv';
import { getScopedLogger } from './logHelper';
import { PromHelper } from './promHelpers';
import { sleep } from './utils';

const logger = getScopedLogger(["relayArchiveApi"]);
const relayEnv = getRelayerEnvironment();
const baseUrl = relayEnv.relayArchiveApiUrl;

interface CreateRelayInfo {
	chain: string;
	emitterAddressHex: string;
	sequence: number;
	payloadHex: string;
	streamEscrow?: string;
	status: string;
	signatures: string[];
}

interface RelayInfo extends CreateRelayInfo {
	id: string;
}

enum ApiStatus {
	OFF = 0,
	ON = 1,
}

export async function getRelayInfo(data: {
	chainId: ChainId;
	emitterAddress: Uint8Array;
	sequence: number;
}): Promise<RelayInfo | null> {
	logger.info("Retrieving relay info.");

	const { chainId, emitterAddress, sequence } = data;
	const chain = toChainName(chainId).toString();
	const emitterAddressHex = uint8ArrayToHex(emitterAddress);

	const uri = baseUrl.concat(`/api/v1/RelayInfos/${chain}/${emitterAddressHex}/${sequence}`);

	const response = await axios.get(uri);

	if (response.status === 200) {
		const { id, chain, emitterAddressHex, payloadHex, sequence, status, signatures, streamEscrow } = response.data;

		return {
			id,
			chain,
			emitterAddressHex,
			payloadHex,
			sequence,
			status,
			signatures,
			streamEscrow,
		};
	}

	logger.error("Error in retrieving relay info: %0", response.data);
	return null;
}

export async function storeRelayInfo(data: {
	chainId: ChainId;
	emitterAddress: Uint8Array;
	sequence: number;
	payload: Uint8Array;
	status: "completed" | "failed";
	signatures: string[];
	streamEscrow?: string;
}) {
	logger.info("Archiving relay info.");

	const uri = baseUrl.concat("/api/v1/RelayInfos");

	const preparedData: CreateRelayInfo = {
		chain: toChainName(data.chainId).toString(),
		emitterAddressHex: uint8ArrayToHex(data.emitterAddress),
		sequence: 1,
		payloadHex: uint8ArrayToHex(data.payload),
		streamEscrow: data.streamEscrow,
		status: data.status,
		signatures: data.signatures,
	};

	const response = await axios.post(uri, preparedData);

	if (response.status === 201) {
		logger.info("Relay info archived: %o", response.data);
		return;
	}

	logger.error("Error in archiving relay info: %0", response.data);
}

async function checkRelayArchiveApiHealth(): Promise<ApiStatus> {
	logger.info("Checking relay archive api health");
	const response = await axios.get(baseUrl);
	return response.status === 200 ? ApiStatus.ON : ApiStatus.OFF;
}

export async function monitorRelayArchiveApi(ph: PromHelper) {
	const scopedLogger = getScopedLogger(["monitorRelayArchiveApi"], logger);
	const ONE_MINUTE: number = 60000;
	while (true) {
		try {
			const status = await checkRelayArchiveApiHealth();
			if (status === ApiStatus.ON) {
				ph.setRelayArchiveApiStatus(status);
			} else {
				scopedLogger.error("Relay archive api is offline.");
				ph.setRelayArchiveApiStatus(status);
			}
		} catch (e) {
			scopedLogger.error("Failed to connect relay archive api: %o", e);
		}
		await sleep(ONE_MINUTE);
	}
}
