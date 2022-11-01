"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZebecBridgeLister = void 0;
/** The default backend is relaying payload 1 token bridge messages only */
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const zebec_wormhole_sdk_1 = require("@zebec-io/zebec-wormhole-sdk");
const configureEnv_1 = require("../../configureEnv");
const logHelper_1 = require("../../helpers/logHelper");
const redisHelper_1 = require("../../helpers/redisHelper");
async function encodeEmitterAddress(myChainId, emitterAddressStr) {
    if (myChainId === wormhole_sdk_1.CHAIN_ID_SOLANA) {
        return await (0, wormhole_sdk_1.getEmitterAddressSolana)(emitterAddressStr);
    }
    if ((0, wormhole_sdk_1.isTerraChain)(myChainId)) {
        return await (0, wormhole_sdk_1.getEmitterAddressTerra)(emitterAddressStr);
    }
    return (0, wormhole_sdk_1.getEmitterAddressEth)(emitterAddressStr);
}
/** Listener for payload 1 token bridge messages only */
class ZebecBridgeLister {
    logger;
    /**
     * @throws - when the listener environment setup fails
     */
    constructor() {
        this.logger = (0, logHelper_1.getScopedLogger)(["ZebecBridgeLister"]);
    }
    /** Parses a raw VAA byte array
     *
     * @throws when unable to parse the VAA
     */
    async parseVaa(rawVaa) {
        let parsedVaa = null;
        try {
            parsedVaa = await (0, zebec_wormhole_sdk_1.parseVaaTyped)(rawVaa);
        }
        catch (e) {
            this.logger.error("Encountered error while parsing raw VAA " + e);
        }
        if (!parsedVaa) {
            throw new Error("Unable to parse the specified VAA.");
        }
        return parsedVaa;
    }
    /** Parse the VAA and return the payload nicely typed */
    async parsePayload(rawPayload) {
        let parsedPayload;
        try {
            parsedPayload = (0, wormhole_sdk_1.parseTransferPayload)(Buffer.from(rawPayload));
        }
        catch (e) {
            this.logger.error("Encountered error while parsing vaa payload" + e);
        }
        if (!parsedPayload) {
            this.logger.debug("Failed to parse the transfer payload.");
            throw new Error("Could not parse the transfer payload.");
        }
        return parsedPayload;
    }
    /** Verify this is a VAA we want to relay. */
    async validate(rawVaa) {
        let parsedVaa = await this.parseVaa(rawVaa);
        let parsedPayload;
        try {
            parsedPayload = await this.parsePayload(parsedVaa.payload);
        }
        catch (e) {
            return "Payload parsing failure";
        }
        // Great success!
        return { ...parsedVaa, payload: parsedPayload };
    }
    /** Get spy filters for all emitters we care about */
    async getEmitterFilters() {
        let env = (0, configureEnv_1.getListenerEnvironment)();
        let filters = [];
        for (let i = 0; i < env.spyServiceFilters.length; i++) {
            const filter = env.spyServiceFilters[i];
            this.logger.info("Getting spyServiceFilter[" +
                i +
                "]: chainId = " +
                filter.chainId +
                ", emmitterAddress = [" +
                filter.emitterAddress +
                "]");
            const typedFilter = {
                emitterFilter: {
                    chainId: filter.chainId,
                    emitterAddress: await encodeEmitterAddress(filter.chainId, filter.emitterAddress),
                },
            };
            this.logger.info("adding filter: chainId: [" +
                typedFilter.emitterFilter.chainId +
                "], emitterAddress: [" +
                typedFilter.emitterFilter.emitterAddress +
                "]");
            filters.push(typedFilter);
        }
        return filters;
    }
    /** Process and validate incoming VAAs from the spy. */
    async process(rawVaa) {
        // TODO: Use a type guard function to verify the ParsedVaa type too?
        const validationResults = await this.validate(rawVaa);
        if (typeof validationResults === "string") {
            this.logger.debug(`Skipping spied request: ${validationResults}`);
            return;
        }
        const parsedVaa = validationResults;
        const redisKey = (0, redisHelper_1.storeKeyFromParsedVAA)(parsedVaa);
        const isQueued = await (0, redisHelper_1.checkQueue)((0, redisHelper_1.storeKeyToJson)(redisKey));
        if (isQueued) {
            this.logger.error(`Not storing in redis: ${isQueued}`);
            return;
        }
        const logMessage = makeLogMessage(parsedVaa);
        this.logger.info(logMessage);
        const redisPayload = (0, redisHelper_1.initPayloadWithVAA)((0, wormhole_sdk_1.uint8ArrayToHex)(rawVaa));
        await this.store(redisKey, redisPayload);
    }
    async store(key, payload) {
        let serializedKey = (0, redisHelper_1.storeKeyToJson)(key);
        let serializedPayload = (0, redisHelper_1.storePayloadToJson)(payload);
        this.logger.debug(`storing: key: [${key.chain_id}/${key.emitter_address}/${key.sequence}], payload: [${serializedPayload}]`);
        return await (0, redisHelper_1.storeInRedis)(serializedKey, serializedPayload);
    }
}
exports.ZebecBridgeLister = ZebecBridgeLister;
function makeLogMessage(parsedVaa) {
    let message = "forwarding vaa to relayer: emitter: [" +
        parsedVaa.emitterChain +
        ":" +
        (0, wormhole_sdk_1.uint8ArrayToHex)(parsedVaa.emitterAddress) +
        "], seqNum: " +
        parsedVaa.sequence +
        ", targetChain: " +
        parsedVaa.payload.targetChain;
    switch (parsedVaa.payload.id) {
        case zebec_wormhole_sdk_1.ZebecPayloadId.CancelSolStream:
            let cssPayload = parsedVaa.payload;
            message.concat(", sender: " + (0, wormhole_sdk_1.uint8ArrayToHex)(cssPayload.sender));
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.CancelTokenStream:
            let ctsPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ctsPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ctsPayload.recipient) +
                ", tokenMint: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ctsPayload.tokenMint) +
                ", dataAccount: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ctsPayload.dataAccount));
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.DepositSol:
            let dsPayload = parsedVaa.payload;
            message.concat(", sender: " + (0, wormhole_sdk_1.uint8ArrayToHex)(dsPayload.sender) + ", amount: " + dsPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.DepositToken:
            let dkPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(dkPayload.sender) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(dkPayload.tokenMint) +
                ", amount: " +
                dkPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.InstantSol:
            let isPayload = parsedVaa.payload;
            message.concat(", sender: " + isPayload.sender + ", recipient: " + isPayload.recipient + ", amount: " + isPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.InstantToken:
            let ikPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ikPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ikPayload.recipient) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ikPayload.tokenMint) +
                ", amount: " +
                ikPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.PauseSolStream:
            let pssPayload = parsedVaa.payload;
            message.concat(", sender: " + (0, wormhole_sdk_1.uint8ArrayToHex)(pssPayload.sender));
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.PauseTokenStream:
            let ptsPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ptsPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ptsPayload.recipient) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ptsPayload.tokenMint) +
                ", dataAccout: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ptsPayload.dataAccount));
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.SolStream:
            let ssPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ssPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ssPayload.recipient) +
                ", startTime: " +
                ssPayload.startTime +
                ", endTime: " +
                ssPayload.endTime +
                ", canCancel: " +
                ssPayload.canCancel +
                ", canUpdate: " +
                ssPayload.canUpdate +
                ", amount: " +
                ssPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.SolStreamUpdate:
            let ssuPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ssuPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(ssuPayload.recipient) +
                ", startTime: " +
                ssuPayload.startTime +
                ", endTime: " +
                ssuPayload.endTime +
                ", amount: " +
                ssuPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.SolWithdrawStream:
            let swsPayload = parsedVaa.payload;
            message.concat(", withdrawer: " + (0, wormhole_sdk_1.uint8ArrayToHex)(swsPayload.withdrawer));
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.TokenStream:
            let tsPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsPayload.recipient) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsPayload.tokenMint) +
                ", startTime: " +
                tsPayload.startTime +
                ", endTime: " +
                tsPayload.endTime +
                ", canCancel: " +
                tsPayload.canCancel +
                ", canUpdate: " +
                tsPayload.canUpdate +
                ", amount: " +
                tsPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.TokenStreamUpdate:
            let tsuPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsuPayload.sender) +
                ", recipient: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsuPayload.recipient) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsuPayload.tokenMint) +
                ", dataAccount: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(tsuPayload.tokenMint) +
                ", startTime: " +
                tsuPayload.startTime +
                ", endTime: " +
                tsuPayload.endTime +
                ", amount: " +
                tsuPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.TokenWithdrawStream:
            let twsPayload = parsedVaa.payload;
            message.concat(", sender: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(twsPayload.sender) +
                ", withdrawer: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(twsPayload.withdrawer) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(twsPayload.tokenMint) +
                ", dataAccount: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(twsPayload.dataAccount));
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.WithdrawSol:
            let wsPayload = parsedVaa.payload;
            message.concat(", withdrawer: " + wsPayload.withdrawer + ", amount: " + wsPayload.amount);
            break;
        case zebec_wormhole_sdk_1.ZebecPayloadId.WithdrawToken:
            let wkPayload = parsedVaa.payload;
            message.concat(", withdrawer: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(wkPayload.withdrawer) +
                ", token: " +
                (0, wormhole_sdk_1.uint8ArrayToHex)(wkPayload.tokenMint) +
                ", amount: " +
                wkPayload.amount);
            break;
    }
    return message;
}
//# sourceMappingURL=listener.js.map