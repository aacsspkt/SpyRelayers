"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScopedLogger = exports.getLogger = void 0;
const winston = require("winston");
const configureEnv_1 = require("../configureEnv");
//Be careful not to access this before having called init logger, or it will be undefined
let logger;
function getLogger() {
    if (logger) {
        return logger;
    }
    else {
        logger = initLogger();
        return logger;
    }
}
exports.getLogger = getLogger;
// Child loggers can't override defaultMeta, they add their own defaultRequestMetadata
// ...which is stored in a closure we can't read, so we extend it ourselves :)
// https://github.com/winstonjs/winston/blob/a320b0cf7f3c550a354ce4264d7634ebc60b0a67/lib/winston/logger.js#L45
function getScopedLogger(labels, parentLogger) {
    const scope = [...(parentLogger?.scope || []), ...labels];
    const logger = parentLogger || getLogger();
    const child = logger.child({
        labels: scope,
    });
    child.scope = scope;
    return child;
}
exports.getScopedLogger = getScopedLogger;
function initLogger() {
    const loggingEnv = (0, configureEnv_1.getCommonEnvironment)();
    let useConsole = true;
    let logFileName;
    if (loggingEnv.logDir) {
        useConsole = false;
        logFileName =
            loggingEnv.logDir + "/spy_relay." + new Date().toISOString() + ".log";
    }
    let logLevel = loggingEnv.logLevel || "info";
    let transport;
    if (useConsole) {
        console.log("spy_relay is logging to the console at level [%s]", logLevel);
        transport = new winston.transports.Console({
            level: logLevel,
        });
    }
    else {
        console.log("spy_relay is logging to [%s] at level [%s]", logFileName, logLevel);
        transport = new winston.transports.File({
            filename: logFileName,
            level: logLevel,
        });
    }
    const logConfiguration = {
        // NOTE: do not specify labels in defaultMeta, as it cannot be overridden
        transports: [transport],
        format: winston.format.combine(winston.format.splat(), winston.format.simple(), winston.format.timestamp({
            format: "YYYY-MM-DD HH:mm:ss.SSS",
        }), winston.format.errors({ stack: true }), winston.format.printf((info) => `${[info.timestamp]}|${info.level}|${info.labels && info.labels.length > 0
            ? info.labels.join("|")
            : "main"}: ${info.message}`)),
    };
    return winston.createLogger(logConfiguration);
}
//# sourceMappingURL=logHelper.js.map