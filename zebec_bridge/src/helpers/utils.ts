import {
  BinaryReader,
  BinaryWriter,
} from 'borsh';

import { PublicKey } from '@solana/web3.js';

const base58: any = require("bs58");

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export type StringPublicKey = string;

export const extendBorsh = () => {
	(BinaryReader.prototype as any).readPubkey = function () {
		const reader = this as unknown as BinaryReader;
		const array = reader.readFixedArray(32);
		return new PublicKey(array);
	};

	(BinaryWriter.prototype as any).writePubkey = function (value: PublicKey) {
		const writer = this as unknown as BinaryWriter;
		writer.writeFixedArray(value.toBuffer());
	};

	(BinaryReader.prototype as any).readPubkeyAsString = function () {
		const reader = this as unknown as BinaryReader;
		const array = reader.readFixedArray(32);
		return base58.encode(array) as StringPublicKey;
	};

	(BinaryWriter.prototype as any).writePubkeyAsString = function (value: StringPublicKey) {
		const writer = this as unknown as BinaryWriter;
		writer.writeFixedArray(base58.decode(value));
	};
};

extendBorsh();
