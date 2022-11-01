"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.init = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const wasm_1 = require("@certusone/wormhole-sdk/lib/cjs/solana/wasm");
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("../helpers/logHelper");
const redisHelper_1 = require("../helpers/redisHelper");
const utils_1 = require("../helpers/utils");
const backends_1 = require("../backends");
const WORKER_THREAD_RESTART_MS = 10 * 1000;
const AUDITOR_THREAD_RESTART_MS = 10 * 1000;
const WORKER_INTERVAL_MS = 5 * 1000;
let metrics;
const logger = (0, logHelper_1.getLogger)();
let relayerEnv;
function init() {
    try {
        relayerEnv = (0, configureEnv_1.getRelayerEnvironment)();
    }
    catch (e) {
        logger.error("Encountered error while initiating the relayer environment: " + e);
        return false;
    }
    return true;
}
exports.init = init;
/** Initialize metrics for each chain and the worker infos */
function createWorkerInfos(metrics) {
    let workerArray = new Array();
    let index = 0;
    relayerEnv.supportedChains.forEach((chain) => {
        // initialize per chain metrics
        metrics.incSuccesses(chain.chainId, 0);
        metrics.incConfirmed(chain.chainId, 0);
        metrics.incFailures(chain.chainId, 0);
        metrics.incRollback(chain.chainId, 0);
        chain.walletPrivateKey?.forEach((key) => {
            workerArray.push({
                walletPrivateKey: key,
                index: index,
                targetChainId: chain.chainId,
                targetChainName: chain.chainName,
            });
            index++;
        });
        // TODO: Name the solanaprivatekey property the same as the non-solana one
        chain.solanaPrivateKey?.forEach((key) => {
            workerArray.push({
                walletPrivateKey: key,
                index: index,
                targetChainId: chain.chainId,
                targetChainName: chain.chainName,
            });
            index++;
        });
    });
    logger.info("will use " + workerArray.length + " workers");
    return workerArray;
}
/** Spawn relay worker and auditor threads for all chains */
async function spawnWorkerThreads(workerArray) {
    workerArray.forEach((workerInfo) => {
        spawnWorkerThread(workerInfo);
        spawnAuditorThread(workerInfo);
    });
}
/** Spawn an auditor thread for each (chain, wallet) combo from the backend implementation */
async function spawnAuditorThread(workerInfo) {
    logger.info(`Spinning up auditor thread for target chain [${workerInfo.targetChainName}-${workerInfo.index}]`);
    //At present, due to the try catch inside the while loop, this thread should never crash.
    const auditorPromise = (0, backends_1.getBackend)()
        .relayer.runAuditor(workerInfo, metrics)
        .catch(async (error) => {
        logger.error(`Fatal crash on auditor thread ${workerInfo.targetChainName}-${workerInfo.index}`);
        logger.error("error message: " + error.message);
        logger.error("error trace: " + error.stack);
        await (0, utils_1.sleep)(AUDITOR_THREAD_RESTART_MS);
        spawnAuditorThread(workerInfo);
    });
    return auditorPromise;
}
async function run(ph) {
    metrics = ph;
    if (relayerEnv.clearRedisOnInit) {
        logger.info("Clearing REDIS as per tunable...");
        await (0, redisHelper_1.clearRedis)();
    }
    else if (relayerEnv.demoteWorkingOnInit) {
        logger.info("Demoting Working to Incoming as per tunable...");
        await (0, redisHelper_1.demoteWorkingRedis)();
    }
    else {
        logger.info("NOT clearing REDIS.");
    }
    let workerArray = createWorkerInfos(metrics);
    spawnWorkerThreads(workerArray);
    try {
        (0, redisHelper_1.monitorRedis)(metrics);
    }
    catch (e) {
        logger.error("Failed to kick off monitorRedis: " + e);
    }
}
exports.run = run;
// Redis does not guarantee ordering.  Therefore, it is possible that if workItems are
// pulled out one at a time, then some workItems could stay in the table indefinitely.
// This function gathers all the items available at this moment to work on.
async function findWorkableItems(workerInfo, relayLogger) {
    const logger = (0, logHelper_1.getScopedLogger)(["findWorkableItems"], relayLogger);
    try {
        let workableItems = [];
        const redisClient = await (0, redisHelper_1.connectToRedis)();
        if (!redisClient) {
            logger.error("Failed to connect to redis inside findWorkableItems()!");
            return workableItems;
        }
        await redisClient.select(redisHelper_1.RedisTables.INCOMING);
        for await (const si_key of redisClient.scanIterator()) {
            const si_value = await redisClient.get(si_key);
            if (si_value) {
                let storePayload = (0, redisHelper_1.storePayloadFromJson)(si_value);
                // Check to see if this worker should handle this VAA
                if (workerInfo.targetChainId !== 0) {
                    const { parse_vaa } = await (0, wasm_1.importCoreWasm)();
                    const parsedVAA = parse_vaa((0, wormhole_sdk_1.hexToUint8Array)(storePayload.vaa_bytes));
                    const payloadBuffer = Buffer.from(parsedVAA.payload);
                    const tgtChainId = (0, backends_1.getBackend)().relayer.targetChainId(payloadBuffer);
                    if (tgtChainId !== workerInfo.targetChainId) {
                        // Skipping mismatched chainId
                        continue;
                    }
                }
                // Check to see if this is a retry and if it is time to retry
                if (storePayload.retries > 0) {
                    const BACKOFF_TIME = 1000; // 1 second in milliseconds
                    const MAX_BACKOFF_TIME = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
                    // calculate retry time
                    const now = new Date();
                    const old = new Date(storePayload.timestamp);
                    const timeDelta = now.getTime() - old.getTime(); // delta is in mS
                    const waitTime = Math.min(BACKOFF_TIME * 10 ** storePayload.retries, //First retry is 10 second, then 100, 1,000... Max of 4 hours.
                    MAX_BACKOFF_TIME);
                    if (timeDelta < waitTime) {
                        // Not enough time has passed
                        continue;
                    }
                }
                workableItems.push({ key: si_key, value: si_value });
            }
        }
        redisClient.quit();
        return workableItems;
    }
    catch (e) {
        logger.error("Recoverable exception scanning REDIS for workable items: " + e.message);
        logger.error(e);
        return [];
    }
}
/** Spin up one worker for each (chainId, privateKey) combo. */
async function spawnWorkerThread(workerInfo) {
    logger.info("Spinning up worker[" +
        workerInfo.index +
        "] to handle target chain " +
        workerInfo.targetChainId +
        ` / ${workerInfo.targetChainName}`);
    const workerPromise = doWorkerThread(workerInfo).catch(async (error) => {
        logger.error("Fatal crash on worker thread: index " +
            workerInfo.index +
            " chainId " +
            workerInfo.targetChainId);
        logger.error("error message: " + error.message);
        logger.error("error trace: " + error.stack);
        await (0, utils_1.sleep)(WORKER_THREAD_RESTART_MS);
        spawnWorkerThread(workerInfo);
    });
    return workerPromise;
}
async function doWorkerThread(workerInfo) {
    // relay-worker-solana-1
    const loggerName = `relay-worker-${workerInfo.targetChainName}-${workerInfo.index}`;
    const relayLogger = (0, logHelper_1.getScopedLogger)([loggerName]);
    const backend = (0, backends_1.getBackend)().relayer;
    while (true) {
        // relayLogger.debug("Finding workable items.");
        const workableItems = await findWorkableItems(workerInfo, relayLogger);
        // relayLogger.debug("Found items: %o", workableItems);
        let i = 0;
        for (i = 0; i < workableItems.length; i++) {
            const workItem = workableItems[i];
            if (workItem) {
                //This will attempt to move the workable item to the WORKING table
                relayLogger.debug("Moving item: %o", workItem);
                if (await moveToWorking(workItem, relayLogger)) {
                    relayLogger.info("Moved key to WORKING table: %s", workItem.key);
                    await backend.process(workItem.key, workerInfo.walletPrivateKey, relayLogger, metrics);
                }
                else {
                    relayLogger.error("Cannot move work item from INCOMING to WORKING: %s", workItem.key);
                }
            }
        }
        // relayLogger.debug(
        //   "Taking a break for %i seconds",
        //   WORKER_INTERVAL_MS / 1000
        // );
        await (0, utils_1.sleep)(WORKER_INTERVAL_MS);
    }
}
async function moveToWorking(workItem, relayLogger) {
    const logger = (0, logHelper_1.getScopedLogger)(["moveToWorking"], relayLogger);
    try {
        const redisClient = await (0, redisHelper_1.connectToRedis)();
        if (!redisClient) {
            logger.error("Failed to connect to Redis.");
            return false;
        }
        // Move this entry from incoming store to working store
        await redisClient.select(redisHelper_1.RedisTables.INCOMING);
        if ((await redisClient.del(workItem.key)) === 0) {
            logger.info("The key %s no longer exists in INCOMING", workItem.key);
            await redisClient.quit();
            return false;
        }
        await redisClient.select(redisHelper_1.RedisTables.WORKING);
        // If this VAA is already in the working store, then no need to add it again.
        // This handles the case of duplicate VAAs from multiple guardians
        const checkVal = await redisClient.get(workItem.key);
        if (!checkVal) {
            let payload = (0, redisHelper_1.storePayloadFromJson)(workItem.value);
            payload.status = redisHelper_1.Status.Pending;
            await redisClient.set(workItem.key, (0, redisHelper_1.storePayloadToJson)(payload));
            await redisClient.quit();
            return true;
        }
        else {
            metrics.incAlreadyExec();
            logger.debug("Dropping request %s as already processed", workItem.key);
            await redisClient.quit();
            return false;
        }
    }
    catch (e) {
        logger.error("Recoverable exception moving item to working: " + e.message);
        logger.error("%s => %s", workItem.key, workItem.value);
        logger.error(e);
        return false;
    }
}
//# sourceMappingURL=relay_worker.js.map