"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayEVM = exports.newProvider = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const ethers_1 = require("ethers");
const logHelper_1 = require("../helpers/logHelper");
const celo_ethers_wrapper_1 = require("@celo-tools/celo-ethers-wrapper");
function newProvider(url, batch = false) {
    // only support http(s), not ws(s) as the websocket constructor can blow up the entire process
    // it uses a nasty setTimeout(()=>{},0) so we are unable to cleanly catch its errors
    if (url.startsWith("http")) {
        if (batch) {
            return new ethers_1.ethers.providers.JsonRpcBatchProvider(url);
        }
        return new ethers_1.ethers.providers.JsonRpcProvider(url);
    }
    throw new Error("url does not start with http/https!");
}
exports.newProvider = newProvider;
async function relayEVM(chainConfigInfo, signedVAA, unwrapNative, checkOnly, walletPrivateKey, relayLogger, metrics) {
    const logger = (0, logHelper_1.getScopedLogger)(["evm", chainConfigInfo.chainName], relayLogger);
    const signedVaaArray = (0, wormhole_sdk_1.hexToUint8Array)(signedVAA);
    let provider = undefined;
    let signer = undefined;
    if (chainConfigInfo.chainId === wormhole_sdk_1.CHAIN_ID_CELO) {
        provider = new celo_ethers_wrapper_1.CeloProvider(chainConfigInfo.nodeUrl);
        await provider.ready;
        signer = new celo_ethers_wrapper_1.CeloWallet(walletPrivateKey, provider);
    }
    else {
        provider = newProvider(chainConfigInfo.nodeUrl);
        signer = new ethers_1.ethers.Wallet(walletPrivateKey, provider);
    }
    logger.debug("Checking to see if vaa has already been redeemed.");
    const alreadyRedeemed = await (0, wormhole_sdk_1.getIsTransferCompletedEth)(chainConfigInfo.tokenBridgeAddress, provider, signedVaaArray);
    if (alreadyRedeemed) {
        logger.info("VAA has already been redeemed!");
        return { redeemed: true, result: "already redeemed" };
    }
    if (checkOnly) {
        return { redeemed: false, result: "not redeemed" };
    }
    if (unwrapNative) {
        logger.info("Will redeem and unwrap using pubkey: %s", await signer.getAddress());
    }
    else {
        logger.info("Will redeem using pubkey: %s", await signer.getAddress());
    }
    logger.debug("Redeeming.");
    let overrides = {};
    if (chainConfigInfo.chainId === wormhole_sdk_1.CHAIN_ID_POLYGON) {
        // look, there's something janky with Polygon + ethers + EIP-1559
        let feeData = await provider.getFeeData();
        overrides = {
            maxFeePerGas: feeData.maxFeePerGas?.mul(50) || undefined,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.mul(50) || undefined,
        };
    }
    else if (chainConfigInfo.chainId === wormhole_sdk_1.CHAIN_ID_KLAYTN || chainConfigInfo.chainId === wormhole_sdk_1.CHAIN_ID_FANTOM) {
        // Klaytn and Fantom require specifying gasPrice
        overrides = { gasPrice: (await signer.getGasPrice()).toString() };
    }
    const bridge = wormhole_sdk_1.Bridge__factory.connect(chainConfigInfo.tokenBridgeAddress, signer);
    const contractMethod = unwrapNative
        ? bridge.completeTransferAndUnwrapETH
        : bridge.completeTransfer;
    const tx = await contractMethod(signedVaaArray, overrides);
    logger.info("waiting for tx hash: %s", tx.hash);
    const receipt = await tx.wait();
    // Checking getIsTransferCompletedEth can be problematic if we get
    // load balanced to a node that is behind the block of our accepted tx
    // The auditor worker should confirm that our tx was successful
    const success = true;
    if (provider instanceof ethers_1.ethers.providers.WebSocketProvider) {
        await provider.destroy();
    }
    logger.info("success: %s tx hash: %s", success, receipt.transactionHash);
    metrics.incSuccesses(chainConfigInfo.chainId);
    return { redeemed: success, result: receipt };
}
exports.relayEVM = relayEVM;
//# sourceMappingURL=evm.js.map