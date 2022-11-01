"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZebecBridgeRelayer = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const anchor_1 = require("@project-serum/anchor");
const web3_js_1 = require("@solana/web3.js");
const zebec_wormhole_sdk_1 = require("@zebec-io/zebec-wormhole-sdk");
const configureEnv_1 = require("../../configureEnv");
const logHelper_1 = require("../../helpers/logHelper");
const redisHelper_1 = require("../../helpers/redisHelper");
const relayArchive_1 = require("../../helpers/relayArchive");
const utils_1 = require("../../helpers/utils");
const definitions_1 = require("../definitions");
/** Relayer for payload 1 token bridge messages only */
class ZebecBridgeRelayer {
    /** Process the relay request */
    async process(key, privateKey, relayLogger, metrics) {
        const logger = (0, logHelper_1.getScopedLogger)(["ZebecBridgeRelayer.process"], relayLogger);
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
                    logger.error("Failed to relay zebec vaa: %s", e.message);
                }
                else {
                    logger.error("Failed to relay zebec vaa: %o", e);
                }
                relayResult = {
                    status: redisHelper_1.Status.Error,
                    result: e && e?.message !== undefined ? e.message : "Failure",
                };
            }
            const MAX_RETRIES = 10;
            let retry = false;
            if (relayResult.status !== redisHelper_1.Status.Completed) {
                metrics.incFailures();
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
        const auditLogger = (0, logHelper_1.getScopedLogger)([`audit-worker-${workerInfo.index}`]);
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
                            //TODO actually do check if transaction is complete
                            const rr = await this.relay(storePayload.vaa_bytes, true, workerInfo.walletPrivateKey, auditLogger, metrics);
                            await redisClient.del(si_key);
                            if (rr.status === redisHelper_1.Status.Completed) {
                                metrics.incConfirmed();
                            }
                            else {
                                auditLogger.info("Detected a rollback on " + si_key);
                                metrics.incRollback();
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
        const zebecPayload = (0, zebec_wormhole_sdk_1.parseZebecPayload)(payload);
        return zebecPayload.targetChain;
    }
    async relay(signedVAA, checkOnly, walletPrivateKey, relayLogger, metrics) {
        const logger = (0, logHelper_1.getScopedLogger)(["relay"], relayLogger);
        const { parse_vaa } = await (0, wormhole_sdk_1.importCoreWasm)();
        const signedVaaArray = (0, wormhole_sdk_1.hexToUint8Array)(signedVAA);
        const parsedVaa = parse_vaa(signedVaaArray);
        const payload = (0, zebec_wormhole_sdk_1.parseZebecPayload)(Buffer.from(parsedVaa.payload));
        const env = (0, configureEnv_1.getRelayerEnvironment)();
        const connection = new web3_js_1.Connection(env.nodeUrl);
        const bridgeAddress = env.bridgeAddress;
        const keypair = web3_js_1.Keypair.fromSecretKey(walletPrivateKey);
        const payerAddress = keypair.publicKey.toString();
        logger.debug("payer: %s", payerAddress);
        let relayResult = { status: redisHelper_1.Status.Error, result: null };
        // checking process vaa key.
        const processVaaKey = await zebec_wormhole_sdk_1.ZebecSolBridgeClient.getProcessVaaKey(parsedVaa.emitter_chain, parsedVaa.emitter_address, parsedVaa.sequence);
        const processVaaInfo = await connection.getAccountInfo(processVaaKey);
        // if process vaa info in not null then it means its been already processed.
        if (processVaaInfo) {
            return { status: redisHelper_1.Status.Completed, result: "Already relayed" };
        }
        // if need to check only
        if (checkOnly) {
            return { status: redisHelper_1.Status.Pending, result: "Not relayed" };
        }
        const signTransaction = async (tx) => {
            tx.partialSign(keypair);
            return tx;
        };
        const signAllTransactions = async (txs) => {
            const promises = txs.map(async (tx) => await signTransaction(tx));
            return Promise.all(promises);
        };
        try {
            logger.info("Posting vaa");
            await (0, wormhole_sdk_1.postVaaSolanaWithRetry)(connection, signTransaction, bridgeAddress, payerAddress, Buffer.from(signedVaaArray), zebec_wormhole_sdk_1.MAX_VAA_UPLOAD_RETRIES_SOLANA);
            logger.info("Vaa posted");
        }
        catch (e) {
            logger.error("Vaa post error: %o", e);
            relayResult.result = "Error in posting vaa";
            return relayResult;
        }
        const wallet = {
            publicKey: keypair.publicKey,
            signTransaction,
            signAllTransactions,
        };
        const confirmOpts = {
            commitment: "processed",
            preflightCommitment: "confirmed",
            skipPreflight: false,
        };
        const provider = new anchor_1.AnchorProvider(connection, wallet, confirmOpts);
        const client = new zebec_wormhole_sdk_1.ZebecSolBridgeClient(provider);
        await client.initialize();
        await client.registerEmitterAddress((0, wormhole_sdk_1.tryUint8ArrayToNative)(parsedVaa.emitter_address, parsedVaa.emitter_chain), parsedVaa.emitter_chain);
        if ((0, zebec_wormhole_sdk_1.IsCancelTokenStreamPayload)(payload)) {
            try {
                const result = await client.cancelStream(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsTokenDepositPayload)(payload)) {
            try {
                const result = await client.depositToken(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsInstantTokenPayload)(payload)) {
            try {
                const result = await client.instantTokenTransfer(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsPauseTokenStreamPayload)(payload)) {
            try {
                const result = await client.pauseResumeStream(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsTokenStreamPayload)(payload)) {
            try {
                const result = await client.initializeStream(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsTokenStreamUpdatePayload)(payload)) {
            try {
                const result = await client.updateStreamToken(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsTokenWithdrawStreamPayload)(payload)) {
            try {
                const result = await client.withdrawStreamToken(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsTokenWithdrawPayload)(payload)) {
            try {
                const result = await client.withdrawDeposit(signedVaaArray, payload);
                if (result.status === "success") {
                    metrics.incSuccesses();
                    if (!result.data) {
                        throw new Error("Data is undefined");
                    }
                    (0, relayArchive_1.storeRelayInfo)({
                        chainId: parsedVaa.emitter_chain,
                        emitterAddress: Uint8Array.from(parsedVaa.emitter_address),
                        sequence: parsedVaa.sequence,
                        payload: Uint8Array.from(parsedVaa.payload),
                        status: "completed",
                        signatures: result.data.signatures,
                        streamEscrow: result.data.dataAccount,
                    });
                    return { status: redisHelper_1.Status.Completed, result: result.message };
                }
                else {
                    return { status: redisHelper_1.Status.Error, result: result.message };
                }
            }
            catch (e) {
                logger.error("Error occurred in bridge client: %o", e);
                throw e;
            }
        }
        if ((0, zebec_wormhole_sdk_1.IsCancelSolStreamPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsInstantSolPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsSolDepositPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsSolStreamPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsSolStreamUpdatePayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsSolWithdrawStreamPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsSolWithdrawPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        if ((0, zebec_wormhole_sdk_1.IsPauseSolStreamPayload)(payload)) {
            throw new zebec_wormhole_sdk_1.NotImplementedError();
        }
        logger.error("Payload is invalid. It's a program bug. Payload: %o", payload);
        return { status: redisHelper_1.Status.FatalError, result: "ERROR: Invalid payload type" };
    }
}
exports.ZebecBridgeRelayer = ZebecBridgeRelayer;
//# sourceMappingURL=relayer.js.map