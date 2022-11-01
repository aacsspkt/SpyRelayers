import {
  ChainId,
  hexToUint8Array,
  importCoreWasm,
  postVaaSolanaWithRetry,
  tryUint8ArrayToNative,
} from '@certusone/wormhole-sdk';
import { AnchorProvider } from '@project-serum/anchor';
import {
  ConfirmOptions,
  Connection,
  Keypair,
  Transaction,
} from '@solana/web3.js';
import {
  IsCancelSolStreamPayload,
  IsCancelTokenStreamPayload,
  IsInstantSolPayload,
  IsInstantTokenPayload,
  IsPauseSolStreamPayload,
  IsPauseTokenStreamPayload,
  IsSolDepositPayload,
  IsSolStreamPayload,
  IsSolStreamUpdatePayload,
  IsSolWithdrawPayload,
  IsSolWithdrawStreamPayload,
  IsTokenDepositPayload,
  IsTokenStreamPayload,
  IsTokenStreamUpdatePayload,
  IsTokenWithdrawPayload,
  IsTokenWithdrawStreamPayload,
  MAX_VAA_UPLOAD_RETRIES_SOLANA,
  NotImplementedError,
  parseZebecPayload,
  ZebecSolBridgeClient,
} from '@zebec-io/zebec-wormhole-sdk';

import { getRelayerEnvironment } from '../../configureEnv';
import {
  getScopedLogger,
  ScopedLogger,
} from '../../helpers/logHelper';
import { PromHelper } from '../../helpers/promHelpers';
import {
  connectToRedis,
  RedisTables,
  RelayResult,
  resetPayload,
  Status,
  StorePayload,
  storePayloadFromJson,
  storePayloadToJson,
  WorkerInfo,
} from '../../helpers/redisHelper';
import { storeRelayInfo } from '../../helpers/relayArchive';
import { sleep } from '../../helpers/utils';
import {
  AUDIT_INTERVAL_MS,
  REDIS_RETRY_MS,
  Relayer,
} from '../definitions';

/** Relayer for payload 1 token bridge messages only */
export class ZebecBridgeRelayer implements Relayer {
	/** Process the relay request */
	async process(key: string, privateKey: Uint8Array, relayLogger: ScopedLogger, metrics: PromHelper): Promise<void> {
		const logger = getScopedLogger(["ZebecBridgeRelayer.process"], relayLogger);
		try {
			logger.debug("Processing request %s...", key);
			// Get the entry from the working store
			const redisClient = await connectToRedis();
			if (!redisClient) {
				logger.error("Failed to connect to Redis in processRequest");
				return;
			}
			await redisClient.select(RedisTables.WORKING);
			let value: string | null = await redisClient.get(key);
			if (!value) {
				logger.error("Could not find key %s", key);
				return;
			}
			let payload: StorePayload = storePayloadFromJson(value);
			if (payload.status !== Status.Pending) {
				logger.info("This key %s has already been processed.", key);
				return;
			}
			// Actually do the processing here and update status and time field
			let relayResult: RelayResult;
			try {
				if (payload.retries > 0) {
					logger.info("Calling with vaa_bytes %s, retry %d", payload.vaa_bytes, payload.retries);
				} else {
					logger.info("Calling with vaa_bytes %s", payload.vaa_bytes);
				}
				relayResult = await this.relay(payload.vaa_bytes, false, privateKey, logger, metrics);
				logger.info("Relay returned: %o", Status[relayResult.status]);
			} catch (e: any) {
				if (e.message) {
					logger.error("Failed to relay zebec vaa: %s", e.message);
				} else {
					logger.error("Failed to relay zebec vaa: %o", e);
				}

				relayResult = {
					status: Status.Error,
					result: e && e?.message !== undefined ? e.message : "Failure",
				};
			}

			const MAX_RETRIES = 10;

			let retry: boolean = false;
			if (relayResult.status !== Status.Completed) {
				metrics.incFailures();
				if (payload.retries >= MAX_RETRIES) {
					relayResult.status = Status.FatalError;
				}
				if (relayResult.status === Status.FatalError) {
					// Invoke fatal error logic here!
					payload.retries = MAX_RETRIES;
				} else {
					// Invoke retry logic here!
					retry = true;
				}
			}

			// Put result back into store
			payload.status = relayResult.status;
			payload.timestamp = new Date().toISOString();
			payload.retries++;
			value = storePayloadToJson(payload);
			if (!retry || payload.retries > MAX_RETRIES) {
				await redisClient.set(key, value);
			} else {
				// Remove from the working table
				await redisClient.del(key);
				// Put this back into the incoming table
				await redisClient.select(RedisTables.INCOMING);
				await redisClient.set(key, value);
			}
			await redisClient.quit();
		} catch (e: any) {
			logger.error("Unexpected error in processRequest: " + e.message);
			logger.error("request key: " + key);
			logger.error(e);
		}
	}

	/** Run one audit thread per worker so that auditors can not block other auditors or workers */
	async runAuditor(workerInfo: WorkerInfo, metrics: PromHelper): Promise<void> {
		const auditLogger = getScopedLogger([`audit-worker-${workerInfo.index}`]);
		while (true) {
			try {
				let redisClient: any = null;
				while (!redisClient) {
					redisClient = await connectToRedis();
					if (!redisClient) {
						auditLogger.error("Failed to connect to redis!");
						await sleep(REDIS_RETRY_MS);
					}
				}
				await redisClient.select(RedisTables.WORKING);
				for await (const si_key of redisClient.scanIterator()) {
					const si_value = await redisClient.get(si_key);
					if (!si_value) {
						continue;
					}

					const storePayload: StorePayload = storePayloadFromJson(si_value);
					auditLogger.debug(
						"key %s => status: %s, timestamp: %s, retries: %d",
						si_key,
						Status[storePayload.status],
						storePayload.timestamp,
						storePayload.retries,
					);
					// Let things sit in here for 10 minutes
					// After that:
					//    - Toss totally failed VAAs
					//    - Check to see if successful transactions were rolled back
					//    - Put roll backs into INCOMING table
					//    - Toss legitimately completed transactions
					const now = new Date();
					const old = new Date(storePayload.timestamp);
					const timeDelta = now.getTime() - old.getTime(); // delta is in mS
					const TEN_MINUTES = 600000;
					auditLogger.debug(
						"Checking timestamps:  now: " + now.toISOString() + ", old: " + old.toISOString() + ", delta: " + timeDelta,
					);
					if (timeDelta > TEN_MINUTES) {
						// Deal with this item
						if (storePayload.status === Status.FatalError) {
							// Done with this failed transaction
							auditLogger.debug("Discarding FatalError.");
							await redisClient.del(si_key);
							continue;
						} else if (storePayload.status === Status.Completed) {
							// Check for rollback
							auditLogger.debug("Checking for rollback.");

							//TODO actually do check if transaction is complete
							const rr = await this.relay(
								storePayload.vaa_bytes,
								true,
								workerInfo.walletPrivateKey,
								auditLogger,
								metrics,
							);

							await redisClient.del(si_key);
							if (rr.status === Status.Completed) {
								metrics.incConfirmed();
							} else {
								auditLogger.info("Detected a rollback on " + si_key);
								metrics.incRollback();
								// Remove this item from the WORKING table and move it to INCOMING
								await redisClient.select(RedisTables.INCOMING);
								await redisClient.set(si_key, storePayloadToJson(resetPayload(storePayloadFromJson(si_value))));
								await redisClient.select(RedisTables.WORKING);
							}
						} else if (storePayload.status === Status.Error) {
							auditLogger.error("Received Error status.");
							continue;
						} else if (storePayload.status === Status.Pending) {
							auditLogger.error("Received Pending status.");
							continue;
						} else {
							auditLogger.error("Unhandled Status of " + storePayload.status);
							continue;
						}
					}
				}
				redisClient.quit();
				// metrics.setDemoWalletBalance(now.getUTCSeconds());
			} catch (e) {
				auditLogger.error("spawnAuditorThread: caught exception: " + e);
			}
			await sleep(AUDIT_INTERVAL_MS);
		}
	}

	/** Parse the target chain id from the payload */
	targetChainId(payload: Buffer): ChainId {
		const zebecPayload = parseZebecPayload(payload);
		return zebecPayload.targetChain;
	}

	async relay(
		signedVAA: string,
		checkOnly: boolean,
		walletPrivateKey: Uint8Array,
		relayLogger: ScopedLogger,
		metrics: PromHelper,
	): Promise<RelayResult> {
		const logger = getScopedLogger(["relay"], relayLogger);
		const { parse_vaa } = await importCoreWasm();
		const signedVaaArray = hexToUint8Array(signedVAA);
		const parsedVaa = parse_vaa(signedVaaArray);
		const payload = parseZebecPayload(Buffer.from(parsedVaa.payload));

		const env = getRelayerEnvironment();
		const connection = new Connection(env.nodeUrl);
		const bridgeAddress = env.bridgeAddress;
		const keypair = Keypair.fromSecretKey(walletPrivateKey);
		const payerAddress = keypair.publicKey.toString();
		logger.debug("payer: %s", payerAddress);

		let relayResult: RelayResult = { status: Status.Error, result: null };

		// checking process vaa key.
		const processVaaKey = await ZebecSolBridgeClient.getProcessVaaKey(
			parsedVaa.emitter_chain as ChainId,
			parsedVaa.emitter_address,
			parsedVaa.sequence,
		);

		const processVaaInfo = await connection.getAccountInfo(processVaaKey);

		// if process vaa info in not null then it means its been already processed.
		if (processVaaInfo) {
			return { status: Status.Completed, result: "Already relayed" };
		}

		// if need to check only
		if (checkOnly) {
			return { status: Status.Pending, result: "Not relayed" };
		}

		const signTransaction = async (tx: Transaction): Promise<Transaction> => {
			tx.partialSign(keypair);
			return tx;
		};
		const signAllTransactions = async (txs: Transaction[]): Promise<Transaction[]> => {
			const promises = txs.map(async (tx) => await signTransaction(tx));
			return Promise.all(promises);
		};

		try {
			logger.info("Posting vaa");
			await postVaaSolanaWithRetry(
				connection,
				signTransaction,
				bridgeAddress,
				payerAddress,
				Buffer.from(signedVaaArray),
				MAX_VAA_UPLOAD_RETRIES_SOLANA,
			);
			logger.info("Vaa posted");
		} catch (e) {
			logger.error("Vaa post error: %o", e);
			relayResult.result = "Error in posting vaa";
			return relayResult;
		}

		const wallet = {
			publicKey: keypair.publicKey,
			signTransaction,
			signAllTransactions,
		};

		const confirmOpts: ConfirmOptions = {
			commitment: "processed",
			preflightCommitment: "confirmed",
			skipPreflight: false,
		};

		const provider = new AnchorProvider(connection, wallet, confirmOpts);
		const client = new ZebecSolBridgeClient(provider);

		await client.initialize();
		await client.registerEmitterAddress(
			tryUint8ArrayToNative(parsedVaa.emitter_address, parsedVaa.emitter_chain),
			parsedVaa.emitter_chain,
		);

		if (IsCancelTokenStreamPayload(payload)) {
			try {
				const result = await client.cancelStream(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsTokenDepositPayload(payload)) {
			try {
				const result = await client.depositToken(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsInstantTokenPayload(payload)) {
			try {
				const result = await client.instantTokenTransfer(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsPauseTokenStreamPayload(payload)) {
			try {
				const result = await client.pauseResumeStream(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsTokenStreamPayload(payload)) {
			try {
				const result = await client.initializeStream(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsTokenStreamUpdatePayload(payload)) {
			try {
				const result = await client.updateStreamToken(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsTokenWithdrawStreamPayload(payload)) {
			try {
				const result = await client.withdrawStreamToken(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsTokenWithdrawPayload(payload)) {
			try {
				const result = await client.withdrawDeposit(signedVaaArray, payload);

				if (result.status === "success") {
					metrics.incSuccesses();

					if (!result.data) {
						throw new Error("Data is undefined");
					}

					storeRelayInfo({
						chainId: parsedVaa.emitter_chain as ChainId,
						emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
						sequence: parsedVaa.sequence,
						payload: Uint8Array.from(parsedVaa.payload),
						status: "completed",
						signatures: result.data.signatures,
						streamEscrow: result.data.dataAccount,
					});

					return { status: Status.Completed, result: result.message };
				} else {
					return { status: Status.Error, result: result.message };
				}
			} catch (e) {
				logger.error("Error occurred in bridge client: %o", e);
				throw e;
			}
		}

		if (IsCancelSolStreamPayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsInstantSolPayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsSolDepositPayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsSolStreamPayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsSolStreamUpdatePayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsSolWithdrawStreamPayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsSolWithdrawPayload(payload)) {
			throw new NotImplementedError();
		}

		if (IsPauseSolStreamPayload(payload)) {
			throw new NotImplementedError();
		}

		logger.error("Payload is invalid. It's a program bug. Payload: %o", payload);
		return { status: Status.FatalError, result: "ERROR: Invalid payload type" };
	}
}
