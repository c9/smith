var EventEmitter = require('events').EventEmitter;
var msgpack = require('msgpack-js');
var inspect = require('util').inspect;

var freeze = require('./lib/scrubber').freeze;
var liven = require('./lib/scrubber').liven;
var deFramer = require('./lib/framer').deFramer;
var frameMessages = require('./lib/framer').frameMessages;
var getType = require('./lib/helpers').getType;

exports.serializer = serializer;
function serializer(keyOffset, proxyCall) {
  // Place to hold keyed functions
  var functions = {};
  var namedFunctions = {};
  var nextKey = keyOffset;
  // Generates a unique 32 bit key namespaced to the keyOffset
  function makeKey() {
    var key = (nextKey + 2) >>> 0;
    while (functions.hasOwnProperty(key)) {
      if (key === nextKey) {
        // We've wrapped around all the way to the beginning
        throw new Error("Ran out of keys in keyspace!!!");
      }
      key = (key + 2) >>> 0;
    }
    nextKey = key;
    return key;
  }

  // function goes in, λ id comes out
  function storeFunction(fn) {
    var λ = makeKey();
    functions[λ] = function () {
      var result = fn.apply(this, arguments);
      delete functions[λ];
      return result;
    };
    return λ;
  }

  // λ id goes in, function comes out
  // Proxy functions are created on the fly for missing ids from the other side.
  function getFunction(λ) {
    var temp;
    if (typeof λ === "string") {
      fn = namedFunctions[λ];
    } else {
      fn = functions[λ];
      temp = true;
    }
    if (typeof fn !== "function") {
      // If it's a new function from the other side, create a proxy
      if (temp && λ % 2 !== keyOffset) {
        fn = function () {
          proxyCall(λ, Array.prototype.slice.call(arguments));
          delete functions[λ];
        }
        fn.λ = λ;
        functions[λ] = fn;
      } else {
        throw new Error("Invalid λ key " + λ);
      }
    }
    return fn;
  }



  return {
    register: function (name, fn) {
      namedFunctions[name] = fn;
    },
    serialize: function (value) {
      return msgpack.encode(freeze(value, storeFunction));
    },
    deserialize: function (buffer) {
      return liven(msgpack.decode(buffer), getFunction);
    },
    proxyCall: function (λ, args) {
      var cleanup = typeof λ === "number";
      var fn = getFunction(λ);
      var result = fn.apply(null, args);
      if (cleanup) {
        delete functions[λ];
      }
      return result;
    },
    getFunction: getFunction,
    storeFunction: storeFunction
  };
}


////////////////////////////////////////////////////////////////////////////////

exports.startClient = function (input, output, functions) {
  var remote = new Remote(input, output, 1);
  // Hook up remote-functions and tell the server we're ready.
  remote.emitRemote("init", functions);
  return remote;
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
  this.register = this.s.register;

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
  // this.log(this.keyOffset ? "->" : "<-", inspect(message, false, 2));

  if (getType(message) !== "object") {
    return this.emit('error', new Error("Messages must be objects"));
  }

  // A remote function call
  if (message.hasOwnProperty("fn")) {
    return message.fn.apply(null, message.args);
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

Remote.prototype.callRemote = function (name) {
  var args = Array.prototype.slice.call(arguments, 1);
  this.onCall(name, args);
};

Remote.prototype.emitRemote = function (name, value) {
  var obj = {};
  obj[name] = value;
  this.sendObject(obj);
}


//////////////////////////////////////////////////////////////////////////////////


