"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const listener_1 = require("./listener");
const relayer_1 = require("./relayer");
/** Payload version 1 token bridge listener and relayer backend */
const backend = {
    relayer: new relayer_1.ZebecBridgeRelayer(),
    listener: new listener_1.ZebecBridgeLister(),
};
exports.default = backend;
//# sourceMappingURL=index.js.map