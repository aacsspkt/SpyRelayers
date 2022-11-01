"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVaaTyped = void 0;
const wasm_1 = require("@certusone/wormhole-sdk/lib/cjs/solana/wasm");
//TODO move these to the official SDK
async function parseVaaTyped(signedVAA) {
    const { parse_vaa } = await (0, wasm_1.importCoreWasm)();
    const parsedVAA = parse_vaa(signedVAA);
    return {
        timestamp: parseInt(parsedVAA.timestamp),
        nonce: parseInt(parsedVAA.nonce),
        emitterChain: parseInt(parsedVAA.emitter_chain),
        emitterAddress: parsedVAA.emitter_address,
        sequence: parseInt(parsedVAA.sequence),
        consistencyLevel: parseInt(parsedVAA.consistency_level),
        payload: parsedVAA.payload,
    };
}
exports.parseVaaTyped = parseVaaTyped;
/** Type guard function to ensure an object is of type ParsedTransferPayload */
function IsParsedTransferPayload(payload) {
    return (typeof payload.amount == "bigint" &&
        typeof payload.originAddress == "string" &&
        typeof payload.originChain == "number" &&
        typeof payload.targetAddress == "string" &&
        typeof payload.targetChain == "number");
}
//# sourceMappingURL=validation.js.map