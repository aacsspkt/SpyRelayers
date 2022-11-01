"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.init = void 0;
const backends_1 = require("../backends");
const configureEnv_1 = require("../configureEnv");
const logHelper_1 = require("../helpers/logHelper");
let logger = (0, logHelper_1.getLogger)();
let env;
function init() {
    try {
        env = (0, configureEnv_1.getListenerEnvironment)();
    }
    catch (e) {
        logger.error("Encountered and error while initializing the listener environment: " + e);
        return false;
    }
    if (!env.restPort) {
        return true;
    }
    return true;
}
exports.init = init;
async function run() {
    if (!env.restPort)
        return;
    const express = require("express");
    const cors = require("cors");
    const app = express();
    app.use(cors());
    app.listen(env.restPort, () => logger.info("listening on REST port %d!", env.restPort));
    (async () => {
        app.get("/relayvaa/:vaa", async (req, res) => {
            try {
                const rawVaa = Uint8Array.from(Buffer.from(req.params.vaa, "base64"));
                await (0, backends_1.getBackend)().listener.process(rawVaa);
                res.status(200).json({ message: "Scheduled" });
            }
            catch (e) {
                logger.error("failed to process rest relay of vaa request, error: %o", e);
                logger.error("offending request: %o", req);
                res.status(400).json({ message: "Request failed" });
            }
        });
        app.get("/", (req, res) => res.json(["/relayvaa/<vaaInBase64>"]));
    })();
}
exports.run = run;
//# sourceMappingURL=rest_listen.js.map