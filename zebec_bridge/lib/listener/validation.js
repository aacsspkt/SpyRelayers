"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVaaTyped = void 0;
const wasm_1 = require("@certusone/wormhole-sdk/lib/cjs/solana/wasm");
async function parseVaaTyped(signedVAA) {
    const { parse_vaa } = await (0, wasm_1.importCoreWasm)();
    const parsedVAA = parse_vaa(signedVAA);
    return {
        timestamp: parsedVAA.timestamp,
        nonce: parsedVAA.nonce,
        emitterChain: parsedVAA.emitter_chain,
        emitterAddress: Uint8Array.from(parsedVAA.emitter_address),
        sequence: parsedVAA.sequence,
        consistencyLevel: parsedVAA.consistency_level,
        payload: Uint8Array.from(parsedVAA.payload),
    };
}
exports.parseVaaTyped = parseVaaTyped;
//# sourceMappingURL=validation.js.map