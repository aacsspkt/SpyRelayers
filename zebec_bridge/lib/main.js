"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
//This has to run first so that the process variables are set up when the other modules are instantiated.
require("./helpers/loadConfig");
const wasm_1 = require("@certusone/wormhole-sdk/lib/cjs/solana/wasm");
const configureEnv_1 = require("./configureEnv");
const logHelper_1 = require("./helpers/logHelper");
const promHelpers_1 = require("./helpers/promHelpers");
const redisHelper = __importStar(require("./helpers/redisHelper"));
const restListener = __importStar(require("./listener/rest_listen"));
const spyListener = __importStar(require("./listener/spy_listen"));
const relayWorker = __importStar(require("./relayer/relay_worker"));
const walletMonitor = __importStar(require("./monitor"));
const ARG_LISTEN_ONLY = "--listen_only";
const ARG_RELAY_ONLY = "--relay_only";
const ARG_WALLET_MONITOR_ONLY = "--wallet_monitor_only";
const ONLY_ONE_ARG_ERROR_MSG = `May only specify one of ${ARG_LISTEN_ONLY}, ${ARG_RELAY_ONLY}, or ${ARG_WALLET_MONITOR_ONLY}`;
const ONLY_ONE_ARG_ERROR_RESULT = `Multiple args found of ${ARG_LISTEN_ONLY}, ${ARG_RELAY_ONLY}, ${ARG_WALLET_MONITOR_ONLY}`;
(0, wasm_1.setDefaultWasm)("node");
const logger = (0, logHelper_1.getLogger)();
// Load the relay config data.
let runListen = true;
let runRelayWorker = true;
let runRest = true;
let runWalletMonitor = true;
let foundOne = false;
let error = "";
for (let idx = 0; idx < process.argv.length; ++idx) {
    if (process.argv[idx] === ARG_LISTEN_ONLY) {
        if (foundOne) {
            logger.error(ONLY_ONE_ARG_ERROR_MSG);
            error = ONLY_ONE_ARG_ERROR_RESULT;
            break;
        }
        logger.info("spy_relay is running in listen only mode");
        runRelayWorker = false;
        runWalletMonitor = false;
        foundOne = true;
    }
    if (process.argv[idx] === ARG_RELAY_ONLY) {
        if (foundOne) {
            logger.error(ONLY_ONE_ARG_ERROR_MSG);
            error = ONLY_ONE_ARG_ERROR_RESULT;
            break;
        }
        logger.info("spy_relay is running in relay only mode");
        runListen = false;
        runRest = false;
        runWalletMonitor = false;
        foundOne = true;
    }
    if (process.argv[idx] === ARG_WALLET_MONITOR_ONLY) {
        if (foundOne) {
            logger.error(ONLY_ONE_ARG_ERROR_MSG);
            error = ONLY_ONE_ARG_ERROR_RESULT;
            break;
        }
        logger.info("spy_relay is running in wallet monitor only mode");
        runListen = false;
        runRest = false;
        runRelayWorker = false;
        foundOne = true;
    }
}
if (!foundOne) {
    logger.info("spy_relay is running both the listener and relayer");
}
const runAll = runListen && runRelayWorker && runWalletMonitor;
if (runListen && !spyListener.init()) {
    process.exit(1);
}
if (runRelayWorker && !relayWorker.init()) {
    process.exit(1);
}
if (runRest && !restListener.init()) {
    process.exit(1);
}
if (runWalletMonitor && !walletMonitor.init()) {
    process.exit(1);
}
if (error) {
    logger.error(error);
    process.exit(1);
}
const commonEnv = (0, configureEnv_1.getCommonEnvironment)();
const { promPort, readinessPort } = commonEnv;
logger.info("prometheus client listening on port " + promPort);
let promClient;
if (runAll) {
    promClient = new promHelpers_1.PromHelper("spy_relay", promPort, promHelpers_1.PromMode.All);
}
else if (runListen) {
    promClient = new promHelpers_1.PromHelper("spy_relay", promPort, promHelpers_1.PromMode.Listen);
}
else if (runRelayWorker) {
    promClient = new promHelpers_1.PromHelper("spy_relay", promPort, promHelpers_1.PromMode.Relay);
}
else if (runWalletMonitor) {
    promClient = new promHelpers_1.PromHelper("spy_relay", promPort, promHelpers_1.PromMode.WalletMonitor);
}
else {
    logger.error("Invalid run mode for Prometheus");
    promClient = new promHelpers_1.PromHelper("spy_relay", promPort, promHelpers_1.PromMode.All);
}
redisHelper.init(promClient);
if (runListen)
    spyListener.run(promClient);
if (runRelayWorker)
    relayWorker.run(promClient);
if (runRest)
    restListener.run();
if (runWalletMonitor)
    walletMonitor.run(promClient);
if (readinessPort) {
    const Net = require("net");
    const readinessServer = new Net.Server();
    readinessServer.listen(readinessPort, function () {
        logger.info("listening for readiness requests on port " + readinessPort);
    });
    readinessServer.on("connection", function (socket) {
        //logger.debug("readiness connection");
    });
}
//# sourceMappingURL=main.js.map