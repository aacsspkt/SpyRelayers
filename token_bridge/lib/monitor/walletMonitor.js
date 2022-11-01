"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcLocalAddressesTerra = exports.collectWallets = exports.pullTerraBalance = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("ethers/lib/utils");
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const spl_token_1 = require("@solana/spl-token");
const web3_js_1 = require("@solana/web3.js");
const terra_js_1 = require("@terra-money/terra.js");
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("../helpers/logHelper");
const utils_2 = require("../helpers/utils");
const evm_1 = require("../relayer/evm");
const ethereum_1 = require("../utils/ethereum");
const solana_1 = require("../utils/solana");
const terra_1 = require("../utils/terra");
let env;
const logger = (0, logHelper_1.getScopedLogger)(["walletMonitor"]);
async function pullBalances(metrics) {
    env = (0, configureEnv_1.getRelayerEnvironment)();
    //TODO loop through all the chain configs, calc the public keys, pull their balances, and push to a combo of the loggers and prmometheus
    if (!env) {
        logger.error("pullBalances() - no env");
        return [];
    }
    if (!env.supportedChains) {
        logger.error("pullBalances() - no supportedChains");
        return [];
    }
    const balancePromises = [];
    for (const chainInfo of env.supportedChains) {
        if (!chainInfo)
            continue;
        try {
            if (chainInfo.chainId === wormhole_sdk_1.CHAIN_ID_SOLANA) {
                for (const solanaPrivateKey of chainInfo.solanaPrivateKey || []) {
                    try {
                        balancePromises.push(pullSolanaNativeBalance(chainInfo, solanaPrivateKey));
                        // balancePromises.push(pullSolanaTokenBalances(chainInfo, solanaPrivateKey));
                    }
                    catch (e) {
                        logger.error("pulling balances failed failed for chain: " + chainInfo.chainName);
                        if (e && e.stack) {
                            logger.error(e.stack);
                        }
                    }
                }
            }
            else if ((0, wormhole_sdk_1.isEVMChain)(chainInfo.chainId)) {
                for (const privateKey of chainInfo.walletPrivateKey || []) {
                    try {
                        balancePromises.push(pullEVMNativeBalance(chainInfo, privateKey));
                    }
                    catch (e) {
                        logger.error("pullEVMNativeBalance() failed: " + e);
                    }
                }
                // TODO one day this will spin up independent watchers that time themselves
                // purposefully not awaited
                pullAllEVMTokens(env.supportedTokens, chainInfo, metrics);
            }
            else if ((0, wormhole_sdk_1.isTerraChain)(chainInfo.chainId)) {
                // TODO one day this will spin up independent watchers that time themselves
                // purposefully not awaited
                pullAllTerraBalances(env.supportedTokens, chainInfo, metrics);
            }
            else {
                logger.error("Invalid chain ID in wallet monitor " + chainInfo.chainId);
            }
        }
        catch (e) {
            logger.error("pulling balances failed failed for chain: " + chainInfo.chainName);
            if (e && e.stack) {
                logger.error(e.stack);
            }
        }
    }
    const balancesArrays = await Promise.all(balancePromises);
    const balances = balancesArrays.reduce((prev, curr) => [...prev, ...curr], []);
    return balances;
}
async function pullTerraBalance(lcd, walletAddress, tokenAddress, chainId) {
    try {
        const tokenInfo = await lcd.wasm.contractQuery(tokenAddress, {
            token_info: {},
        });
        const balanceInfo = await lcd.wasm.contractQuery(tokenAddress, {
            balance: {
                address: walletAddress,
            },
        });
        if (!tokenInfo || !balanceInfo) {
            return undefined;
        }
        return {
            chainId,
            balanceAbs: balanceInfo?.balance?.toString() || "0",
            balanceFormatted: (0, utils_1.formatUnits)(balanceInfo?.balance?.toString() || "0", tokenInfo.decimals),
            currencyName: tokenInfo.symbol,
            currencyAddressNative: tokenAddress,
            isNative: false,
            walletAddress: walletAddress,
        };
    }
    catch (e) {
        logger.error("Failed to fetch terra balance for %s", tokenAddress);
    }
}
exports.pullTerraBalance = pullTerraBalance;
async function pullSolanaTokenBalances(chainInfo, privateKey) {
    const keyPair = web3_js_1.Keypair.fromSecretKey(privateKey);
    const connection = new web3_js_1.Connection(chainInfo.nodeUrl);
    const output = [];
    try {
        const allAccounts = await connection.getParsedTokenAccountsByOwner(keyPair.publicKey, { programId: spl_token_1.TOKEN_PROGRAM_ID }, "confirmed");
        let mintAddresses = [];
        allAccounts.value.forEach((account) => {
            mintAddresses.push(account.account.data.parsed?.info?.mint);
        });
        const mdArray = await (0, utils_2.getMetaplexData)(mintAddresses, chainInfo);
        for (const account of allAccounts.value) {
            let mintAddress = [];
            mintAddress.push(account.account.data.parsed?.info?.mint);
            const mdArray = await (0, utils_2.getMetaplexData)(mintAddress, chainInfo);
            let cName = "";
            if (mdArray && mdArray[0] && mdArray[0].data && mdArray[0].data.symbol) {
                const encoded = mdArray[0].data.symbol;
                cName = encodeURIComponent(encoded);
                cName = cName.replace(/%/g, "_");
            }
            output.push({
                chainId: wormhole_sdk_1.CHAIN_ID_SOLANA,
                balanceAbs: account.account.data.parsed?.info?.tokenAmount?.amount,
                balanceFormatted: account.account.data.parsed?.info?.tokenAmount?.uiAmount,
                currencyName: cName,
                currencyAddressNative: account.account.data.parsed?.info?.mint,
                isNative: false,
                walletAddress: account.pubkey.toString(),
            });
        }
    }
    catch (e) {
        logger.error("pullSolanaTokenBalances() - ", e);
    }
    return output;
}
async function pullEVMNativeBalance(chainInfo, privateKey) {
    if (!privateKey || !chainInfo.nodeUrl) {
        throw new Error("Bad chainInfo config for EVM chain: " + chainInfo.chainId);
    }
    let provider = (0, evm_1.newProvider)(chainInfo.nodeUrl);
    if (!provider)
        throw new Error("bad provider");
    const signer = new ethers_1.ethers.Wallet(privateKey, provider);
    const addr = await signer.getAddress();
    const weiAmount = await provider.getBalance(addr);
    const balanceInEth = ethers_1.ethers.utils.formatEther(weiAmount);
    return [
        {
            chainId: chainInfo.chainId,
            balanceAbs: weiAmount.toString(),
            balanceFormatted: balanceInEth.toString(),
            currencyName: chainInfo.nativeCurrencySymbol,
            currencyAddressNative: "",
            isNative: true,
            walletAddress: addr,
        },
    ];
}
async function pullTerraNativeBalance(lcd, chainInfo, walletAddress) {
    try {
        const output = [];
        const [coins] = await lcd.bank.balance(walletAddress);
        // coins doesn't support reduce
        const balancePairs = coins.map(({ amount, denom }) => [denom, amount]);
        const balance = balancePairs.reduce((obj, current) => {
            obj[current[0].toString()] = current[1].toString();
            return obj;
        }, {});
        Object.keys(balance).forEach((key) => {
            output.push({
                chainId: chainInfo.chainId,
                balanceAbs: balance[key],
                balanceFormatted: (0, utils_1.formatUnits)(balance[key], 6).toString(),
                currencyName: (0, terra_1.formatNativeDenom)(key, chainInfo.chainId),
                currencyAddressNative: key,
                isNative: true,
                walletAddress: walletAddress,
            });
        });
        return output;
    }
    catch (e) {
        logger.error("Failed to fetch terra native balances for wallet %s", walletAddress);
        return [];
    }
}
async function pullSolanaNativeBalance(chainInfo, privateKey) {
    const keyPair = web3_js_1.Keypair.fromSecretKey(privateKey);
    const connection = new web3_js_1.Connection(chainInfo.nodeUrl);
    const fetchAccounts = await (0, solana_1.getMultipleAccountsRPC)(connection, [keyPair.publicKey]);
    if (!fetchAccounts[0]) {
        //Accounts with zero balance report as not existing.
        return [
            {
                chainId: chainInfo.chainId,
                balanceAbs: "0",
                balanceFormatted: "0",
                currencyName: chainInfo.nativeCurrencySymbol,
                currencyAddressNative: chainInfo.chainName,
                isNative: true,
                walletAddress: keyPair.publicKey.toString(),
            },
        ];
    }
    const amountLamports = fetchAccounts[0].lamports.toString();
    const amountSol = (0, utils_1.formatUnits)(fetchAccounts[0].lamports, wormhole_sdk_1.WSOL_DECIMALS).toString();
    return [
        {
            chainId: chainInfo.chainId,
            balanceAbs: amountLamports,
            balanceFormatted: amountSol,
            currencyName: chainInfo.nativeCurrencySymbol,
            currencyAddressNative: "",
            isNative: true,
            walletAddress: keyPair.publicKey.toString(),
        },
    ];
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
async function calcLocalAddressesEVM(provider, supportedTokens, chainConfigInfo) {
    const tokenBridge = wormhole_sdk_1.Bridge__factory.connect(chainConfigInfo.tokenBridgeAddress, provider);
    let tokenAddressPromises = [];
    for (const supportedToken of supportedTokens) {
        if (supportedToken.chainId === chainConfigInfo.chainId) {
            tokenAddressPromises.push(Promise.resolve(supportedToken.address));
            continue;
        }
        const hexAddress = (0, wormhole_sdk_1.tryNativeToHexString)(supportedToken.address, supportedToken.chainId);
        if (!hexAddress) {
            logger.debug("calcLocalAddressesEVM() - no hexAddress for chainId: " +
                supportedToken.chainId +
                ", address: " +
                supportedToken.address);
            continue;
        }
        tokenAddressPromises.push(tokenBridge.wrappedAsset(supportedToken.chainId, (0, wormhole_sdk_1.hexToUint8Array)(hexAddress)));
    }
    return (await Promise.all(tokenAddressPromises)).filter((tokenAddress) => tokenAddress && tokenAddress !== ethers_1.ethers.constants.AddressZero);
}
async function calcLocalAddressesTerra(lcd, supportedTokens, chainConfigInfo) {
    const output = [];
    for (const supportedToken of supportedTokens) {
        if (supportedToken.chainId === chainConfigInfo.chainId) {
            // skip natives, like uluna and uusd
            if (supportedToken.address.startsWith("terra")) {
                output.push(supportedToken.address);
            }
            continue;
        }
        const hexAddress = (0, wormhole_sdk_1.tryNativeToHexString)(supportedToken.address, supportedToken.chainId);
        if (!hexAddress) {
            continue;
        }
        //This returns a native address
        let foreignAddress;
        try {
            foreignAddress = await (0, wormhole_sdk_1.getForeignAssetTerra)(chainConfigInfo.tokenBridgeAddress, lcd, supportedToken.chainId, (0, wormhole_sdk_1.hexToUint8Array)(hexAddress));
        }
        catch (e) {
            logger.error("Foreign address exception.");
        }
        if (!foreignAddress) {
            continue;
        }
        output.push(foreignAddress);
    }
    return output;
}
exports.calcLocalAddressesTerra = calcLocalAddressesTerra;
async function pullAllEVMTokens(supportedTokens, chainConfig, metrics) {
    try {
        let provider = (0, evm_1.newProvider)(chainConfig.nodeUrl, true);
        const localAddresses = await calcLocalAddressesEVM(provider, supportedTokens, chainConfig);
        if (!chainConfig.walletPrivateKey) {
            return;
        }
        for (const privateKey of chainConfig.walletPrivateKey) {
            try {
                const publicAddress = await new ethers_1.ethers.Wallet(privateKey).getAddress();
                const tokens = await Promise.all(localAddresses.map((tokenAddress) => (0, ethereum_1.getEthereumToken)(tokenAddress, provider)));
                const tokenInfos = await Promise.all(tokens.map((token) => Promise.all([token.decimals(), token.balanceOf(publicAddress), token.symbol()])));
                const balances = tokenInfos.map(([decimals, balance, symbol], idx) => ({
                    chainId: chainConfig.chainId,
                    balanceAbs: balance.toString(),
                    balanceFormatted: (0, utils_1.formatUnits)(balance, decimals),
                    currencyName: symbol,
                    currencyAddressNative: localAddresses[idx],
                    isNative: false,
                    walletAddress: publicAddress,
                }));
                metrics.handleWalletBalances(balances);
            }
            catch (e) {
                logger.error("pullAllEVMTokens failed: for tokens " +
                    JSON.stringify(localAddresses) +
                    " on chain " +
                    chainConfig.chainId +
                    ", error: " +
                    e);
            }
        }
    }
    catch (e) {
        logger.error("pullAllEVMTokens failed: for chain " + chainConfig.chainId + ", error: " + e);
    }
}
async function pullAllTerraBalances(supportedTokens, chainConfig, metrics) {
    let balances = [];
    if (!chainConfig.walletPrivateKey) {
        return balances;
    }
    if (!(chainConfig.terraChainId && chainConfig.terraCoin && chainConfig.terraGasPriceUrl && chainConfig.terraName)) {
        logger.error("Terra relay was called without proper instantiation.");
        throw new Error("Terra relay was called without proper instantiation.");
    }
    const lcdConfig = {
        URL: chainConfig.nodeUrl,
        chainID: chainConfig.terraChainId,
        name: chainConfig.terraName,
        isClassic: chainConfig.isTerraClassic,
    };
    const lcd = new terra_js_1.LCDClient(lcdConfig);
    const localAddresses = await calcLocalAddressesTerra(lcd, supportedTokens, chainConfig);
    for (const privateKey of chainConfig.walletPrivateKey) {
        const mk = new terra_js_1.MnemonicKey({
            mnemonic: privateKey,
        });
        const wallet = lcd.wallet(mk);
        const walletAddress = wallet.key.accAddress;
        balances = [...balances, ...(await pullTerraNativeBalance(lcd, chainConfig, walletAddress))];
        for (const address of localAddresses) {
            const balance = await pullTerraBalance(lcd, walletAddress, address, chainConfig.chainId);
            if (balance) {
                balances.push(balance);
            }
        }
    }
    metrics.handleWalletBalances(balances);
}
//# sourceMappingURL=walletMonitor.js.map