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

var StreamProxy;
function defineStreamProxy() {
    var Stream = require('stream').Stream;
    var EventEmitter = require('events').EventEmitter;
    // Used to create local stream proxies of remote streams
    StreamProxy = function StreamProxy(id, send) {
        this.id = id;
        this.send = send;
        this.persistentCallbacks = {};
    }
    require('util').inherits(StreamProxy, Stream);

    // Intercept EventEmitter APIs for remote events
    var remoteEvents = { data: true, end: true, close: true, pipe: true };
    StreamProxy.prototype.on = function (name, callback) {
        // If it's a remote event and this is the first, register a remote data source
        if (remoteEvents[name] && !this.listeners(name).length) {
            var self = this;
            function masterCallback(value) {
                var args = [name];
                args.push.apply(args, arguments);
                self.emit.apply(self, args);
            }
            this.persistentCallbacks[name] = masterCallback;
            masterCallback.persistent = true;
            this.send([this.id, "on", name, masterCallback]);
        }
        return EventEmitter.prototype.on.apply(this, arguments);
    }
    StreamProxy.prototype.emit = function (name) {
        if (remoteEvents[name]) {
            var message = [this.id, "emit"];
            message.push.apply(message, arguments);
            this.send(message);
        }
        else {
            return EventEmitter.prototype.emit.apply(this, arguments);
        }
    };

    StreamProxy.prototype.removeListener = function (name, callback) {
        var ret = EventEmitter.prototype.removeListener.apply(this, arguments);
        console.log("R", name, this.listeners(name));
        if (remoteEvents[name] && !this.listeners(name).length && this.persistentCallbacks[name]) {
            // The last listener was removed, let's remove the remote one too.
            var callback = this.persistentCallbacks[name];
            this.send([this.id, "removeListener", name, callback]);
            this.send([false, callback.persistent]);
            delete this.persistentCallbacks[name];
            delete callback.persistent;
        }
        return ret;
    };

    StreamProxy.prototype.pipe = Stream.prototype.pipe;

    StreamProxy.prototype.write = function (chunk, encoding) {
        if (!this.writable) throw new Error("Called write, but not writable");
        var message = [this.id, "write", chunk];
        if (arguments.length >= 2) message.push(encoding);
        var ret = this.send(message, function () {
            if (ret === false) stream.emit("drain");
        });
        return ret;
    };
    StreamProxy.prototype.end = function (chunk, encoding) {
        if (!this.writable) throw new Error("Called end, but not writable");
        var message = [this.id, "end"];
        if (arguments.length >= 1) {
            message.push(chunk);
            if (arguments.length >= 2) message.push(encoding);
        }
        this.send(message);
    };
    StreamProxy.prototype.setEncoding = function (encoding) {
        if (!this.readable) throw new Error("Called setEncoding, but not readable");
        this.send([this.id, "setEncoding", encoding]);
    };
    StreamProxy.prototype.pause = function () {
        if (!this.readable) throw new Error("Called pause, but not readable");
        this.send([this.id, "pause"]);
    };
    StreamProxy.prototype.resume = function () {
        if (!this.readable) throw new Error("Called resume, but not readable");
        this.send([this.id, "resume"]);
    };
    StreamProxy.prototype.destroy = function () {
        if (!(this.readable || this.writable)) throw new Error("Called destroy, but not readable or writable");
        this.send([this.id, "destroy"]);
    };
    StreamProxy.prototype.destroySoon = function () {
        if (!(this.readable || this.writable)) throw new Error("Called destroySoon, but not readable or writable");
        this.send([this.id, "destroySoon"]);
    };

}

// `agent` is the local agent. `transport` is a transport to the remote agent.
function makeRemote(agent, transport) {
    // `remote` inherits from the local methods to serve the functions
    var remote = Object.create(agent.methods);
    var specials = {};
    var nextKey = 0;

    // Handle incoming messages.
    if (transport.on) transport.on("message", onMessage);
    else transport.onMessage = onMessage;
    function onMessage(message) {
        if (!(Array.isArray(message) && message.length)) throw new Error("Should be array");
        message = liven(message, function (special) {
            var key = getKey();
            if (special.F) {
                var id = special.F;
                var fn;
                if (special.p) {
                    fn = function () {
                        remote.call(id, Array.prototype.slice.call(arguments));
                    }
                }
                else {
                    var fn = function () {
                        delete specials[key];
                        remote.call(id, Array.prototype.slice.call(arguments));
                    };
                }
                specials[key] = fn;
                return fn;
            }
            if (special.S) {
                var id = special.S;
                if (!StreamProxy) defineStreamProxy();
                var stream = new StreamProxy(id, send);
                if (special.hasOwnProperty("r")) stream.readable = special.r;
                if (special.hasOwnProperty("w")) stream.writable = special.w;
                specials[key] = stream;
                return stream;
            }
            throw new Error("Invalid special type");
        });
        var target = message[0];
        if (target === false) {
            // false command mean to free specials (persistent callbacks usually)
            for (var i = 1, l = message.length; i < l; i++) {
                delete specials[message[i]];
            }
        }
        else if (typeof target === "string") {
            // Route named messages to named events
            remote[target].apply(remote, message.slice(1));
        }
        else {
            // Route others to one-shot callbacks
            if (!specials.hasOwnProperty(target)) {
                throw new Error("Invalid special ID " + target);
            }
            var special = specials[target];
            var type = getType(special);
            if (type === "function") {
                special.apply(null, message.slice(1));
            }
            else if (type === "stream") {
                special[message[1]].apply(special, message.slice(2));
            }
            else {
                throw new Error("Invalid special type " + type);
            }
        }
    }

    function getKey() {
        var key = (nextKey + 1) >> 0;
        while (specials.hasOwnProperty(key)) {
            key = (key + 1) >> 0;
            if (key === nextKey) {
                throw new Error("Ran out of keys!!");
            }
        }
        nextKey = key;

        return key;
    }

    function onSpecial(special) {
        var key;

        var type = getType(special);
        if (type === "function") {
            // Don't re-wrap already persistent values
            if (typeof special.persistent === "number") {
                return special.persistent;
            }
            key = getKey();
            if (special.persistent) {
                specials[key] = special;
                special.persistent = key;
            }
            else {
                specials[key] = function () {
                    delete specials[key];
                    return special.apply(this, arguments);
                };
            }
        }
        else if (type === "stream") {
            key = getKey();
            specials[key] = special;
            special.on("end", function () {
                delete specials[key];
            });
        }
        else {
            throw new Error("Unknown Type " + type);
        }
        return key;
    }

    function send(args, callback) {
        return transport.send(freeze(args, onSpecial), callback);
    }

    // Enable outgoing messages
    // Warning, this mutates args, don't plan on reusing them.
    remote.call = function call(name, args) {
        args.unshift(name);
        return send(args);
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
            var p = value.persistent;
            o = storeSpecial(value);
            if (p) o = {F:o,p:p};
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


