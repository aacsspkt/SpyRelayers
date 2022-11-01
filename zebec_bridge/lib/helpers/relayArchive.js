"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitorRelayArchiveApi = exports.storeRelayInfo = exports.getRelayInfo = void 0;
const axios_1 = __importDefault(require("axios"));
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("./logHelper");
const utils_1 = require("./utils");
const logger = (0, logHelper_1.getScopedLogger)(["relayArchiveApi"]);
const relayEnv = (0, configureEnv_1.getRelayerEnvironment)();
const baseUrl = relayEnv.relayArchiveApiUrl;
var ApiStatus;
(function (ApiStatus) {
    ApiStatus[ApiStatus["OFF"] = 0] = "OFF";
    ApiStatus[ApiStatus["ON"] = 1] = "ON";
})(ApiStatus || (ApiStatus = {}));
async function getRelayInfo(data) {
    logger.info("Retrieving relay info.");
    const { chainId, emitterAddress, sequence } = data;
    const chain = (0, wormhole_sdk_1.toChainName)(chainId).toString();
    const emitterAddressHex = (0, wormhole_sdk_1.uint8ArrayToHex)(emitterAddress);
    const uri = baseUrl.concat(`/api/v1/RelayInfos/${chain}/${emitterAddressHex}/${sequence}`);
    const response = await axios_1.default.get(uri);
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
exports.getRelayInfo = getRelayInfo;
async function storeRelayInfo(data) {
    logger.info("Archiving relay info.");
    const uri = baseUrl.concat("/api/v1/RelayInfos");
    const preparedData = {
        chain: (0, wormhole_sdk_1.toChainName)(data.chainId).toString(),
        emitterAddressHex: (0, wormhole_sdk_1.uint8ArrayToHex)(data.emitterAddress),
        sequence: 1,
        payloadHex: (0, wormhole_sdk_1.uint8ArrayToHex)(data.payload),
        streamEscrow: data.streamEscrow,
        status: data.status,
        signatures: data.signatures,
    };
    const response = await axios_1.default.post(uri, preparedData);
    if (response.status === 201) {
        logger.info("Relay info archived: %o", response.data);
        return;
    }
    logger.error("Error in archiving relay info: %0", response.data);
}
exports.storeRelayInfo = storeRelayInfo;
async function checkRelayArchiveApiHealth() {
    logger.info("Checking relay archive api health");
    const response = await axios_1.default.get(baseUrl);
    return response.status === 200 ? ApiStatus.ON : ApiStatus.OFF;
}
async function monitorRelayArchiveApi(ph) {
    const scopedLogger = (0, logHelper_1.getScopedLogger)(["monitorRelayArchiveApi"], logger);
    const ONE_MINUTE = 60000;
    while (true) {
        try {
            const status = await checkRelayArchiveApiHealth();
            if (status === ApiStatus.ON) {
                ph.setRelayArchiveApiStatus(status);
            }
            else {
                scopedLogger.error("Relay archive api is offline.");
                ph.setRelayArchiveApiStatus(status);
            }
        }
        catch (e) {
            scopedLogger.error("Failed to connect relay archive api: %o", e);
        }
        await (0, utils_1.sleep)(ONE_MINUTE);
    }
}
exports.monitorRelayArchiveApi = monitorRelayArchiveApi;
//# sourceMappingURL=relayArchive.js.map