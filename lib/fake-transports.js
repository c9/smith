var msgpack = require('msgpack-js');
var EventEmitter = require('events').EventEmitter;

// Creates a fake transport pair for testing purposes that don't want to
// create a full network connection.  This emulates the limitations of
// serialzation and the async nature of network traffic.
module.exports = function fakeTransportPair(id1, id2, verbose) {
	var transport1 = new EventEmitter();
	var transport2 = new EventEmitter();
	transport1.send = function (message) {
		var frame = msgpack.encode(message);
		verbose && console.log("%s->%s (%d):", id1, id2, frame.length, message);
		process.nextTick(function () {
			transport2.emit("message", msgpack.decode(frame));
		});
	};
	transport2.send = function (message) {
		var frame = msgpack.encode(message);
		verbose && console.log("%s->%s (%d):", id2, id1, frame.length, message);
		process.nextTick(function () {
			transport1.emit("message", msgpack.decode(frame));
		});
	};
	var result = {};
	result[id1] = transport1;
	result[id2] = transport2;
	return result;
};
