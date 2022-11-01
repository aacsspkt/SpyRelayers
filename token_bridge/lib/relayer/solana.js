"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relaySolana = void 0;
const wormhole_sdk_1 = require("@certusone/wormhole-sdk");
const spl_token_1 = require("@solana/spl-token");
const web3_js_1 = require("@solana/web3.js");
const logHelper_1 = require("../helpers/logHelper");
const MAX_VAA_UPLOAD_RETRIES_SOLANA = 5;
async function relaySolana(chainConfigInfo, signedVAAString, checkOnly, walletPrivateKey, relayLogger, metrics) {
    const logger = (0, logHelper_1.getScopedLogger)(["solana"], relayLogger);
    //TODO native transfer & create associated token account
    //TODO close connection
    const signedVaaArray = (0, wormhole_sdk_1.hexToUint8Array)(signedVAAString);
    const signedVaaBuffer = Buffer.from(signedVaaArray);
    const connection = new web3_js_1.Connection(chainConfigInfo.nodeUrl, "confirmed");
    if (!chainConfigInfo.bridgeAddress) {
        // This should never be the case, as enforced by createSolanaChainConfig
        return { redeemed: false, result: null };
    }
    const keypair = web3_js_1.Keypair.fromSecretKey(walletPrivateKey);
    const payerAddress = keypair.publicKey.toString();
    logger.info("publicKey: %s, bridgeAddress: %s, tokenBridgeAddress: %s", payerAddress, chainConfigInfo.bridgeAddress, chainConfigInfo.tokenBridgeAddress);
    logger.debug("Checking to see if vaa has already been redeemed.");
    const alreadyRedeemed = await (0, wormhole_sdk_1.getIsTransferCompletedSolana)(chainConfigInfo.tokenBridgeAddress, signedVaaArray, connection);
    if (alreadyRedeemed) {
        logger.info("VAA has already been redeemed!");
        return { redeemed: true, result: "already redeemed" };
    }
    if (checkOnly) {
        return { redeemed: false, result: "not redeemed" };
    }
    // determine fee destination address - an associated token account
    const { parse_vaa } = await (0, wormhole_sdk_1.importCoreWasm)();
    const parsedVAA = parse_vaa(signedVaaArray);
    const payloadBuffer = Buffer.from(parsedVAA.payload);
    const transferPayload = (0, wormhole_sdk_1.parseTransferPayload)(payloadBuffer);
    logger.debug("Calculating the fee destination address");
    let nativeOrigin;
    try {
        nativeOrigin = (0, wormhole_sdk_1.tryHexToNativeAssetString)(transferPayload.originAddress, wormhole_sdk_1.CHAIN_ID_SOLANA);
    }
    catch (e) {
        throw new Error(`Unable to convert origin address to native: ${e?.message}`);
    }
    const solanaMintAddress = transferPayload.originChain === wormhole_sdk_1.CHAIN_ID_SOLANA
        ? nativeOrigin
        : await (0, wormhole_sdk_1.getForeignAssetSolana)(connection, chainConfigInfo.tokenBridgeAddress, transferPayload.originChain, (0, wormhole_sdk_1.hexToUint8Array)(transferPayload.originAddress));
    if (!solanaMintAddress) {
        throw new Error(`Unable to determine mint for origin chain: ${transferPayload.originChain}, address: ${transferPayload.originAddress} (${nativeOrigin})`);
    }
    const solanaMintKey = new web3_js_1.PublicKey(solanaMintAddress);
    const feeRecipientAddress = await spl_token_1.Token.getAssociatedTokenAddress(spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID, spl_token_1.TOKEN_PROGRAM_ID, solanaMintKey, keypair.publicKey);
    // create the associated token account if it doesn't exist
    const associatedAddressInfo = await connection.getAccountInfo(feeRecipientAddress);
    if (!associatedAddressInfo) {
        logger.debug("Fee destination address %s for wallet %s, mint %s does not exist, creating it.", feeRecipientAddress.toString(), keypair.publicKey, solanaMintAddress);
        const transaction = new web3_js_1.Transaction().add(await spl_token_1.Token.createAssociatedTokenAccountInstruction(spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID, spl_token_1.TOKEN_PROGRAM_ID, solanaMintKey, feeRecipientAddress, keypair.publicKey, // owner
        keypair.publicKey // payer
        ));
        const { blockhash } = await connection.getRecentBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = keypair.publicKey;
        // sign, send, and confirm transaction
        transaction.partialSign(keypair);
        const txid = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(txid);
    }
    logger.debug("Posting the vaa.");
    await (0, wormhole_sdk_1.postVaaSolanaWithRetry)(connection, async (transaction) => {
        transaction.partialSign(keypair);
        return transaction;
    }, chainConfigInfo.bridgeAddress, payerAddress, signedVaaBuffer, MAX_VAA_UPLOAD_RETRIES_SOLANA);
    logger.debug("Redeeming.");
    const unsignedTransaction = await (0, wormhole_sdk_1.redeemOnSolana)(connection, chainConfigInfo.bridgeAddress, chainConfigInfo.tokenBridgeAddress, payerAddress, signedVaaArray, feeRecipientAddress.toString());
    logger.debug("Sending.");
    unsignedTransaction.partialSign(keypair);
    const txid = await connection.sendRawTransaction(unsignedTransaction.serialize());
    await connection.confirmTransaction(txid);
    logger.debug("Checking to see if the transaction is complete.");
    const success = await (0, wormhole_sdk_1.getIsTransferCompletedSolana)(chainConfigInfo.tokenBridgeAddress, signedVaaArray, connection);
    logger.info("success: %s, tx hash: %s", success, txid);
    metrics.incSuccesses(chainConfigInfo.chainId);
    return { redeemed: success, result: txid };
}
exports.relaySolana = relaySolana;
//# sourceMappingURL=solana.js.map