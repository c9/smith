
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
    remote.send(["ready", function (methodNames) {
        methodNames.forEach(function (name) {
            // Create a local proxy function for easy calling.
            remote[name] = function () {
                var args = [name];
                args.push.apply(args, arguments);
                remote.send(args);
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

    remote.send = send;

    return remote;

    function send(args, onDrain) {
        var message = freeze(args, storeFunction);
        return transport.send(message, onDrain);
    }

    // Generate a unique key within this channel.
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

    // Used by liven to convert function id's into function wrappers.
    function getFunction(id) {
        var key = getKey();
        // Push is actually fast http://jsperf.com/array-push-vs-concat-vs-unshift
        var fn = function () {
            delete callbacks[key];
            var args = [id];
            args.push.apply(args, arguments);
            send(args);
        };
        callbacks[key] = fn;
        return fn;
    }

    // Used by freeze to convert callback functions into integer tokens
    function storeFunction(fn) {
        var key = getKey();
        // Clean up the callback reference when it's called.
        callbacks[key] = function () {
            delete callbacks[key];
            return fn.apply(this, arguments);
        };
        return key;
    }

    function onMessage(message) {
        if (!(Array.isArray(message) && message.length)) throw new Error("Should be array");
        message = liven(message, getFunction);
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
}

// Convert a js object into a serializable object when functions are
// encountered, the storeFunction callback is called for each one.
// storeFunction takes in a function and returns a unique id number. Cycles
// are stored as object with a single $ key and an array of strigs as the
// path. Functions are stored as objects with a single $ key and id as value.
// props. properties starting with "$" have an extra $ prepended.
exports.freeze = freeze;
function freeze(value, storeFunction) {
    var seen = [];
    var paths = [];
    function find(value, path) {
        // find the type of the value
        var type = getType(value);
        // pass primitives through as-is
        if (type !== "function" && type !== "object" && type !== "array") {
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
            o = storeFunction(value);
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
// functions are inserted. The getFunction callback is called whenever a
// frozen function is encountered. It expects an ID and returns the function
exports.liven = liven;
function liven(message, getFunction) {
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
            // Load functions
            parent[key] = getFunction(special);
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
