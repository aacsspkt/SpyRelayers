"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.init = void 0;
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("../helpers/logHelper");
const walletMonitor_1 = require("./walletMonitor");
let metrics;
const logger = (0, logHelper_1.getLogger)();
let relayerEnv;
function init() {
    try {
        relayerEnv = (0, configureEnv_1.getRelayerEnvironment)();
    }
    catch (e) {
        logger.error("Encountered error while initiating the monitor environment: " + e);
        return false;
    }
    return true;
}
exports.init = init;
async function run(ph) {
    metrics = ph;
    try {
        (0, walletMonitor_1.collectWallets)(metrics);
    }
    catch (e) {
        logger.error("Failed to kick off collectWallets: " + e);
    }
}
exports.run = run;
//# sourceMappingURL=index.js.map