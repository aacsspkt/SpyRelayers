"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRelayerEnvironment = exports.getListenerEnvironment = exports.getCommonEnvironment = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const logHelper_1 = require("./helpers/logHelper");
let loggingEnv = undefined;
const getCommonEnvironment = () => {
    if (loggingEnv) {
        return loggingEnv;
    }
    else {
        const env = createCommonEnvironment();
        loggingEnv = env;
        return loggingEnv;
    }
};
exports.getCommonEnvironment = getCommonEnvironment;
function createCommonEnvironment() {
    let logLevel;
    let promPort;
    let readinessPort;
    let logDir;
    let redisHost;
    let redisPort;
    if (!process.env.LOG_LEVEL) {
        throw new Error("Missing required environment variable: LOG_LEVEL");
    }
    else {
        logLevel = process.env.LOG_LEVEL;
    }
    if (!process.env.LOG_DIR) {
        //Not mandatory
    }
    else {
        logDir = process.env.LOG_DIR;
    }
    if (!process.env.PROM_PORT) {
        throw new Error("Missing required environment variable: PROM_PORT");
    }
    else {
        promPort = parseInt(process.env.PROM_PORT);
    }
    if (!process.env.READINESS_PORT) {
        //do nothing
    }
    else {
        readinessPort = parseInt(process.env.READINESS_PORT);
    }
    if (!process.env.REDIS_HOST) {
        throw new Error("Missing required environment variable: REDIS_HOST");
    }
    else {
        redisHost = process.env.REDIS_HOST;
    }
    if (!process.env.REDIS_PORT) {
        throw new Error("Missing required environment variable: REDIS_PORT");
    }
    else {
        redisPort = parseInt(process.env.REDIS_PORT);
    }
    return { logLevel, promPort, readinessPort, logDir, redisHost, redisPort };
}
let listenerEnv = undefined;
const getListenerEnvironment = () => {
    if (listenerEnv) {
        return listenerEnv;
    }
    else {
        const env = createListenerEnvironment();
        listenerEnv = env;
        return listenerEnv;
    }
};
exports.getListenerEnvironment = getListenerEnvironment;
const createListenerEnvironment = () => {
    let spyServiceHost;
    let spyServiceFilters = [];
    let restPort;
    let numSpyWorkers;
    const logger = (0, logHelper_1.getLogger)();
    if (!process.env.SPY_SERVICE_HOST) {
        throw new Error("Missing required environment variable: SPY_SERVICE_HOST");
    }
    else {
        spyServiceHost = process.env.SPY_SERVICE_HOST;
    }
    logger.info("Getting SPY_SERVICE_FILTERS...");
    if (!process.env.SPY_SERVICE_FILTERS) {
        throw new Error("Missing required environment variable: SPY_SERVICE_FILTERS");
    }
    else {
        const array = JSON.parse(process.env.SPY_SERVICE_FILTERS);
        // if (!array.foreach) {
        if (!array || !Array.isArray(array)) {
            throw new Error("Spy service filters is not an array.");
        }
        else {
            array.forEach((filter) => {
                if (filter.chainId && filter.emitterAddress) {
                    logger.info("nativeToHexString: " + (0, wormhole_sdk_1.tryNativeToHexString)(filter.emitterAddress, filter.chainId));
                    spyServiceFilters.push({
                        chainId: filter.chainId,
                        emitterAddress: filter.emitterAddress,
                    });
                }
                else {
                    throw new Error("Invalid filter record. " + filter.toString());
                }
            });
        }
    }
    logger.info("Getting REST_PORT...");
    if (!process.env.REST_PORT) {
        throw new Error("Missing required environment variable: REST_PORT");
    }
    else {
        restPort = parseInt(process.env.REST_PORT);
    }
    logger.info("Getting SPY_NUM_WORKERS...");
    if (!process.env.SPY_NUM_WORKERS) {
        throw new Error("Missing required environment variable: SPY_NUM_WORKERS");
    }
    else {
        numSpyWorkers = parseInt(process.env.SPY_NUM_WORKERS);
    }
    logger.info("Setting the listener backend...");
    return {
        spyServiceHost,
        spyServiceFilters,
        restPort,
        numSpyWorkers,
    };
};
let relayerEnv = undefined;
const getRelayerEnvironment = () => {
    if (relayerEnv) {
        return relayerEnv;
    }
    else {
        const env = createRelayerEnvironment();
        relayerEnv = env;
        return relayerEnv;
    }
};
exports.getRelayerEnvironment = getRelayerEnvironment;
const createRelayerEnvironment = () => {
    const logger = (0, logHelper_1.getLogger)();
    if (!process.env.REDIS_HOST) {
        throw new Error("Missing required environment variable: REDIS_HOST");
    }
    if (!process.env.REDIS_PORT) {
        throw new Error("Missing required environment variable: REDIS_PORT");
    }
    if (process.env.CLEAR_REDIS_ON_INIT === undefined) {
        throw new Error("Missing required environment variable: CLEAR_REDIS_ON_INIT");
    }
    if (process.env.DEMOTE_WORKING_ON_INIT === undefined) {
        throw new Error("Missing required environment variable: DEMOTE_WORKING_ON_INIT");
    }
    if (!process.env.SOLANA_API_URL) {
        throw new Error("Missing required environment variable: SOLANA_API_URL");
    }
    if (!process.env.SOL_BRIDGE_ADDRESS) {
        throw new Error("Missing required environment variable: SOL_BRIDGE_ADDRESS");
    }
    if (!process.env.SOL_ZEBEC_BRIDGE_ADDRESS) {
        throw new Error("Missing required environment variable: SOL_ZEBEC_BRIDGE_ADDRESS");
    }
    if (!process.env.PRIVATE_KEYS) {
        throw new Error("Missing required environment variable: PRIVATE_KEYS");
    }
    if (process.env.RELAY_ARCHIVE_API_URL === undefined) {
        throw new Error("Missing required environment variable: RELAY_ARCHIVE_API_URL");
    }
    const redisHost = process.env.REDIS_HOST;
    const redisPort = parseInt(process.env.REDIS_PORT);
    let clearRedisOnInit;
    if (process.env.CLEAR_REDIS_ON_INIT.toLowerCase() === "true") {
        clearRedisOnInit = true;
    }
    else {
        clearRedisOnInit = false;
    }
    let demoteWorkingOnInit;
    if (process.env.DEMOTE_WORKING_ON_INIT.toLowerCase() === "true") {
        demoteWorkingOnInit = true;
    }
    else {
        demoteWorkingOnInit = false;
    }
    const nodeUrl = process.env.SOLANA_API_URL;
    const bridgeAddress = process.env.SOL_BRIDGE_ADDRESS;
    const zebecBridgeAddress = process.env.SOL_ZEBEC_BRIDGE_ADDRESS;
    let privateKeys = [];
    const unformattedPrivateKey = JSON.parse(process.env.PRIVATE_KEYS);
    if (!(unformattedPrivateKey.length && unformattedPrivateKey.forEach)) {
        throw new Error("Ill formatted object received as private key for Solana.");
    }
    unformattedPrivateKey.forEach((unformattedKey) => {
        try {
            const key = Uint8Array.from(unformattedKey);
            if (key.length !== 64) {
                throw new Error("Coerced solana key is invalid.");
            }
            privateKeys.push(key);
        }
        catch (e) {
            throw new Error("Failed to coerce Solana private keys into a uint array. ENV JSON is possibly incorrect.");
        }
    });
    const relayArchiveApiUrl = process.env.RELAY_ARCHIVE_API_URL;
    logger.info("Setting the relayer backend...");
    return {
        nodeUrl,
        bridgeAddress,
        zebecBridgeAddress,
        privateKeys,
        redisHost,
        redisPort,
        clearRedisOnInit,
        demoteWorkingOnInit,
        relayArchiveApiUrl,
    };
};
//# sourceMappingURL=configureEnv.js.map