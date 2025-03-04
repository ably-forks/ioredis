"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeWithAutoPipelining = exports.shouldUseAutoPipelining = exports.notAllowedAutoPipelineCommands = exports.kCallbacks = exports.kExec = void 0;
const PromiseContainer = require("./promiseContainer");
const calculateSlot = require("cluster-key-slot");
const standard_as_callback_1 = require("standard-as-callback");
exports.kExec = Symbol("exec");
exports.kCallbacks = Symbol("callbacks");
exports.notAllowedAutoPipelineCommands = [
    "auth",
    "info",
    "script",
    "quit",
    "cluster",
    "pipeline",
    "multi",
    "subscribe",
    "psubscribe",
    "unsubscribe",
    "unpsubscribe",
];
function findAutoPipeline(client, _commandName, ...args) {
    if (!client.isCluster) {
        return "main";
    }
    // We have slot information, we can improve routing by grouping slots served by the same subset of nodes
    return client.slots[calculateSlot(args[0])].join(",");
}
function executeAutoPipeline(client, slotKey) {
    /*
      If a pipeline is already executing, keep queueing up commands
      since ioredis won't serve two pipelines at the same time
    */
    if (client._runningAutoPipelines.has(slotKey)) {
        return;
    }
    const pipeline = client._autoPipelines.get(slotKey);
    if (pipeline === undefined) {
        /* Some race condition; unsure of the cause, but catch it here and return before
         * setting the runningAutoPipelines flag else we'll throw after adding the flag and
         * never run another pipeline */
        console.error(`ioredis executeAutoPipeline: no pipeline with slotKey ${slotKey}`);
        return;
    }
    // Delete the pipeline so that new commands are queued on a new pipeline
    client._autoPipelines.delete(slotKey);
    client._runningAutoPipelines.add(slotKey);
    const callbacks = pipeline[exports.kCallbacks];
    // Perform the call
    pipeline.exec(function (err, results) {
        client._runningAutoPipelines.delete(slotKey);
        /*
          Invoke all callback in nextTick so the stack is cleared
          and callbacks can throw errors without affecting other callbacks.
        */
        if (err) {
            for (let i = 0; i < callbacks.length; i++) {
                process.nextTick(callbacks[i], err);
            }
        }
        else {
            for (let i = 0; i < callbacks.length; i++) {
                process.nextTick(callbacks[i], ...results[i]);
            }
        }
        // If there is another pipeline on the same node, immediately execute it without waiting for nextTick
        if (client._autoPipelines.has(slotKey)) {
            executeAutoPipeline(client, slotKey);
        }
    });
}
function shouldUseAutoPipelining(client, functionName, commandName) {
    return (functionName &&
        client.options.enableAutoPipelining &&
        !client.isPipeline &&
        !exports.notAllowedAutoPipelineCommands.includes(commandName) &&
        !client.options.autoPipeliningIgnoredCommands.includes(commandName));
}
exports.shouldUseAutoPipelining = shouldUseAutoPipelining;
function executeWithAutoPipelining(client, functionName, commandName, args, callback) {
    const CustomPromise = PromiseContainer.get();
    // On cluster mode let's wait for slots to be available
    if (client.isCluster && !client.slots.length) {
        return new CustomPromise(function (resolve, reject) {
            client.delayUntilReady((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                executeWithAutoPipelining(client, functionName, commandName, args, callback).then(resolve, reject);
            });
        });
    }
    const slotKey = findAutoPipeline(client, commandName, ...args);
    if (!client._autoPipelines.has(slotKey)) {
        const pipeline = client.pipeline();
        pipeline[exports.kExec] = false;
        pipeline[exports.kCallbacks] = [];
        client._autoPipelines.set(slotKey, pipeline);
    }
    const pipeline = client._autoPipelines.get(slotKey);
    /*
      Mark the pipeline as scheduled.
      The symbol will make sure that the pipeline is only scheduled once per tick.
      New commands are appended to an already scheduled pipeline.
    */
    if (!pipeline[exports.kExec]) {
        pipeline[exports.kExec] = true;
        /*
          Deferring with setImmediate so we have a chance to capture multiple
          commands that can be scheduled by I/O events already in the event loop queue.
        */
        setImmediate(executeAutoPipeline, client, slotKey);
    }
    // Create the promise which will execute the
    const autoPipelinePromise = new CustomPromise(function (resolve, reject) {
        pipeline[exports.kCallbacks].push(function (err, value) {
            if (err) {
                reject(err);
                return;
            }
            resolve(value);
        });
        pipeline[functionName](...args);
    });
    return standard_as_callback_1.default(autoPipelinePromise, callback);
}
exports.executeWithAutoPipelining = executeWithAutoPipelining;
