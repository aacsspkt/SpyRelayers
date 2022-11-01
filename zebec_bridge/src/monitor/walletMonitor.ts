import { formatUnits } from 'ethers/lib/utils';

import {
  WSOL_ADDRESS,
  WSOL_DECIMALS,
} from '@certusone/wormhole-sdk';
import {
  Connection,
  Keypair,
} from '@solana/web3.js';

import {
  getRelayerEnvironment,
  RelayerEnvironment,
} from '../configureEnv';
import { getScopedLogger } from '../helpers/logHelper';
import { PromHelper } from '../helpers/promHelpers';
import { sleep } from '../helpers/utils';
import { getAccountRPC } from '../utils/solana';

let env: RelayerEnvironment;
const logger = getScopedLogger(["walletMonitor"]);

export type WalletBalance = {
	balanceAbs: string;
	balanceFormatted?: string;
	currencyName: string;
	currencyAddressNative: string;
	walletAddress: string;
};

async function pullBalances(metrics: PromHelper): Promise<WalletBalance[]> {
	env = getRelayerEnvironment();
	//TODO loop through all the chain configs, calc the public keys, pull their balances, and push to a combo of the loggers and prmometheus
	if (!env) {
		logger.error("pullBalances() - no env");
		return [];
	}
	const balancePromises: Promise<WalletBalance>[] = [];

	for (const privateKey of env.privateKeys || []) {
		try {
			balancePromises.push(pullSolanaNativeBalance(env.nodeUrl, privateKey));
			// balancePromises.push(pullSolanaTokenBalances(chainInfo, solanaPrivateKey));
		} catch (e: any) {
			logger.error("pulling balances failed failed");
			if (e && e.stack) {
				logger.error(e.stack);
			}
		}
	}

	const balances = await Promise.all(balancePromises);

	return balances;
}

async function pullSolanaNativeBalance(endpoint: string, privateKey: Uint8Array): Promise<WalletBalance> {
	const keyPair = Keypair.fromSecretKey(privateKey);
	const connection = new Connection(endpoint);
	const fetchAccount = await getAccountRPC(connection, keyPair.publicKey);

	let walletBalance: WalletBalance = {
		balanceAbs: "0",
		balanceFormatted: "0",
		currencyName: "SOL",
		currencyAddressNative: WSOL_ADDRESS,
		walletAddress: keyPair.publicKey.toString(),
	};

	if (!fetchAccount) {
		//Accounts with zero balance report as not existing.
		return walletBalance;
	}

	walletBalance.balanceAbs = fetchAccount.lamports.toString();
	walletBalance.balanceFormatted = formatUnits(fetchAccount.lamports, WSOL_DECIMALS).toString();

	return walletBalance;
}

export async function collectWallets(metrics: PromHelper) {
	const scopedLogger = getScopedLogger(["collectWallets"], logger);
	const ONE_MINUTE: number = 60000;
	scopedLogger.info("Starting up.");
	while (true) {
		scopedLogger.debug("Pulling balances.");
		let wallets: WalletBalance[] = [];
		try {
			wallets = await pullBalances(metrics);
		} catch (e) {
			scopedLogger.error("Failed to pullBalances: " + e);
		}
		scopedLogger.debug("Done pulling balances.");
		metrics.handleWalletBalances(wallets);
		await sleep(ONE_MINUTE);
	}
}
