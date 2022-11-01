"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenBridgeRelayer = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const configureEnv_1 = require("../../configureEnv");
const logHelper_1 = require("../../helpers/logHelper");
const redisHelper_1 = require("../../helpers/redisHelper");
const utils_1 = require("../../helpers/utils");
const evm_1 = require("../../relayer/evm");
const solana_1 = require("../../relayer/solana");
const terra_1 = require("../../relayer/terra");
const definitions_1 = require("../definitions");
function getChainConfigInfo(chainId) {
    const env = (0, configureEnv_1.getRelayerEnvironment)();
    return env.supportedChains.find((x) => x.chainId === chainId);
}
/** Relayer for payload 1 token bridge messages only */
class TokenBridgeRelayer {
    /** Process the relay request */
    async process(key, privateKey, relayLogger, metrics) {
        const logger = (0, logHelper_1.getScopedLogger)(["TokenBridgeRelayer.process"], relayLogger);
        try {
            logger.debug("Processing request %s...", key);
            // Get the entry from the working store
            const redisClient = await (0, redisHelper_1.connectToRedis)();
            if (!redisClient) {
                logger.error("Failed to connect to Redis in processRequest");
                return;
            }
            await redisClient.select(redisHelper_1.RedisTables.WORKING);
            let value = await redisClient.get(key);
            if (!value) {
                logger.error("Could not find key %s", key);
                return;
            }
            let payload = (0, redisHelper_1.storePayloadFromJson)(value);
            if (payload.status !== redisHelper_1.Status.Pending) {
                logger.info("This key %s has already been processed.", key);
                return;
            }
            // Actually do the processing here and update status and time field
            let relayResult;
            try {
                if (payload.retries > 0) {
                    logger.info("Calling with vaa_bytes %s, retry %d", payload.vaa_bytes, payload.retries);
                }
                else {
                    logger.info("Calling with vaa_bytes %s", payload.vaa_bytes);
                }
                relayResult = await this.relay(payload.vaa_bytes, false, privateKey, logger, metrics);
                logger.info("Relay returned: %o", redisHelper_1.Status[relayResult.status]);
            }
            catch (e) {
                if (e.message) {
                    logger.error("Failed to relay transfer vaa: %s", e.message);
                }
                else {
                    logger.error("Failed to relay transfer vaa: %o", e);
                }
                relayResult = {
                    status: redisHelper_1.Status.Error,
                    result: e && e?.message !== undefined ? e.message : "Failure",
                };
            }
            const MAX_RETRIES = 10;
            let targetChain = wormhole_sdk_1.CHAIN_ID_UNSET;
            try {
                const { parse_vaa } = await (0, wormhole_sdk_1.importCoreWasm)();
                const parsedVAA = parse_vaa((0, wormhole_sdk_1.hexToUint8Array)(payload.vaa_bytes));
                const transferPayload = (0, wormhole_sdk_1.parseTransferPayload)(Buffer.from(parsedVAA.payload));
                targetChain = transferPayload.targetChain;
            }
            catch (e) { }
            let retry = false;
            if (relayResult.status !== redisHelper_1.Status.Completed) {
                metrics.incFailures(targetChain);
                if (payload.retries >= MAX_RETRIES) {
                    relayResult.status = redisHelper_1.Status.FatalError;
                }
                if (relayResult.status === redisHelper_1.Status.FatalError) {
                    // Invoke fatal error logic here!
                    payload.retries = MAX_RETRIES;
                }
                else {
                    // Invoke retry logic here!
                    retry = true;
                }
            }
            // Put result back into store
            payload.status = relayResult.status;
            payload.timestamp = new Date().toISOString();
            payload.retries++;
            value = (0, redisHelper_1.storePayloadToJson)(payload);
            if (!retry || payload.retries > MAX_RETRIES) {
                await redisClient.set(key, value);
            }
            else {
                // Remove from the working table
                await redisClient.del(key);
                // Put this back into the incoming table
                await redisClient.select(redisHelper_1.RedisTables.INCOMING);
                await redisClient.set(key, value);
            }
            await redisClient.quit();
        }
        catch (e) {
            logger.error("Unexpected error in processRequest: " + e.message);
            logger.error("request key: " + key);
            logger.error(e);
        }
    }
    /** Run one audit thread per worker so that auditors can not block other auditors or workers */
    async runAuditor(workerInfo, metrics) {
        const auditLogger = (0, logHelper_1.getScopedLogger)([`audit-worker-${workerInfo.targetChainName}-${workerInfo.index}`]);
        while (true) {
            try {
                let redisClient = null;
                while (!redisClient) {
                    redisClient = await (0, redisHelper_1.connectToRedis)();
                    if (!redisClient) {
                        auditLogger.error("Failed to connect to redis!");
                        await (0, utils_1.sleep)(definitions_1.REDIS_RETRY_MS);
                    }
                }
                await redisClient.select(redisHelper_1.RedisTables.WORKING);
                for await (const si_key of redisClient.scanIterator()) {
                    const si_value = await redisClient.get(si_key);
                    if (!si_value) {
                        continue;
                    }
                    const storePayload = (0, redisHelper_1.storePayloadFromJson)(si_value);
                    try {
                        const { parse_vaa } = await (0, wormhole_sdk_1.importCoreWasm)();
                        const parsedVAA = parse_vaa((0, wormhole_sdk_1.hexToUint8Array)(storePayload.vaa_bytes));
                        const payloadBuffer = Buffer.from(parsedVAA.payload);
                        const transferPayload = (0, wormhole_sdk_1.parseTransferPayload)(payloadBuffer);
                        const chain = transferPayload.targetChain;
                        if (chain !== workerInfo.targetChainId) {
                            continue;
                        }
                    }
                    catch (e) {
                        auditLogger.error("Failed to parse a stored VAA: " + e);
                        auditLogger.error("si_value of failure: " + si_value);
                        continue;
                    }
                    auditLogger.debug("key %s => status: %s, timestamp: %s, retries: %d", si_key, redisHelper_1.Status[storePayload.status], storePayload.timestamp, storePayload.retries);
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
                    auditLogger.debug("Checking timestamps:  now: " + now.toISOString() + ", old: " + old.toISOString() + ", delta: " + timeDelta);
                    if (timeDelta > TEN_MINUTES) {
                        // Deal with this item
                        if (storePayload.status === redisHelper_1.Status.FatalError) {
                            // Done with this failed transaction
                            auditLogger.debug("Discarding FatalError.");
                            await redisClient.del(si_key);
                            continue;
                        }
                        else if (storePayload.status === redisHelper_1.Status.Completed) {
                            // Check for rollback
                            auditLogger.debug("Checking for rollback.");
                            //TODO actually do an isTransferCompleted
                            const rr = await this.relay(storePayload.vaa_bytes, true, workerInfo.walletPrivateKey, auditLogger, metrics);
                            await redisClient.del(si_key);
                            if (rr.status === redisHelper_1.Status.Completed) {
                                metrics.incConfirmed(workerInfo.targetChainId);
                            }
                            else {
                                auditLogger.info("Detected a rollback on " + si_key);
                                metrics.incRollback(workerInfo.targetChainId);
                                // Remove this item from the WORKING table and move it to INCOMING
                                await redisClient.select(redisHelper_1.RedisTables.INCOMING);
                                await redisClient.set(si_key, (0, redisHelper_1.storePayloadToJson)((0, redisHelper_1.resetPayload)((0, redisHelper_1.storePayloadFromJson)(si_value))));
                                await redisClient.select(redisHelper_1.RedisTables.WORKING);
                            }
                        }
                        else if (storePayload.status === redisHelper_1.Status.Error) {
                            auditLogger.error("Received Error status.");
                            continue;
                        }
                        else if (storePayload.status === redisHelper_1.Status.Pending) {
                            auditLogger.error("Received Pending status.");
                            continue;
                        }
                        else {
                            auditLogger.error("Unhandled Status of " + storePayload.status);
                            continue;
                        }
                    }
                }
                redisClient.quit();
                // metrics.setDemoWalletBalance(now.getUTCSeconds());
            }
            catch (e) {
                auditLogger.error("spawnAuditorThread: caught exception: " + e);
            }
            await (0, utils_1.sleep)(definitions_1.AUDIT_INTERVAL_MS);
        }
    }
    /** Parse the target chain id from the payload */
    targetChainId(payload) {
        const transferPayload = (0, wormhole_sdk_1.parseTransferPayload)(payload);
        return transferPayload.targetChain;
    }
    async relay(signedVAA, checkOnly, walletPrivateKey, relayLogger, metrics) {
        const logger = (0, logHelper_1.getScopedLogger)(["relay"], relayLogger);
        const { parse_vaa } = await (0, wormhole_sdk_1.importCoreWasm)();
        const parsedVAA = parse_vaa((0, wormhole_sdk_1.hexToUint8Array)(signedVAA));
        if (parsedVAA.payload[0] === 1) {
            const transferPayload = (0, wormhole_sdk_1.parseTransferPayload)(Buffer.from(parsedVAA.payload));
            const chainConfigInfo = getChainConfigInfo(transferPayload.targetChain);
            if (!chainConfigInfo) {
                logger.error("relay: improper chain ID: " + transferPayload.targetChain);
                return {
                    status: redisHelper_1.Status.FatalError,
                    result: "Fatal Error: target chain " + transferPayload.targetChain + " not supported",
                };
            }
            if ((0, wormhole_sdk_1.isEVMChain)(transferPayload.targetChain)) {
                let nativeOrigin;
                try {
                    nativeOrigin = (0, wormhole_sdk_1.tryHexToNativeString)(transferPayload.originAddress, transferPayload.originChain);
                }
                catch (e) {
                    return {
                        status: redisHelper_1.Status.Error,
                        result: `error converting origin address: ${e?.message}`,
                    };
                }
                const unwrapNative = transferPayload.originChain === transferPayload.targetChain &&
                    nativeOrigin?.toLowerCase() === chainConfigInfo.wrappedAsset?.toLowerCase();
                logger.debug("isEVMChain: originAddress: [" +
                    transferPayload.originAddress +
                    "], wrappedAsset: [" +
                    chainConfigInfo.wrappedAsset +
                    "], unwrapNative: " +
                    unwrapNative);
                let evmResult = await (0, evm_1.relayEVM)(chainConfigInfo, signedVAA, unwrapNative, checkOnly, walletPrivateKey, logger, metrics);
                return {
                    status: evmResult.redeemed ? redisHelper_1.Status.Completed : redisHelper_1.Status.Error,
                    result: evmResult.result.toString(),
                };
            }
            if (transferPayload.targetChain === wormhole_sdk_1.CHAIN_ID_SOLANA) {
                let rResult = { status: redisHelper_1.Status.Error, result: "" };
                const retVal = await (0, solana_1.relaySolana)(chainConfigInfo, signedVAA, checkOnly, walletPrivateKey, logger, metrics);
                if (retVal.redeemed) {
                    rResult.status = redisHelper_1.Status.Completed;
                }
                rResult.result = retVal.result;
                return rResult;
            }
            if ((0, wormhole_sdk_1.isTerraChain)(transferPayload.targetChain)) {
                let rResult = { status: redisHelper_1.Status.Error, result: "" };
                const retVal = await (0, terra_1.relayTerra)(chainConfigInfo, signedVAA, checkOnly, walletPrivateKey, logger, metrics);
                if (retVal.redeemed) {
                    rResult.status = redisHelper_1.Status.Completed;
                }
                rResult.result = retVal.result;
                return rResult;
            }
            logger.error("relay: target chain ID: " + transferPayload.targetChain + " is invalid, this is a program bug!");
            return {
                status: redisHelper_1.Status.FatalError,
                result: "Fatal Error: target chain " + transferPayload.targetChain + " is invalid, this is a program bug!",
            };
        }
        return { status: redisHelper_1.Status.FatalError, result: "ERROR: Invalid payload type" };
    }
}
exports.TokenBridgeRelayer = TokenBridgeRelayer;
//# sourceMappingURL=relayer.js.map