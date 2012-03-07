var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
var freeze = require('./scrubber').freeze;
var liven = require('./scrubber').liven;

exports.Agent = Agent;
function Agent(methods) {
	this.methods = methods || {};
}

Agent.prototype.attach = function attach(transport, callback) {
	var remote = makeRemote(this, transport);
	// Listen for the other agent to tell us it's ready.
	var keys = Object.keys(this.methods);

	// When the other side is ready, tell it our methods
	remote.once('ready', function (callback) {
		callback(keys);
	});

	// Tell the other agent we're ready and ask for it's methods
	remote.call("ready", [function (methodNames) {
		methodNames.forEach(function (name) {
			// Create a local proxy function for easy calling.
			remote[name] = function () {
				remote.call(name, Array.prototype.slice.call(arguments));
			}
		});
		callback(remote);
	}]);
};

// `agent` is the local agent. `transport` is a transport to the remote agent.
function makeRemote(agent, transport) {
	// `remote` emits named events when the remote agent sends us named requests.
	var remote = new EventEmitter();
	// Route event requests to the agent's methods.
	var names = Object.keys(agent.methods);
	names.forEach(function (name) {
		remote.on(name, agent.methods[name]);
	});

	var callbacks = {};
	var nextKey = 0;

	// Handle incoming messages.
	transport.on('message', function (message) {
		assert(Array.isArray(message) && message.length);
		message = liven(message, function (id) {
			var key = getKey();
			var fn = function () {
				delete callbacks[key];
				remote.call(id, Array.prototype.slice.call(arguments));
			}
			callbacks[key] = fn;
			return fn;
		});
		var target = message[0];
		if (typeof target === "string") {
			// Route named messages to named events
			remote.emit.apply(remote, message);
		}
		else {
			// Route others to one-shot callbacks
			var fn = callbacks[target];
			assert(typeof fn === "function");
			fn.apply(null, message.slice(1));
		}
	});

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
