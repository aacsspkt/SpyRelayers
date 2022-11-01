"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSOL_DECIMALS = exports.getAccountRPC = void 0;
async function getAccountRPC(connection, pubkey) {
    return connection.getAccountInfo(pubkey, "confirmed");
}
exports.getAccountRPC = getAccountRPC;
exports.WSOL_DECIMALS = 9;
//# sourceMappingURL=solana.js.map