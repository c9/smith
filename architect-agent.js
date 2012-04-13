var Stream; // Get the Stream constructor if we're in node
try { Stream = require('stream'); } catch (err) {}

exports.Agent = Agent;
function Agent(methods) {
    this.methods = methods || {};
}

Agent.prototype.attach = function attach(transport, callback) {
    var remote = makeRemote(this, transport);
    // Listen for the other agent to tell us it's ready.
    var keys = Object.keys(this.methods);

    // When the other side is ready, tell it our methods
    remote.ready = function (callback) {
        delete remote.ready;
        callback(keys);
    };

    // Tell the other agent we're ready and ask for it's methods
    remote.call("ready", [function (methodNames) {
        methodNames.forEach(function (name) {
            // Create a local proxy function for easy calling.
            remote[name] = function () {
                remote.call(name, Array.prototype.slice.call(arguments));
            };
        });
        callback(remote);
    }]);
};

// `agent` is the local agent. `transport` is a transport to the remote agent.
function makeRemote(agent, transport) {
    // `remote` inherits from the local methods to serve the functions
    var remote = Object.create(agent.methods);
    var callbacks = {};
    var nextKey = 0;

    // Handle incoming messages.
    if (transport.on) transport.on("message", onMessage);
    else transport.onMessage = onMessage;
    function onMessage(message) {
        if (!(Array.isArray(message) && message.length)) throw new Error("Should be array");
        message = liven(message, function (special) {
            if (special.F) {
                var id = special.F;
                var key = getKey();
                var fn = function () {
                    delete callbacks[key];
                    remote.call(id, Array.prototype.slice.call(arguments));
                };
                callbacks[key] = fn;
                return fn;
            }
            if (special.S) {
                throw new Error("Stream Not Implemented")
            }
            throw new Error("Invalid special type");
        });
        var target = message[0];
        if (typeof target === "string") {
            // Route named messages to named events
            remote[target].apply(remote, message.slice(1));
        }
        else {
            // Route others to one-shot callbacks
            var fn = callbacks[target];
            if (!(typeof fn === "function")) throw new Error("Should be function");
            fn.apply(null, message.slice(1));
        }
    }

    function getKey() {
        var key = (nextKey + 1) >> 0;
        while (callbacks.hasOwnProperty(key)) {
            key = (key + 1) >> 0;
            if (key === nextKey) {
                throw new Error("Ran out of keys!!");
            }
        }
        nextKey = key;

        return key;
    }

    // Enable outgoing messages
    // Warning, this mutates args, don't plan on reusing them.
    remote.call = function call(name, args) {
        args.unshift(name);
        var message = freeze(args, function (fn) {
            var key = getKey();
            callbacks[key] = function () {
                delete callbacks[key];
                return fn.apply(this, arguments);
            };
            return key;
        });
        transport.send(message);
    };

    return remote;
}

// Convert a js object into a serializable object when functions are
// encountered, the storeFunction callback is called for each one.
// storeSpecial takes in a function or stream and returns a unique id number.
// Cycles are stored as object with a single $ key and an array of strigs as the path.
// Functions and Streams are stored as objects with a single $ key and an object as value
// that object has F key for function and S key for stream, the value is the id (number)
// there can be other properties as lowercase characters (p in function means persistent, r and w in stream mean readable and writable)
// if the $ property has a number value it's shortcut for function with no extra props.
// properties starting with "$" have an extra $ prepended.
exports.freeze = freeze;
function freeze(value, storeSpecial) {
    var seen = [];
    var paths = [];
    function find(value, path) {
        // find the type of the value
        var type = getType(value);
        // pass primitives through as-is
        if (type !== "function" && type !== "object" && type !== "array" && type !== "stream") {
            return value;
        }

        // Look for duplicates
        var index = seen.indexOf(value);
        if (index >= 0) {
            return { "$": paths[index] };
        }
        // If not seen, put it in the registry
        index = seen.length;
        seen[index] = value;
        paths[index] = path;

        var o;
        // Look for functions
        if (type === "function") {
            // TODO: support persistent functions using longhand {$:{F:id,p:true}}
            o = storeSpecial(value);
            if (value.hasOwnProperty("persistent")) o = {F:o,p:value.persistent};
        }

        // Look for streams
        if (type === "stream") {
            o = {S:storeSpecial(value) };
            if (value.hasOwnProperty('readable')) o.r = value.readable;
            if (value.hasOwnProperty('writable')) o.w = value.writable;
        }

        if (o) return {$:o};

        // Recurse on objects and arrays
        return map(value, function (sub, key) {
            return find(sub, path.concat([key]));
        }, null, function (key) {
          return key[0] === "$" ? "$" + key : key;
        });
    }
    return find(value, []);
}

// Converts flat objects into live objects.  Cycles are re-connected and
// functions are inserted. The getSpecial callback is called whenever a
// frozen function or stream is encountered. It expects an object {S:3} and returns the value
exports.liven = liven;
function liven(message, getSpecial) {
    function find(value, parent, key) {
        // find the type of the value
        var type = getType(value);

        // Unescape $$+ escaped keys
        if (key[0] === "$") key = key.substr(1);

        // pass primitives through as-is
        if (type !== "function" && type !== "object" && type !== "array") {
            parent[key] = value;
            return value;
        }

        // Load Specials
        if (value.hasOwnProperty("$")) {
            var special = value.$;
            // Load backreferences
            if (Array.isArray(special)) {
              parent[key] = get(obj.root, special);
              return parent[key];
            }
            if (typeof special === "number") special = {F:special};
            // Load streams and functions
            parent[key] = getSpecial(special);
            return  parent[key];
        }

        // Recurse on objects and arrays
        var o = Array.isArray(value) ? [] : {};
        parent[key] = o;
        forEach(value, function (sub, key) {
            find(sub, o, key);
        });
        return obj;
    }
    var obj = {};
    find(message, obj, "root");
    return obj.root;
}

// Typeof is broken in javascript, add support for null and buffer types
exports.getType = getType;
function getType(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
        return "buffer";
    }
    if (typeof Stream !== "undefined" && (value instanceof Stream)) {
        return "stream";
    }
    return typeof value;
}

// Traverse an object to get a value at a path
exports.get = get;
function get(root, path) {
    var target = root;
    for (var i = 0, l = path.length; i < l; i++) {
        target = target[path[i]];
    }
    return target;
}

// forEach that works on both arrays and objects
exports.forEach = forEach;
function forEach(value, callback, thisp) {
    if (typeof value.forEach === "function") {
        return value.forEach.call(value, callback, thisp);
    }
    var keys = Object.keys(value);
    for (var i = 0, l = keys.length; i < l; i++) {
        var key = keys[i];
        callback.call(thisp, value[key], key, value);
    }
}

// map that works on both arrays and objects
exports.map = map;
function map(value, callback, thisp, keyMap) {
    if (typeof value.map === "function") {
        return value.map.call(value, callback, thisp);
    }
    var obj = {};
    var keys = Object.keys(value);
    for (var i = 0, l = keys.length; i < l; i++) {
        var key = keys[i];
        obj[keyMap ? keyMap(key) : key] = callback.call(thisp, value[key], key, value);
    }
    return obj;
}


