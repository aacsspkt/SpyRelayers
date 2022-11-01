"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectWallets = void 0;
const utils_1 = require("ethers/lib/utils");
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const web3_js_1 = require("@solana/web3.js");
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("../helpers/logHelper");
const utils_2 = require("../helpers/utils");
const solana_1 = require("../utils/solana");
let env;
const logger = (0, logHelper_1.getScopedLogger)(["walletMonitor"]);
async function pullBalances(metrics) {
    env = (0, configureEnv_1.getRelayerEnvironment)();
    //TODO loop through all the chain configs, calc the public keys, pull their balances, and push to a combo of the loggers and prmometheus
    if (!env) {
        logger.error("pullBalances() - no env");
        return [];
    }
    const balancePromises = [];
    for (const privateKey of env.privateKeys || []) {
        try {
            balancePromises.push(pullSolanaNativeBalance(env.nodeUrl, privateKey));
            // balancePromises.push(pullSolanaTokenBalances(chainInfo, solanaPrivateKey));
        }
        catch (e) {
            logger.error("pulling balances failed failed");
            if (e && e.stack) {
                logger.error(e.stack);
            }
        }
    }
    const balances = await Promise.all(balancePromises);
    return balances;
}
async function pullSolanaNativeBalance(endpoint, privateKey) {
    const keyPair = web3_js_1.Keypair.fromSecretKey(privateKey);
    const connection = new web3_js_1.Connection(endpoint);
    const fetchAccount = await (0, solana_1.getAccountRPC)(connection, keyPair.publicKey);
    let walletBalance = {
        balanceAbs: "0",
        balanceFormatted: "0",
        currencyName: "SOL",
        currencyAddressNative: wormhole_sdk_1.WSOL_ADDRESS,
        walletAddress: keyPair.publicKey.toString(),
    };
    if (!fetchAccount) {
        //Accounts with zero balance report as not existing.
        return walletBalance;
    }
    walletBalance.balanceAbs = fetchAccount.lamports.toString();
    walletBalance.balanceFormatted = (0, utils_1.formatUnits)(fetchAccount.lamports, wormhole_sdk_1.WSOL_DECIMALS).toString();
    return walletBalance;
}
async function collectWallets(metrics) {
    const scopedLogger = (0, logHelper_1.getScopedLogger)(["collectWallets"], logger);
    const ONE_MINUTE = 60000;
    scopedLogger.info("Starting up.");
    while (true) {
        scopedLogger.debug("Pulling balances.");
        let wallets = [];
        try {
            wallets = await pullBalances(metrics);
        }
        catch (e) {
            scopedLogger.error("Failed to pullBalances: " + e);
        }
        scopedLogger.debug("Done pulling balances.");
        metrics.handleWalletBalances(wallets);
        await (0, utils_2.sleep)(ONE_MINUTE);
    }
}
exports.collectWallets = collectWallets;
//# sourceMappingURL=walletMonitor.js.map