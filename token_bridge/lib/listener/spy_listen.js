"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.init = void 0;
const wormhole_spydk_1 = require("@certusone/wormhole-spydk");
const backends_1 = require("../backends");
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("../helpers/logHelper");
const utils_1 = require("../helpers/utils");
let metrics;
let env;
let logger = (0, logHelper_1.getLogger)();
let vaaUriPrelude;
function init() {
    try {
        env = (0, configureEnv_1.getListenerEnvironment)();
        vaaUriPrelude =
            "http://localhost:" +
                (process.env.REST_PORT ? process.env.REST_PORT : "4201") +
                "/relayvaa/";
    }
    catch (e) {
        logger.error("Error initializing listener environment: " + e);
        return false;
    }
    return true;
}
exports.init = init;
async function run(ph) {
    const logger = (0, logHelper_1.getLogger)();
    metrics = ph;
    logger.info("Attempting to run Listener...");
    logger.info("spy_relay starting up, will listen for signed VAAs from [" +
        env.spyServiceHost +
        "]");
    let typedFilters = await (0, backends_1.getBackend)().listener.getEmitterFilters();
    const wrappedFilters = { filters: typedFilters };
    while (true) {
        let stream;
        try {
            const client = (0, wormhole_spydk_1.createSpyRPCServiceClient)(env.spyServiceHost || "");
            stream = await (0, wormhole_spydk_1.subscribeSignedVAA)(client, wrappedFilters);
            //TODO validate that this is the correct type of the vaaBytes
            stream.on("data", ({ vaaBytes }) => {
                metrics.incIncoming();
                const asUint8 = new Uint8Array(vaaBytes);
                (0, backends_1.getBackend)().listener.process(asUint8);
            });
            let connected = true;
            stream.on("error", (err) => {
                logger.error("spy service returned an error: %o", err);
                connected = false;
            });
            stream.on("close", () => {
                logger.error("spy service closed the connection!");
                connected = false;
            });
            logger.info("connected to spy service, listening for transfer signed VAAs");
            while (connected) {
                await (0, utils_1.sleep)(1000);
            }
        }
        catch (e) {
            logger.error("spy service threw an exception: %o", e);
        }
        stream.destroy();
        await (0, utils_1.sleep)(5 * 1000);
        logger.info("attempting to reconnect to the spy service");
    }
}
exports.run = run;
//# sourceMappingURL=spy_listen.js.map