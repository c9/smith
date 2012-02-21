var EventEmitter = require('events').EventEmitter;
var msgpack = require('msgpack-js');
var util = require('util');

////////////////////////////////////////////////////////////////////////////////

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

function map(value, callback, thisp) {
  if (typeof value.map === "function") {
    return value.map.call(value, callback, thisp);
  }
  var obj = {};
  var keys = Object.keys(value);
  for (var i = 0, l = keys.length; i < l; i++) {
    var key = keys[i];
    obj[key] = callback.call(thisp, value[key], key, value);
  }
  return obj;
}

// A simple state machine that consumes raw bytes and emits message events.
// Returns a parser function that consumes buffers.  It emits message buffers
// via onMessage callback passed in.
exports.deFramer = deFramer;
function deFramer(onMessage) {
  var buffer;
  var state = 0;
  var length = 0;
  var offset;
  return function parse(chunk) {
    for (var i = 0, l = chunk.length; i < l; i++) {
      switch (state) {
        case 0: length |= chunk[i] << 24; state = 1; break;
        case 1: length |= chunk[i] << 16; state = 2; break;
        case 2: length |= chunk[i] << 8; state = 3; break;
        case 3: length |= chunk[i]; state = 4;
          buffer = new Buffer(length);
          offset = 0;
          break;
        case 4:
          var len = l - i;
          var emit = false;
          if (len + offset >= length) {
            emit = true;
            len = length - offset;
          }
          // TODO: optimize for case where a copy isn't needed can a slice can
          // be used instead?
          chunk.copy(buffer, offset, i, i + len);
          offset += len;
          i += len - 1;
          if (emit) {
            onMessage(buffer);
            state = 0;
            length = 0;
            buffer = undefined;
            offset = undefined;
          }
          break;
      }
    }
  };
}


// Given an array of message buffers, this returns a single buffer that contains
// all the messages framed.
exports.frameMessages = frameMessages;
function frameMessages(messages) {
  var i, l = messages.length;

  // Calculate total size of final buffer
  var total = l * 4;
  for (i = 0; i < l; i++) {
    total += messages[i].length;
  }

  // Create and fill in final buffer
  var buffer = new Buffer(total);
  var offset = 0;
  for (i = 0; i < l; i++) {
    var message = messages[i];
    var length = message.length;
    buffer.writeUInt32BE(length, offset);
    message.copy(buffer, offset + 4);
    offset += length + 4;
  }

  return buffer;
}

function get(root, path) {
  var target = root;
  for (var i = 0, l = path.length; i < l; i++) {
    target = target[path[i]];
  }
  return target;
}

// Typeof is broken in javascript, add support for null and buffer types
function getType(value) {
  if (value === null) return "null";
  if (Buffer.isBuffer(value)) return "buffer";
  return typeof value;
}

// Map all enumerable functions to own properties and bind to original object
exports.skel = skel;
function skel(obj) {
  var clone = {};
  var seen = [];
  var values = [];
  function find(clone, obj) {
    for (var key in obj) {
      // Ignore private fields
      if (key[0] === "_") continue;

      var value = obj[key];
      var type = getType(value);

      // We only care about functions and objects, ignore the rest
      if (type !== "function" && type !== "object") continue;

      var index = seen.indexOf(value);
      if (index >= 0) {
        clone[key] = values[index];
        continue;
      }
      index = seen.length;

      seen[index] = value;
      if (type === "function") {
        values[index] = clone[key] = obj[key].bind(obj);
        continue;
      }
      if (type === "object") {
        values[index] = clone[key] = {};
        find(clone[key], value);
        continue;
      }
    }
  }
  find(clone, obj);
  return clone;
}


exports.serializer = serializer;
function serializer(keyOffset, proxyCall) {
  // Place to hold keyed functions
  var functions = {};

  // Generates a random unique 15 bit key
  // WARNING: will infinite loop if the keyspace gets full
  function makeKey() {
    var key = (Math.random() * 0x4000 << 1) + keyOffset;
    return functions.hasOwnProperty(key) ? makeKey() : key;
  }

  // function goes in, λ id comes out
  function storeFunction(fn) {
    if (fn.hasOwnProperty('λ')) {
      return fn.λ;
    }
    var λ = makeKey();
    functions[λ] = fn;
    fn.λ = λ;
    return λ;
  }

  // λ id goes in, function comes out
  // Proxy functions are created on the fly for missing ids from the other side.
  function getFunction(λ) {
    if (!functions.hasOwnProperty(λ)) {
      if ((λ % 2) === keyOffset) {
        throw new Error("Invalid λ id " + λ);
      }
      var fn = function () {
        proxyCall(λ, Array.prototype.slice.call(arguments));
      }
      fn.λ = λ;
      functions[λ] = fn;
    }
    return functions[λ];
  }

  function freeze(array) {
    var cycles = [];
    var seen = [];
    var paths = []
    function find(value, path) {
      // find the type of the value
      var type = getType(value);
      // pass primitives through as-is
      if (type !== "function" && type !== "object") return value;

      // Look for duplicates
      var index = seen.indexOf(value);
      if (index >= 0) {
        return {"*":paths[index]};
      }
      // If not seen, put it in the registry
      index = seen.length;
      seen[index] = value;
      paths[index] = path;

      // Look for functions
      if (type === "function") {
        return {λ:storeFunction(value)};
      }

      // Recurse on objects and arrays
      return map(value, function (sub, key) {
        return find(sub, path.concat([key]));
      });
    }
    return find(array, []);
  }

  function liven(message) {
    function find(value, parent, key) {
      // find the type of the value
      var type = getType(value);

      // pass primitives through as-is
      if (type !== "function" && type !== "object") {
        return parent[key] = value;
      }

      // Load functions
      if (value.hasOwnProperty("λ")) {
        return parent[key] = getFunction(value.λ);
      }

      // Load backreferences
      if (value.hasOwnProperty("*")) {
        return parent[key] = get(obj.root, value["*"]);
      }

      // Recurse on objects and arrays
      forEach(value, function (sub, key) {
        find(sub, value, key);
      });
      return obj;
    }
    var obj = {root:message};
    find(message, obj, "root");
    return obj.root;
  }

  return {
    serialize: function (value) {
      return msgpack.encode(freeze(value));
    },
    deserialize: function (buffer) {
      return liven(msgpack.decode(buffer));
    },
    proxyCall: function (λ, args) {
      var fn = functions[λ];
      if (typeof fn !== "function") {
        throw new Error("Invalid λ key " + λ);
      }
      return fn.apply(null, args);
    },
    release: function (λ) {
      delete functions[λ];
    },
    getFunction: getFunction,
    storeFunction: storeFunction
  };
}


////////////////////////////////////////////////////////////////////////////////

exports.startClient = function (input, output, functions) {
  var remote = new Remote(input, output, 1);
  // Hook up remote-functions and tell the server we're ready.
  remote.sendObject({init:functions});
}

exports.connectToClient = function (input, output, callback) {
  var remote = new Remote(input, output, 0);

  // Wait for connect from far end and then call callback
  remote.on('error', callback);
  remote.once('init', function (functions) {
    remote.removeListener('error', callback);
    callback(null, remote, functions);
  });
}

// The main constructor for protocol handles
exports.Remote = Remote;
function Remote(input, output, keyOffset) {
  this.callbacks = {};
  this.keyOffset = keyOffset;

  // Clients log on stderr, server on stdout
  this.log = keyOffset ? console.error : console.log;

  this.wrap("onCall");
  this.wrap("onFrame");

  this.s = serializer(keyOffset, this.onCall);

  // Route input through deFramer to onFrame callback
  input.on('data', deFramer(this.onFrame));

  // Private method to frame and send a buffer
  this.sendFrame = function (buffer) {
    output.write(frameMessages([buffer]));
  };

};

// Inherit from EventEmitter
Remote.prototype = Object.create(EventEmitter.prototype, { constructor: {value: Remote}});

Remote.prototype.wrap = function (name) {
  var self = this;
  var fn = this[name];
  this[name] = function () {
    try {
      fn.apply(self, arguments);
    } catch (err) {
      self.log("Error in " + name, err.stack || err);
      return;
    }
  };
}

Remote.prototype.onFrame = function (frame) {
  // Parse and check the msgpack message
  var message;
  try {
    message = this.s.deserialize(frame)
  } catch (err) {
    this.log("Error parsing frame", frame, err.stack || err);
    return;
  }
//  this.log(this.keyOffset ? "->" : "<-", util.inspect(message, false, 2));

  if (getType(message) !== "object") {
    return this.emit('error', new Error("Messages must be objects"));
  }

  // A remote function call
  if (message.hasOwnProperty("fn")) {
    return message.fn.apply(null, message.args);
  }
  // Releasing a function reference
  if (message.hasOwnProperty("rm")) {
    return this.s.release(message.rm);
  }
  // For all other keys, emit named events
  forEach(message, function (value, name) {
    this.emit(name, value);
  }, this);
};

// This is called when a proxy function is called.  We need to send the call
// to the other end of the socket.
Remote.prototype.onCall = function (λ, args) {
  this.sendObject({fn: {λ: λ}, args: args});
}

// Helper for sending msgpack messages
Remote.prototype.sendObject = function (object) {
  var buffer;
  try {
    buffer = this.s.serialize(object);
  } catch (err) {
    this.log("Error sending object\n" + (err.stack || err) + "\n", object);
    return;
  }
  this.sendFrame(buffer);
};


//////////////////////////////////////////////////////////////////////////////////


