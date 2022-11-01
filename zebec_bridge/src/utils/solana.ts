import {
  AccountInfo,
  Connection,
  PublicKey,
} from '@solana/web3.js';

export async function getAccountRPC(connection: Connection, pubkey: PublicKey): Promise<AccountInfo<Buffer> | null> {
	return connection.getAccountInfo(pubkey, "confirmed");
}

export const WSOL_DECIMALS = 9;
