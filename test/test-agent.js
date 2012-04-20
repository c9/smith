require('./helpers');
var Agent = require('..').Agent;

var a = new Agent({
	add: function (a, b, callback) {
		callback(a + b);
	}
});
var b = new Agent();
process.nextTick(testStream);

expect("testStream");
function testStream() {
	var Stream = require('stream').Stream;
	var fs = require('fs');
	fulfill("testStream");
	var s = new Agent({
		createWriteStream: function (path, callback) {
			callback(null, fs.createWriteStream(path));
		},
		createReadStream: function (path, callback) {
			callback(null, fs.createReadStream(path, {bufferSize: 100}));
		}
	});
	var pair = require('architect-fake-transports')("S", "B", true);
	expect("connect SB");
	s.attach(pair.S, function (SB) {
		fulfill("connect SB");
		assert(SB);
	});
	expect("connect BS");
	b.attach(pair.B, function (BS) {
		fulfill("connect BS");
		assert(BS);
		BS.createWriteStream("test.js", function (err, outStream) {
			assert(!err);
			assert(outStream instanceof Stream);
			BS.createReadStream(__filename, function (err, inStream) {
				assert(!err);
				assert(inStream instanceof Stream);
				inStream.pipe(outStream);
			});
		});
	});
}

// expect("test1");
function testFakeTransport() {
	fulfill("test1");
	console.log("Testing fake transport");
	var pair = require('architect-fake-transports')("A", "B", true);
	expect("connect AB");
	a.attach(pair.A, function (AB) {
		fulfill("connect AB");
		console.log("A is connected to B!");
	});
	expect("connect BA");
	b.attach(pair.B, function (BA) {
		fulfill("connect BA");
		console.log("B is connected to A!");
		expect("result");
		BA.add(1, 2, function (result) {
			fulfill("result");	
			console.log("Result", result);
			assert.equal(result, 3);
			testSocketTransport();
		});
	});
}

// expect("alldone");
// expect("test2");
function testSocketTransport() {
	console.log("Test 2 using real tcp server");
	fulfill("test2");
	var net = require('net');
	var socketTransport = require('architect-socket-transport');
	expect("connect1");
	var server = net.createServer(function (socket) {
		fulfill("connect1");
		socket.on('data', function (chunk) {
			console.log("B->A (%s):", chunk.length, chunk);
		});
		expect("connectAB");
		a.attach(socketTransport(socket), function (AB) {
			fulfill("connectAB");
			console.log("A is connected to B!");
		});
		console.log("connection");
	});
	server.listen(function () {
		var port = server.address().port;
		expect("connect2");
		var socket = net.connect(port, function () {
			fulfill("connect2");
			expect("connectBA");
			b.attach(socketTransport(socket), function (BA) {
				fulfill("connectBA");
				console.log("B is connected to A!");
				expect("result2");
				BA.add(1, 2, function (result) {
					fulfill("result2");
					console.log("Result", result);
					assert.equal(result, 3);
					socket.end();
					server.close();	
					fulfill("alldone");
				});
			});
		});
		socket.on("data", function (chunk) {
			console.log("A->B (%s):", chunk.length, chunk);
		});
	});
}
