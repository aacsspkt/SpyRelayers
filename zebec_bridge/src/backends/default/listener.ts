/** The default backend is relaying payload 1 token bridge messages only */
import {
  CHAIN_ID_SOLANA,
  ChainId,
  getEmitterAddressEth,
  getEmitterAddressSolana,
  getEmitterAddressTerra,
  isTerraChain,
  parseTransferPayload,
  uint8ArrayToHex,
} from '@certusone/wormhole-sdk';
import {
  CancelSolStreamPayload,
  CancelTokenStreamPayload,
  InstantSolTransferPayload,
  InstantTokenTransferPayload,
  ParsedVaa,
  ParsedZebecPayload,
  parseVaaTyped,
  PauseSolStreamPayload,
  PauseTokenStreamPayload,
  SolDepositPayload,
  SolStreamPayload,
  SolStreamUpdatePayload,
  SolWithdrawPayload,
  SolWithdrawStreamPayload,
  TokenDepositPayload,
  TokenStreamPayload,
  TokenStreamUpdatePayload,
  TokenWithdrawPayload,
  TokenWithdrawStreamPayload,
  ZebecPayloadId,
} from '@zebec-io/zebec-wormhole-sdk';

import { getListenerEnvironment } from '../../configureEnv';
import {
  getScopedLogger,
  ScopedLogger,
} from '../../helpers/logHelper';
import {
  checkQueue,
  initPayloadWithVAA,
  storeInRedis,
  StoreKey,
  storeKeyFromParsedVAA,
  storeKeyToJson,
  StorePayload,
  storePayloadToJson,
} from '../../helpers/redisHelper';
import {
  Listener,
  TypedFilter,
} from '../definitions';

async function encodeEmitterAddress(myChainId: ChainId, emitterAddressStr: string): Promise<string> {
	if (myChainId === CHAIN_ID_SOLANA) {
		return await getEmitterAddressSolana(emitterAddressStr);
	}

	if (isTerraChain(myChainId)) {
		return await getEmitterAddressTerra(emitterAddressStr);
	}

	return getEmitterAddressEth(emitterAddressStr);
}

/** Listener for payload 1 token bridge messages only */
export class ZebecBridgeLister implements Listener {
	logger: ScopedLogger;

	/**
	 * @throws - when the listener environment setup fails
	 */
	constructor() {
		this.logger = getScopedLogger(["ZebecBridgeLister"]);
	}

	/** Parses a raw VAA byte array
	 *
	 * @throws when unable to parse the VAA
	 */
	public async parseVaa(rawVaa: Uint8Array): Promise<ParsedVaa<Uint8Array>> {
		let parsedVaa: ParsedVaa<Uint8Array> | null = null;

		try {
			parsedVaa = await parseVaaTyped(rawVaa);
		} catch (e) {
			this.logger.error("Encountered error while parsing raw VAA " + e);
		}
		if (!parsedVaa) {
			throw new Error("Unable to parse the specified VAA.");
		}

		return parsedVaa;
	}

	/** Parse the VAA and return the payload nicely typed */
	public async parsePayload(rawPayload: Uint8Array): Promise<ParsedZebecPayload> {
		let parsedPayload: any;
		try {
			parsedPayload = parseTransferPayload(Buffer.from(rawPayload));
		} catch (e) {
			this.logger.error("Encountered error while parsing vaa payload" + e);
		}

		if (!parsedPayload) {
			this.logger.debug("Failed to parse the transfer payload.");
			throw new Error("Could not parse the transfer payload.");
		}
		return parsedPayload;
	}

	/** Verify this is a VAA we want to relay. */
	public async validate(rawVaa: Uint8Array): Promise<ParsedVaa<ParsedZebecPayload> | string> {
		let parsedVaa = await this.parseVaa(rawVaa);
		let parsedPayload: ParsedZebecPayload;
		try {
			parsedPayload = await this.parsePayload(parsedVaa.payload);
		} catch (e: any) {
			return "Payload parsing failure";
		}

		// Great success!
		return { ...parsedVaa, payload: parsedPayload };
	}

	/** Get spy filters for all emitters we care about */
	public async getEmitterFilters(): Promise<TypedFilter[]> {
		let env = getListenerEnvironment();
		let filters: {
			emitterFilter: { chainId: ChainId; emitterAddress: string };
		}[] = [];
		for (let i = 0; i < env.spyServiceFilters.length; i++) {
			const filter = env.spyServiceFilters[i];
			this.logger.info(
				"Getting spyServiceFilter[" +
					i +
					"]: chainId = " +
					filter.chainId +
					", emmitterAddress = [" +
					filter.emitterAddress +
					"]",
			);
			const typedFilter = {
				emitterFilter: {
					chainId: filter.chainId as ChainId,
					emitterAddress: await encodeEmitterAddress(filter.chainId, filter.emitterAddress),
				},
			};
			this.logger.info(
				"adding filter: chainId: [" +
					typedFilter.emitterFilter.chainId +
					"], emitterAddress: [" +
					typedFilter.emitterFilter.emitterAddress +
					"]",
			);
			filters.push(typedFilter);
		}
		return filters;
	}

	/** Process and validate incoming VAAs from the spy. */
	public async process(rawVaa: Uint8Array): Promise<void> {
		// TODO: Use a type guard function to verify the ParsedVaa type too?
		const validationResults: ParsedVaa<ParsedZebecPayload> | string = await this.validate(rawVaa);

		if (typeof validationResults === "string") {
			this.logger.debug(`Skipping spied request: ${validationResults}`);
			return;
		}
		const parsedVaa: ParsedVaa<ParsedZebecPayload> = validationResults;

		const redisKey: StoreKey = storeKeyFromParsedVAA(parsedVaa);
		const isQueued = await checkQueue(storeKeyToJson(redisKey));
		if (isQueued) {
			this.logger.error(`Not storing in redis: ${isQueued}`);
			return;
		}

		const logMessage = makeLogMessage(parsedVaa);
		this.logger.info(logMessage);

		const redisPayload: StorePayload = initPayloadWithVAA(uint8ArrayToHex(rawVaa));

		await this.store(redisKey, redisPayload);
	}

	public async store(key: StoreKey, payload: StorePayload): Promise<void> {
		let serializedKey = storeKeyToJson(key);
		let serializedPayload = storePayloadToJson(payload);

		this.logger.debug(
			`storing: key: [${key.chain_id}/${key.emitter_address}/${key.sequence}], payload: [${serializedPayload}]`,
		);

		return await storeInRedis(serializedKey, serializedPayload);
	}
}

function makeLogMessage(parsedVaa: ParsedVaa<ParsedZebecPayload>) {
	let message =
		"forwarding vaa to relayer: emitter: [" +
		parsedVaa.emitterChain +
		":" +
		uint8ArrayToHex(parsedVaa.emitterAddress) +
		"], seqNum: " +
		parsedVaa.sequence +
		", targetChain: " +
		parsedVaa.payload.targetChain;

	switch (parsedVaa.payload.id) {
		case ZebecPayloadId.CancelSolStream:
			let cssPayload = parsedVaa.payload as CancelSolStreamPayload;
			message.concat(", sender: " + uint8ArrayToHex(cssPayload.sender));
			break;

		case ZebecPayloadId.CancelTokenStream:
			let ctsPayload = parsedVaa.payload as CancelTokenStreamPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(ctsPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(ctsPayload.recipient) +
					", tokenMint: " +
					uint8ArrayToHex(ctsPayload.tokenMint) +
					", dataAccount: " +
					uint8ArrayToHex(ctsPayload.dataAccount),
			);
			break;

		case ZebecPayloadId.DepositSol:
			let dsPayload = parsedVaa.payload as SolDepositPayload;
			message.concat(", sender: " + uint8ArrayToHex(dsPayload.sender) + ", amount: " + dsPayload.amount);
			break;

		case ZebecPayloadId.DepositToken:
			let dkPayload = parsedVaa.payload as TokenDepositPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(dkPayload.sender) +
					", token: " +
					uint8ArrayToHex(dkPayload.tokenMint) +
					", amount: " +
					dkPayload.amount,
			);
			break;
		case ZebecPayloadId.InstantSol:
			let isPayload = parsedVaa.payload as InstantSolTransferPayload;
			message.concat(
				", sender: " + isPayload.sender + ", recipient: " + isPayload.recipient + ", amount: " + isPayload.amount,
			);
			break;

		case ZebecPayloadId.InstantToken:
			let ikPayload = parsedVaa.payload as InstantTokenTransferPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(ikPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(ikPayload.recipient) +
					", token: " +
					uint8ArrayToHex(ikPayload.tokenMint) +
					", amount: " +
					ikPayload.amount,
			);
			break;

		case ZebecPayloadId.PauseSolStream:
			let pssPayload = parsedVaa.payload as PauseSolStreamPayload;
			message.concat(", sender: " + uint8ArrayToHex(pssPayload.sender));
			break;

		case ZebecPayloadId.PauseTokenStream:
			let ptsPayload = parsedVaa.payload as PauseTokenStreamPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(ptsPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(ptsPayload.recipient) +
					", token: " +
					uint8ArrayToHex(ptsPayload.tokenMint) +
					", dataAccout: " +
					uint8ArrayToHex(ptsPayload.dataAccount),
			);
			break;

		case ZebecPayloadId.SolStream:
			let ssPayload = parsedVaa.payload as SolStreamPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(ssPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(ssPayload.recipient) +
					", startTime: " +
					ssPayload.startTime +
					", endTime: " +
					ssPayload.endTime +
					", canCancel: " +
					ssPayload.canCancel +
					", canUpdate: " +
					ssPayload.canUpdate +
					", amount: " +
					ssPayload.amount,
			);
			break;

		case ZebecPayloadId.SolStreamUpdate:
			let ssuPayload = parsedVaa.payload as SolStreamUpdatePayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(ssuPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(ssuPayload.recipient) +
					", startTime: " +
					ssuPayload.startTime +
					", endTime: " +
					ssuPayload.endTime +
					", amount: " +
					ssuPayload.amount,
			);
			break;

		case ZebecPayloadId.SolWithdrawStream:
			let swsPayload = parsedVaa.payload as SolWithdrawStreamPayload;
			message.concat(", withdrawer: " + uint8ArrayToHex(swsPayload.withdrawer));
			break;

		case ZebecPayloadId.TokenStream:
			let tsPayload = parsedVaa.payload as TokenStreamPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(tsPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(tsPayload.recipient) +
					", token: " +
					uint8ArrayToHex(tsPayload.tokenMint) +
					", startTime: " +
					tsPayload.startTime +
					", endTime: " +
					tsPayload.endTime +
					", canCancel: " +
					tsPayload.canCancel +
					", canUpdate: " +
					tsPayload.canUpdate +
					", amount: " +
					tsPayload.amount,
			);
			break;

		case ZebecPayloadId.TokenStreamUpdate:
			let tsuPayload = parsedVaa.payload as TokenStreamUpdatePayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(tsuPayload.sender) +
					", recipient: " +
					uint8ArrayToHex(tsuPayload.recipient) +
					", token: " +
					uint8ArrayToHex(tsuPayload.tokenMint) +
					", dataAccount: " +
					uint8ArrayToHex(tsuPayload.tokenMint) +
					", startTime: " +
					tsuPayload.startTime +
					", endTime: " +
					tsuPayload.endTime +
					", amount: " +
					tsuPayload.amount,
			);
			break;

		case ZebecPayloadId.TokenWithdrawStream:
			let twsPayload = parsedVaa.payload as TokenWithdrawStreamPayload;
			message.concat(
				", sender: " +
					uint8ArrayToHex(twsPayload.sender) +
					", withdrawer: " +
					uint8ArrayToHex(twsPayload.withdrawer) +
					", token: " +
					uint8ArrayToHex(twsPayload.tokenMint) +
					", dataAccount: " +
					uint8ArrayToHex(twsPayload.dataAccount),
			);
			break;

		case ZebecPayloadId.WithdrawSol:
			let wsPayload = parsedVaa.payload as SolWithdrawPayload;
			message.concat(", withdrawer: " + wsPayload.withdrawer + ", amount: " + wsPayload.amount);
			break;

		case ZebecPayloadId.WithdrawToken:
			let wkPayload = parsedVaa.payload as TokenWithdrawPayload;
			message.concat(
				", withdrawer: " +
					uint8ArrayToHex(wkPayload.withdrawer) +
					", token: " +
					uint8ArrayToHex(wkPayload.tokenMint) +
					", amount: " +
					wkPayload.amount,
			);
			break;
	}
	return message;
}
