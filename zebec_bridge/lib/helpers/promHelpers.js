"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromHelper = exports.PromMode = void 0;
const http = require("http");
const client = require("prom-client");
const wormhole_1 = require("../utils/wormhole");
const logHelper_1 = require("./logHelper");
const redisHelper_1 = require("./redisHelper");
// NOTE:  To create a new metric:
// 1) Create a private counter/gauge with appropriate name and help
// 2) Create a method to set the metric to a value
// 3) Register the metric
const logger = (0, logHelper_1.getScopedLogger)(["prometheusHelpers"]);
var PromMode;
(function (PromMode) {
    PromMode[PromMode["Listen"] = 0] = "Listen";
    PromMode[PromMode["Relay"] = 1] = "Relay";
    PromMode[PromMode["WalletMonitor"] = 2] = "WalletMonitor";
    PromMode[PromMode["All"] = 3] = "All";
})(PromMode = exports.PromMode || (exports.PromMode = {}));
class PromHelper {
    _register = new client.Registry();
    _mode;
    collectDefaultMetrics = client.collectDefaultMetrics;
    // Actual metrics (please prefix all metrics with `spy_relay_`)
    successCounter = new client.Counter({
        name: "spy_relay_successes",
        help: "number of successful relays",
    });
    confirmedCounter = new client.Counter({
        name: "spy_relay_confirmed_successes",
        help: "number of confirmed successful relays",
    });
    failureCounter = new client.Counter({
        name: "spy_relay_failures",
        help: "number of failed relays",
    });
    rollbackCounter = new client.Counter({
        name: "spy_relay_rollback",
        help: "number of rolled back relays",
    });
    completeTime = new client.Histogram({
        name: "spy_relay_complete_time",
        help: "Time is took to complete transfer",
        buckets: [400, 800, 1600, 3200, 6400, 12800],
    });
    listenCounter = new client.Counter({
        name: "spy_relay_VAAs_received",
        help: "number of VAAs received",
    });
    alreadyExecutedCounter = new client.Counter({
        name: "spy_relay_already_executed",
        help: "number of transfers rejected due to already having been executed",
    });
    listenerMemqueue = new client.Gauge({
        name: "spy_relay_listener_memqueue_length",
        help: "number of items in memory in the listener waiting to be pushed to redis.",
    });
    redisQueue = new client.Gauge({
        name: "spy_relay_redis_queue_length",
        help: "number of items in the pending queue.",
        labelNames: ["queue", "source_chain_name"],
    });
    archiveApiStatus = new client.Gauge({
        name: "achive_api_status",
        help: "status of relay arhive api",
    });
    // Wallet metrics
    walletBalance = new client.Gauge({
        name: "spy_relay_wallet_balance",
        help: "Wallet balance for a supported token",
        labelNames: ["currency", "wallet", "currency_address"],
    });
    // End metrics
    server = http.createServer(async (req, res) => {
        // GKE's ingress-gce doesn't support custom URLs for healthchecks
        // without some stupid, so return 200 on / for prometheus to make
        // it happy.
        if (req.url === "/") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.write("ok");
            res.end();
            // The gke ingress-gce does not support stripping path prefixes
        }
        else if (req.url === "/metrics" ||
            req.url === "/relayer" ||
            req.url === "/listener" ||
            req.url === "/wallet-monitor") {
            // Return all metrics in the Prometheus exposition format
            res.setHeader("Content-Type", this._register.contentType);
            res.end(await this._register.metrics());
        }
        else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.write("404 Not Found - " + req.url + "\n");
            res.end();
        }
    });
    constructor(name, port, mode) {
        var mode_name = "";
        // Human readable mode name for the metrics
        if (mode === PromMode.Listen) {
            mode_name = "listener";
        }
        else if (mode === PromMode.Relay) {
            mode_name = "relayer";
        }
        else if (mode === PromMode.WalletMonitor) {
            mode_name = "wallet-monitor";
        }
        else if (mode === PromMode.All) {
            mode_name = "all";
        }
        this._register.setDefaultLabels({
            app: name,
            mode: mode_name,
        });
        // Uncomment to collect the default metrics (cpu/memory/nodejs gc stuff/etc)
        //this.collectDefaultMetrics({ register: this._register, prefix: "spy_relayer_" });
        this._mode = mode;
        // Register each metric
        if (this._mode === PromMode.Listen || this._mode === PromMode.All) {
            this._register.registerMetric(this.listenCounter);
        }
        if (this._mode === PromMode.Relay || this._mode === PromMode.All) {
            this._register.registerMetric(this.successCounter);
            this._register.registerMetric(this.confirmedCounter);
            this._register.registerMetric(this.failureCounter);
            this._register.registerMetric(this.rollbackCounter);
            this._register.registerMetric(this.alreadyExecutedCounter);
            this._register.registerMetric(this.redisQueue);
            this._register.registerMetric(this.archiveApiStatus);
        }
        if (this._mode === PromMode.WalletMonitor || this._mode === PromMode.All) {
            this._register.registerMetric(this.walletBalance);
        }
        // End registering metric
        this.server.listen(port);
    }
    // These are the accessor methods for the metrics
    incSuccesses(value) {
        this.successCounter.inc(value);
    }
    incConfirmed(value) {
        this.confirmedCounter.inc(value);
    }
    incFailures(value) {
        this.failureCounter.inc(value);
    }
    incRollback(value) {
        this.rollbackCounter.inc(value);
    }
    addCompleteTime(val) {
        this.completeTime.observe(val);
    }
    incIncoming() {
        this.listenCounter.inc();
    }
    incAlreadyExec() {
        this.alreadyExecutedCounter.inc();
    }
    handleListenerMemqueue(size) {
        this.listenerMemqueue.set(size);
    }
    setRedisQueue(queue, sourceChainId, size) {
        this.redisQueue
            .labels({
            queue: redisHelper_1.RedisTables[queue].toLowerCase(),
            source_chain_name: wormhole_1.chainIDStrings[sourceChainId],
        })
            .set(size);
    }
    setRelayArchiveApiStatus(status) {
        this.archiveApiStatus.set(status);
    }
    // Wallet metrics
    handleWalletBalances(balances) {
        const scopedLogger = (0, logHelper_1.getScopedLogger)(["handleWalletBalances"], logger);
        // Walk through each wallet
        // create a gauge for the balance
        // set the gauge
        //this.walletMetrics = [];
        for (const bal of balances) {
            try {
                let formBal;
                if (!bal.balanceFormatted) {
                    formBal = 0;
                }
                else {
                    formBal = parseFloat(bal.balanceFormatted);
                }
                this.walletBalance
                    .labels({
                    currency: bal.currencyName,
                    wallet: bal.walletAddress,
                    currency_address: bal.currencyAddressNative,
                })
                    .set(formBal);
            }
            catch (e) {
                if (e.message) {
                    scopedLogger.error("Caught error: " + e.message);
                }
                else {
                    scopedLogger.error("Caught error: %o", e);
                }
            }
        }
    }
}
exports.PromHelper = PromHelper;
//# sourceMappingURL=promHelpers.js.map