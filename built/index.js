"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.print = exports.ReplyError = exports.SentinelIterator = exports.SentinelConnector = exports.AbstractConnector = exports.Pipeline = exports.ScanStream = exports.Command = exports.Cluster = exports.default = void 0;
exports = module.exports = require("./redis").default;
var redis_1 = require("./redis");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return redis_1.default; } });
var cluster_1 = require("./cluster");
Object.defineProperty(exports, "Cluster", { enumerable: true, get: function () { return cluster_1.default; } });
var command_1 = require("./command");
Object.defineProperty(exports, "Command", { enumerable: true, get: function () { return command_1.default; } });
var ScanStream_1 = require("./ScanStream");
Object.defineProperty(exports, "ScanStream", { enumerable: true, get: function () { return ScanStream_1.default; } });
var pipeline_1 = require("./pipeline");
Object.defineProperty(exports, "Pipeline", { enumerable: true, get: function () { return pipeline_1.default; } });
var AbstractConnector_1 = require("./connectors/AbstractConnector");
Object.defineProperty(exports, "AbstractConnector", { enumerable: true, get: function () { return AbstractConnector_1.default; } });
var SentinelConnector_1 = require("./connectors/SentinelConnector");
Object.defineProperty(exports, "SentinelConnector", { enumerable: true, get: function () { return SentinelConnector_1.default; } });
Object.defineProperty(exports, "SentinelIterator", { enumerable: true, get: function () { return SentinelConnector_1.SentinelIterator; } });
// No TS typings
exports.ReplyError = require("redis-errors").ReplyError;
const PromiseContainer = require("./promiseContainer");
Object.defineProperty(exports, "Promise", {
    get() {
        return PromiseContainer.get();
    },
    set(lib) {
        PromiseContainer.set(lib);
    },
});
function print(err, reply) {
    if (err) {
        console.log("Error: " + err);
    }
    else {
        console.log("Reply: " + reply);
    }
}
exports.print = print;
