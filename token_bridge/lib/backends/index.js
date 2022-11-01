"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBackend = void 0;
const default_1 = __importDefault(require("./default"));
let backend;
const getBackend = () => {
    // Use the global one if it is already instantiated
    if (backend) {
        return backend;
    }
    if (process.env.CUSTOM_BACKEND) {
        try {
            backend = require(process.env.CUSTOM_BACKEND);
            return backend;
        }
        catch (e) {
            throw new Error(`Backend specified in CUSTOM_BACKEND is not importable: ${e?.message}`);
        }
    }
    if (!backend) {
        backend = default_1.default;
    }
    return backend;
};
exports.getBackend = getBackend;
//# sourceMappingURL=index.js.map