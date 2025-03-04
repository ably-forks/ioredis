"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = require("./command");
const util_1 = require("util");
const standard_as_callback_1 = require("standard-as-callback");
const redis_commands_1 = require("redis-commands");
const calculateSlot = require("cluster-key-slot");
const pMap = require("p-map");
const PromiseContainer = require("./promiseContainer");
const commander_1 = require("./commander");
/*
  This function derives from the cluster-key-slot implementation.
  Instead of checking that all keys have the same slot, it checks that all slots are served by the same set of nodes.
  If this is satisfied, it returns the first key's slot.
*/
function generateMultiWithNodes(redis, keys) {
    const slot = calculateSlot(keys[0]);
    const target = redis.slots[slot].join(",");
    for (let i = 1; i < keys.length; i++) {
        const currentTarget = redis.slots[calculateSlot(keys[i])].join(",");
        if (currentTarget !== target) {
            return -1;
        }
    }
    return slot;
}
function Pipeline(redis) {
    commander_1.default.call(this);
    this.redis = redis;
    this.isCluster =
        this.redis.constructor.name === "Cluster" || this.redis.isCluster;
    this.isPipeline = true;
    this.options = redis.options;
    this._queue = [];
    this._result = [];
    this._transactions = 0;
    this._shaToScript = {};
    Object.keys(redis.scriptsSet).forEach((name) => {
        const script = redis.scriptsSet[name];
        this._shaToScript[script.sha] = script;
        this[name] = redis[name];
        this[name + "Buffer"] = redis[name + "Buffer"];
    });
    redis.addedBuiltinSet.forEach((name) => {
        this[name] = redis[name];
        this[name + "Buffer"] = redis[name + "Buffer"];
    });
    const Promise = PromiseContainer.get();
    this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
    const _this = this;
    Object.defineProperty(this, "length", {
        get: function () {
            return _this._queue.length;
        },
    });
}
exports.default = Pipeline;
Object.assign(Pipeline.prototype, commander_1.default.prototype);
Pipeline.prototype.fillResult = function (value, position) {
    if (this._queue[position].name === "exec" && Array.isArray(value[1])) {
        const execLength = value[1].length;
        for (let i = 0; i < execLength; i++) {
            if (value[1][i] instanceof Error) {
                continue;
            }
            const cmd = this._queue[position - (execLength - i)];
            try {
                value[1][i] = cmd.transformReply(value[1][i]);
            }
            catch (err) {
                value[1][i] = err;
            }
        }
    }
    this._result[position] = value;
    if (--this.replyPending) {
        return;
    }
    if (this.isCluster) {
        let retriable = true;
        let commonError;
        for (let i = 0; i < this._result.length; ++i) {
            const error = this._result[i][0];
            const command = this._queue[i];
            if (error) {
                if (command.name === "exec" &&
                    error.message ===
                        "EXECABORT Transaction discarded because of previous errors.") {
                    continue;
                }
                if (!commonError) {
                    commonError = {
                        name: error.name,
                        message: error.message,
                    };
                }
                else if (commonError.name !== error.name ||
                    commonError.message !== error.message) {
                    retriable = false;
                    break;
                }
            }
            else if (!command.inTransaction) {
                const isReadOnly = redis_commands_1.exists(command.name) && redis_commands_1.hasFlag(command.name, "readonly");
                if (!isReadOnly) {
                    retriable = false;
                    break;
                }
            }
        }
        if (commonError && retriable) {
            const _this = this;
            const errv = commonError.message.split(" ");
            const queue = this._queue;
            let inTransaction = false;
            this._queue = [];
            for (let i = 0; i < queue.length; ++i) {
                if (errv[0] === "ASK" &&
                    !inTransaction &&
                    queue[i].name !== "asking" &&
                    (!queue[i - 1] || queue[i - 1].name !== "asking")) {
                    const asking = new command_1.default("asking");
                    asking.ignore = true;
                    this.sendCommand(asking);
                }
                queue[i].initPromise();
                this.sendCommand(queue[i]);
                inTransaction = queue[i].inTransaction;
            }
            let matched = true;
            if (typeof this.leftRedirections === "undefined") {
                this.leftRedirections = {};
            }
            const exec = function () {
                _this.exec();
            };
            this.redis.handleError(commonError, this.leftRedirections, {
                moved: function (slot, key) {
                    _this.preferKey = key;
                    _this.redis.slots[errv[1]] = [key];
                    _this.redis.refreshSlotsCache();
                    _this.exec();
                },
                ask: function (slot, key) {
                    _this.preferKey = key;
                    _this.exec();
                },
                tryagain: exec,
                clusterDown: exec,
                connectionClosed: exec,
                maxRedirections: () => {
                    matched = false;
                },
                defaults: () => {
                    matched = false;
                },
            });
            if (matched) {
                return;
            }
        }
    }
    let ignoredCount = 0;
    for (let i = 0; i < this._queue.length - ignoredCount; ++i) {
        if (this._queue[i + ignoredCount].ignore) {
            ignoredCount += 1;
        }
        this._result[i] = this._result[i + ignoredCount];
    }
    this.resolve(this._result.slice(0, this._result.length - ignoredCount));
};
Pipeline.prototype.sendCommand = function (command) {
    if (this._transactions > 0) {
        command.inTransaction = true;
    }
    const position = this._queue.length;
    command.pipelineIndex = position;
    command.promise
        .then((result) => {
        this.fillResult([null, result], position);
    })
        .catch((error) => {
        this.fillResult([error], position);
    });
    this._queue.push(command);
    return this;
};
Pipeline.prototype.addBatch = function (commands) {
    let command, commandName, args;
    for (let i = 0; i < commands.length; ++i) {
        command = commands[i];
        commandName = command[0];
        args = command.slice(1);
        this[commandName].apply(this, args);
    }
    return this;
};
const multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function () {
    this._transactions += 1;
    return multi.apply(this, arguments);
};
const execBuffer = Pipeline.prototype.execBuffer;
const exec = Pipeline.prototype.exec;
Pipeline.prototype.execBuffer = util_1.deprecate(function () {
    if (this._transactions > 0) {
        this._transactions -= 1;
    }
    return execBuffer.apply(this, arguments);
}, "Pipeline#execBuffer: Use Pipeline#exec instead");
Pipeline.prototype.exec = function (callback) {
    // Wait for the cluster to be connected, since we need nodes information before continuing
    if (this.isCluster && !this.redis.slots.length) {
        this.redis.delayUntilReady((err) => {
            if (err) {
                callback(err);
                return;
            }
            this.exec(callback);
        });
        return this.promise;
    }
    if (this._transactions > 0) {
        this._transactions -= 1;
        return (this.options.dropBufferSupport ? exec : execBuffer).apply(this, arguments);
    }
    if (!this.nodeifiedPromise) {
        this.nodeifiedPromise = true;
        standard_as_callback_1.default(this.promise, callback);
    }
    if (!this._queue.length) {
        this.resolve([]);
    }
    let pipelineSlot;
    if (this.isCluster) {
        // List of the first key for each command
        const sampleKeys = [];
        for (let i = 0; i < this._queue.length; i++) {
            const keys = this._queue[i].getKeys();
            if (keys.length) {
                sampleKeys.push(keys[0]);
            }
            // For each command, check that the keys belong to the same slot
            if (keys.length && calculateSlot.generateMulti(keys) < 0) {
                this.reject(new Error("All the keys in a pipeline command should belong to the same slot"));
                return this.promise;
            }
        }
        if (sampleKeys.length) {
            pipelineSlot = generateMultiWithNodes(this.redis, sampleKeys);
            if (pipelineSlot < 0) {
                this.reject(new Error("All keys in the pipeline should belong to the same slots allocation group"));
                return this.promise;
            }
        }
        else {
            // Send the pipeline to a random node
            pipelineSlot = (Math.random() * 16384) | 0;
        }
    }
    // Check whether scripts exists
    const scripts = [];
    for (let i = 0; i < this._queue.length; ++i) {
        const item = this._queue[i];
        if (item.name !== "evalsha") {
            continue;
        }
        const script = this._shaToScript[item.args[0]];
        if (!script ||
            this.redis._addedScriptHashes[script.sha] ||
            scripts.includes(script)) {
            continue;
        }
        scripts.push(script);
    }
    const _this = this;
    if (!scripts.length) {
        return execPipeline();
    }
    // In cluster mode, always load scripts before running the pipeline
    if (this.isCluster) {
        return pMap(scripts, (script) => _this.redis.script("load", script.lua), {
            concurrency: 10,
        }).then(function () {
            for (let i = 0; i < scripts.length; i++) {
                _this.redis._addedScriptHashes[scripts[i].sha] = true;
            }
            return execPipeline();
        });
    }
    return this.redis
        .script("exists", scripts.map(({ sha }) => sha))
        .then(function (results) {
        const pending = [];
        for (let i = 0; i < results.length; ++i) {
            if (!results[i]) {
                pending.push(scripts[i]);
            }
        }
        const Promise = PromiseContainer.get();
        return Promise.all(pending.map(function (script) {
            return _this.redis.script("load", script.lua);
        }));
    })
        .then(function () {
        for (let i = 0; i < scripts.length; i++) {
            _this.redis._addedScriptHashes[scripts[i].sha] = true;
        }
        return execPipeline();
    });
    function execPipeline() {
        let data = "";
        let buffers;
        let writePending = (_this.replyPending = _this._queue.length);
        let node;
        if (_this.isCluster) {
            node = {
                slot: pipelineSlot,
                redis: _this.redis.connectionPool.nodes.all[_this.preferKey],
            };
        }
        let bufferMode = false;
        const stream = {
            write: function (writable) {
                if (writable instanceof Buffer) {
                    bufferMode = true;
                }
                if (bufferMode) {
                    if (!buffers) {
                        buffers = [];
                    }
                    if (typeof data === "string") {
                        buffers.push(Buffer.from(data, "utf8"));
                        data = undefined;
                    }
                    buffers.push(typeof writable === "string"
                        ? Buffer.from(writable, "utf8")
                        : writable);
                }
                else {
                    data += writable;
                }
                if (!--writePending) {
                    let sendData;
                    if (buffers) {
                        sendData = Buffer.concat(buffers);
                    }
                    else {
                        sendData = data;
                    }
                    if (_this.isCluster) {
                        node.redis.stream.write(sendData);
                    }
                    else {
                        _this.redis.stream.write(sendData);
                    }
                    // Reset writePending for resending
                    writePending = _this._queue.length;
                    data = "";
                    buffers = undefined;
                    bufferMode = false;
                }
            },
        };
        for (let i = 0; i < _this._queue.length; ++i) {
            _this.redis.sendCommand(_this._queue[i], stream, node);
        }
        return _this.promise;
    }
};
