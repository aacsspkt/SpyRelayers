"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkQueue = exports.monitorRedis = exports.incrementSourceMap = exports.createSourceMap = exports.demoteWorkingRedis = exports.clearRedis = exports.resetPayload = exports.storePayloadFromJson = exports.storePayloadToJson = exports.storeKeyFromJson = exports.storeKeyToJson = exports.storeKeyFromParsedVAA = exports.initPayloadWithVAA = exports.initPayload = exports.Status = exports.addToRedis = exports.storeInRedis = exports.connectToRedis = exports.init = exports.RedisTables = exports.getBackupQueue = void 0;
const async_mutex_1 = require("async-mutex");
const redis_1 = require("redis");
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const configureEnv_1 = require("../configureEnv");
const wormhole_1 = require("../utils/wormhole");
const logHelper_1 = require("./logHelper");
const utils_1 = require("./utils");
const logger = (0, logHelper_1.getScopedLogger)(["redisHelper"]);
const commonEnv = (0, configureEnv_1.getCommonEnvironment)();
const { redisHost, redisPort } = commonEnv;
let promHelper;
//Module internals
const redisMutex = new async_mutex_1.Mutex();
let redisQueue = new Array();
function getBackupQueue() {
    return redisQueue;
}
exports.getBackupQueue = getBackupQueue;
var RedisTables;
(function (RedisTables) {
    RedisTables[RedisTables["INCOMING"] = 0] = "INCOMING";
    RedisTables[RedisTables["WORKING"] = 1] = "WORKING";
})(RedisTables = exports.RedisTables || (exports.RedisTables = {}));
function init(ph) {
    logger.info("will connect to redis at [" + redisHost + ":" + redisPort + "]");
    promHelper = ph;
    return true;
}
exports.init = init;
async function connectToRedis() {
    let rClient;
    try {
        rClient = (0, redis_1.createClient)({
            socket: {
                host: redisHost,
                port: redisPort,
            },
        });
        rClient.on("connect", function (err) {
            if (err) {
                logger.error("connectToRedis: failed to connect to host [" + redisHost + "], port [" + redisPort + "]: %o", err);
            }
        });
        await rClient.connect();
    }
    catch (e) {
        logger.error("connectToRedis: failed to connect to host [" + redisHost + "], port [" + redisPort + "]: %o", e);
    }
    return rClient;
}
exports.connectToRedis = connectToRedis;
async function storeInRedis(name, value) {
    if (!name) {
        logger.error("storeInRedis: missing name");
        return;
    }
    if (!value) {
        logger.error("storeInRedis: missing value");
        return;
    }
    await redisMutex.runExclusive(async () => {
        logger.debug("storeInRedis: connecting to redis.");
        let redisClient;
        try {
            redisQueue.push([name, value]);
            redisClient = await connectToRedis();
            if (!redisClient) {
                logger.error("Failed to connect to redis, enqueued vaa, there are now " + redisQueue.length + " enqueued events");
                return;
            }
            logger.debug("now connected to redis, attempting to push " + redisQueue.length + " queued items");
            for (let item = redisQueue.pop(); item; item = redisQueue.pop()) {
                await addToRedis(redisClient, item[0], item[1]);
            }
        }
        catch (e) {
            logger.error("Failed during redis item push. Currently" + redisQueue.length + " enqueued items");
            logger.error("encountered an exception while pushing items to redis %o", e);
        }
        try {
            if (redisClient) {
                await redisClient.quit();
            }
        }
        catch (e) {
            logger.error("Failed to quit redis client");
        }
    });
    promHelper.handleListenerMemqueue(redisQueue.length);
}
exports.storeInRedis = storeInRedis;
async function addToRedis(redisClient, name, value) {
    try {
        logger.debug("storeInRedis: storing in redis. name: " + name);
        await redisClient.select(RedisTables.INCOMING);
        await redisClient.set(name, value);
        logger.debug("storeInRedis: finished storing in redis.");
    }
    catch (e) {
        logger.error("storeInRedis: failed to store to host [" + redisHost + "], port [" + redisPort + "]: %o", e);
    }
}
exports.addToRedis = addToRedis;
var Status;
(function (Status) {
    Status[Status["Pending"] = 1] = "Pending";
    Status[Status["Completed"] = 2] = "Completed";
    Status[Status["Error"] = 3] = "Error";
    Status[Status["FatalError"] = 4] = "FatalError";
})(Status = exports.Status || (exports.Status = {}));
/** Default redis payload */
function initPayload() {
    return {
        vaa_bytes: "",
        status: Status.Pending,
        timestamp: new Date().toISOString(),
        retries: 0,
    };
}
exports.initPayload = initPayload;
function initPayloadWithVAA(vaa_bytes) {
    const sp = initPayload();
    sp.vaa_bytes = vaa_bytes;
    return sp;
}
exports.initPayloadWithVAA = initPayloadWithVAA;
function storeKeyFromParsedVAA(parsedVAA) {
    return {
        chain_id: parsedVAA.emitterChain,
        emitter_address: (0, wormhole_sdk_1.uint8ArrayToHex)(parsedVAA.emitterAddress),
        sequence: parsedVAA.sequence,
    };
}
exports.storeKeyFromParsedVAA = storeKeyFromParsedVAA;
/** Stringify the key going into redis as json */
function storeKeyToJson(storeKey) {
    return JSON.stringify(storeKey);
}
exports.storeKeyToJson = storeKeyToJson;
function storeKeyFromJson(json) {
    return JSON.parse(json);
}
exports.storeKeyFromJson = storeKeyFromJson;
/** Stringify the value going into redis as json */
function storePayloadToJson(storePayload) {
    return JSON.stringify(storePayload);
}
exports.storePayloadToJson = storePayloadToJson;
function storePayloadFromJson(json) {
    return JSON.parse(json);
}
exports.storePayloadFromJson = storePayloadFromJson;
function resetPayload(storePayload) {
    return initPayloadWithVAA(storePayload.vaa_bytes);
}
exports.resetPayload = resetPayload;
async function clearRedis() {
    const redisClient = await connectToRedis();
    if (!redisClient) {
        logger.error("Failed to connect to redis to clear tables.");
        return;
    }
    await redisClient.FLUSHALL();
    redisClient.quit();
}
exports.clearRedis = clearRedis;
async function demoteWorkingRedis() {
    const redisClient = await connectToRedis();
    if (!redisClient) {
        logger.error("Failed to connect to redis to clear tables.");
        return;
    }
    await redisClient.select(RedisTables.WORKING);
    for await (const si_key of redisClient.scanIterator()) {
        const si_value = await redisClient.get(si_key);
        if (!si_value) {
            continue;
        }
        logger.info("Demoting %s", si_key);
        await redisClient.del(si_key);
        await redisClient.select(RedisTables.INCOMING);
        await redisClient.set(si_key, storePayloadToJson(resetPayload(storePayloadFromJson(si_value))));
        await redisClient.select(RedisTables.WORKING);
    }
    redisClient.quit();
}
exports.demoteWorkingRedis = demoteWorkingRedis;
function createSourceMap(knownChainIds) {
    const sourceMap = {};
    for (const sourceKey of knownChainIds) {
        sourceMap[sourceKey] = 0;
    }
    return sourceMap;
}
exports.createSourceMap = createSourceMap;
async function incrementSourceMap(key, sourceMap) {
    const parsedKey = storeKeyFromJson(key);
    if (sourceMap[parsedKey.chain_id] !== undefined) {
        sourceMap[parsedKey.chain_id]++;
    }
}
exports.incrementSourceMap = incrementSourceMap;
async function monitorRedis(metrics) {
    const scopedLogger = (0, logHelper_1.getScopedLogger)(["monitorRedis"], logger);
    const TEN_SECONDS = 10000;
    const knownChainIds = Object.keys(wormhole_1.chainIDStrings).map((c) => Number(c));
    while (true) {
        const redisClient = await connectToRedis();
        if (!redisClient) {
            scopedLogger.error("Failed to connect to redis!");
        }
        else {
            try {
                await redisClient.select(RedisTables.INCOMING);
                const incomingSourceMap = createSourceMap(knownChainIds);
                for await (const si_key of redisClient.scanIterator()) {
                    incrementSourceMap(si_key, incomingSourceMap);
                }
                for (const sourceKey of knownChainIds) {
                    metrics.setRedisQueue(RedisTables.INCOMING, sourceKey, incomingSourceMap[sourceKey]);
                }
                await redisClient.select(RedisTables.WORKING);
                const workingSourceMap = createSourceMap(knownChainIds);
                for await (const si_key of redisClient.scanIterator()) {
                    incrementSourceMap(si_key, workingSourceMap);
                }
                for (const sourceKey of knownChainIds) {
                    metrics.setRedisQueue(RedisTables.WORKING, sourceKey, workingSourceMap[sourceKey]);
                }
            }
            catch (e) {
                scopedLogger.error("Failed to get dbSize and set metrics!");
            }
            try {
                redisClient.quit();
            }
            catch (e) { }
        }
        await (0, utils_1.sleep)(TEN_SECONDS);
    }
}
exports.monitorRedis = monitorRedis;
/** Check to see if a key is in the listener memory queue or redis incoming db */
async function checkQueue(key) {
    try {
        const backupQueue = getBackupQueue();
        const queuedRecord = backupQueue.find((record) => record[0] === key);
        if (queuedRecord) {
            logger.debug("VAA was already in the listener queue");
            return "VAA was already in the listener queue";
        }
        const rClient = await connectToRedis();
        if (!rClient) {
            logger.error("Failed to connect to redis");
            return null;
        }
        await rClient.select(RedisTables.INCOMING);
        const record1 = await rClient.get(key);
        if (record1) {
            logger.debug("VAA was already in INCOMING table");
            rClient.quit();
            return "VAA was already in INCOMING table";
        }
        await rClient.select(RedisTables.WORKING);
        const record2 = await rClient.get(key);
        if (record2) {
            logger.debug("VAA was already in WORKING table");
            rClient.quit();
            return "VAA was already in WORKING table";
        }
        rClient.quit();
    }
    catch (e) {
        logger.error("Failed to connect to redis");
    }
    return null;
}
exports.checkQueue = checkQueue;
//# sourceMappingURL=redisHelper.js.map