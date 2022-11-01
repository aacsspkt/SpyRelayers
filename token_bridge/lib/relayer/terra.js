"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayTerra = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const terra_js_1 = require("@terra-money/terra.js");
const axios_1 = __importDefault(require("axios"));
const logHelper_1 = require("../helpers/logHelper");
async function relayTerra(chainConfigInfo, signedVAA, checkOnly, walletPrivateKey, relayLogger, metrics) {
    const logger = (0, logHelper_1.getScopedLogger)(["terra"], relayLogger);
    if (!(chainConfigInfo.terraChainId &&
        chainConfigInfo.terraCoin &&
        chainConfigInfo.terraGasPriceUrl &&
        chainConfigInfo.terraName)) {
        logger.error("Terra relay was called without proper instantiation.");
        throw new Error("Terra relay was called without proper instantiation.");
    }
    const signedVaaArray = (0, wormhole_sdk_1.hexToUint8Array)(signedVAA);
    const lcdConfig = {
        URL: chainConfigInfo.nodeUrl,
        chainID: chainConfigInfo.terraChainId,
        name: chainConfigInfo.terraName,
        isClassic: chainConfigInfo.isTerraClassic,
    };
    const lcd = new terra_js_1.LCDClient(lcdConfig);
    const mk = new terra_js_1.MnemonicKey({
        mnemonic: walletPrivateKey,
    });
    const wallet = lcd.wallet(mk);
    logger.info("terraChainId: %s, tokenBridgeAddress: %s, accAddress: %s, signedVAA: %s", chainConfigInfo.terraChainId, chainConfigInfo.tokenBridgeAddress, wallet.key.accAddress, signedVAA);
    logger.debug("Checking to see if vaa has already been redeemed.");
    const alreadyRedeemed = await (0, wormhole_sdk_1.getIsTransferCompletedTerra)(chainConfigInfo.tokenBridgeAddress, signedVaaArray, lcd, chainConfigInfo.terraGasPriceUrl);
    if (alreadyRedeemed) {
        logger.info("VAA has already been redeemed!");
        return { redeemed: true, result: "already redeemed" };
    }
    if (checkOnly) {
        return { redeemed: false, result: "not redeemed" };
    }
    const msg = await (0, wormhole_sdk_1.redeemOnTerra)(chainConfigInfo.tokenBridgeAddress, wallet.key.accAddress, signedVaaArray);
    logger.debug("Getting gas prices");
    //let gasPrices = await lcd.config.gasPrices //Unsure if the values returned from this are hardcoded or not.
    //Thus, we are going to pull it directly from the current FCD.
    const gasPrices = await axios_1.default
        .get(chainConfigInfo.terraGasPriceUrl)
        .then((result) => result.data);
    logger.debug("Estimating fees");
    const account = await lcd.auth.accountInfo(wallet.key.accAddress);
    const feeEstimate = await lcd.tx.estimateFee([
        {
            sequenceNumber: account.getSequenceNumber(),
            publicKey: account.getPublicKey(),
        },
    ], {
        msgs: [msg],
        feeDenoms: [chainConfigInfo.terraCoin],
        gasPrices,
    });
    logger.debug("createAndSign");
    const tx = await wallet.createAndSignTx({
        msgs: [msg],
        memo: "Relayer - Complete Transfer",
        feeDenoms: [chainConfigInfo.terraCoin],
        gasPrices,
        fee: feeEstimate,
    });
    logger.debug("Broadcasting");
    const receipt = await lcd.tx.broadcast(tx);
    logger.debug("Checking to see if the transaction is complete.");
    const success = await (0, wormhole_sdk_1.getIsTransferCompletedTerra)(chainConfigInfo.tokenBridgeAddress, signedVaaArray, lcd, chainConfigInfo.terraGasPriceUrl);
    logger.info("success: %s, tx hash: %s", success, receipt.txhash);
    metrics.incSuccesses(chainConfigInfo.chainId);
    return { redeemed: success, result: receipt.txhash };
}
exports.relayTerra = relayTerra;
//# sourceMappingURL=terra.js.map