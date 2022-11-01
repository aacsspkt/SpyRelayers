import { ChainId } from '@certusone/wormhole-sdk';
import { importCoreWasm } from '@certusone/wormhole-sdk/lib/cjs/solana/wasm';

export async function parseVaaTyped(signedVAA: Uint8Array): Promise<ParsedVaa<Uint8Array>> {
	const { parse_vaa } = await importCoreWasm();
	const parsedVAA = parse_vaa(signedVAA);
	return {
		timestamp: parsedVAA.timestamp,
		nonce: parsedVAA.nonce,
		emitterChain: parsedVAA.emitter_chain as ChainId,
		emitterAddress: Uint8Array.from(parsedVAA.emitter_address), //This will be in wormhole HEX format
		sequence: parsedVAA.sequence,
		consistencyLevel: parsedVAA.consistency_level,
		payload: Uint8Array.from(parsedVAA.payload),
	};
}

export type ParsedVaa<T> = {
	timestamp: number;
	nonce: number;
	emitterChain: ChainId;
	emitterAddress: Uint8Array;
	sequence: number;
	consistencyLevel: number;
	payload: T;
};
