"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenBridgeListener = void 0;
/** The default backend is relaying payload 1 token bridge messages only */
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const configureEnv_1 = require("../../configureEnv");
const logHelper_1 = require("../../helpers/logHelper");
const redisHelper_1 = require("../../helpers/redisHelper");
const validation_1 = require("../../listener/validation");
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
class TokenBridgeListener {
    logger;
    /**
     * @throws - when the listener environment setup fails
     */
    constructor() {
        this.logger = (0, logHelper_1.getScopedLogger)(["TokenBridgeListener"]);
    }
    /** Verify this payload is version 1. */
    verifyIsPayloadV1(parsedVaa) {
        if (parsedVaa.payload[0] !== 1) {
            this.logger.debug("Specified vaa is not payload version 1.");
            return false;
        }
        return true;
    }
    /** Verify this payload has a fee specified for relaying. */
    verifyFeeSpecified(payload) {
        /**
         * TODO: simulate gas fees / get notional from coingecko and ensure the fees cover the relay.
         *       We might just keep this check here but verify the notional is enough to pay the gas
         *       fees in the actual relayer. That way we can retry up to the max number of retries
         *       and if the gas fluctuates we might be able to make it still.
         */
        /** Is the specified fee sufficient to relay? */
        const sufficientFee = payload.fee && payload.fee > BigInt(0);
        if (!sufficientFee) {
            this.logger.debug("Token transfer does not have a sufficient fee.");
            return false;
        }
        return true;
    }
    /** Verify the the token in this payload in the approved token list. */
    verifyIsApprovedToken(payload) {
        let originAddressNative;
        let env = (0, configureEnv_1.getListenerEnvironment)();
        try {
            originAddressNative = (0, wormhole_sdk_1.tryHexToNativeString)(payload.originAddress, payload.originChain);
        }
        catch (e) {
            return false;
        }
        // Token is in the SUPPORTED_TOKENS env var config
        const isApprovedToken = env.supportedTokens.find((token) => {
            return (originAddressNative &&
                token.address.toLowerCase() === originAddressNative.toLowerCase() &&
                token.chainId === payload.originChain);
        });
        if (!isApprovedToken) {
            this.logger.debug("Token transfer is not for an approved token.");
            return false;
        }
        return true;
    }
    /** Parses a raw VAA byte array
     *
     * @throws when unable to parse the VAA
     */
    async parseVaa(rawVaa) {
        let parsedVaa = null;
        try {
            parsedVaa = await (0, validation_1.parseVaaTyped)(rawVaa);
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
        // Verify this is actually a token bridge transfer payload
        if (!this.verifyIsPayloadV1(parsedVaa)) {
            return "Wrong payload type";
        }
        try {
            parsedPayload = await this.parsePayload(parsedVaa.payload);
        }
        catch (e) {
            return "Payload parsing failure";
        }
        // Verify we want to relay this request
        if (!this.verifyIsApprovedToken(parsedPayload) || !this.verifyFeeSpecified(parsedPayload)) {
            return "Validation failed";
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
        this.logger.info("forwarding vaa to relayer: emitter: [" +
            parsedVaa.emitterChain +
            ":" +
            (0, wormhole_sdk_1.uint8ArrayToHex)(parsedVaa.emitterAddress) +
            "], seqNum: " +
            parsedVaa.sequence +
            ", payload: origin: [" +
            parsedVaa.payload.originAddress +
            ":" +
            parsedVaa.payload.originAddress +
            "], target: [" +
            parsedVaa.payload.targetChain +
            ":" +
            parsedVaa.payload.targetAddress +
            "],  amount: " +
            parsedVaa.payload.amount +
            ", fee: " +
            parsedVaa.payload.fee +
            ", ");
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
exports.TokenBridgeListener = TokenBridgeListener;
//# sourceMappingURL=listener.js.map