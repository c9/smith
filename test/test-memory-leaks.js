// A mini async test framework
var assert = require('assert');
var util = require('util');
var expectations = {};
function expect(message) { expectations[message] = new Error("Missing expectation: " + message); }
function fulfill(message) { delete expectations[message]; }
process.addListener('exit', function () {
  Object.keys(expectations).forEach(function (message) {
    throw expectations[message];
  });
});


var Remote = require('../protocol').Remote;
var EventEmitter = require('events').EventEmitter;

// A fake socket for simulating network traffic
function Socket(){}
Socket.prototype = Object.create(EventEmitter.prototype, {constructor:{value:Socket}});

// Takes in a buffer and simulates writing it to the other side
Socket.prototype.write = function (data) {
  assert(Buffer.isBuffer(data));
  var other = this.other;
  var copy = new Buffer(data.length);
  data.copy(copy);
  process.nextTick(function () {
    other.emit('data', copy);
  });
};

// Create a fake pair
var s1 = new Socket();
var s2 = new Socket();
s1.other = s2;
s2.other = s1;

// Create a simulated network connection with paired proxy calls
var r1 = new Remote(s1, s1, 0);
var r2 = new Remote(s2, s2, 1);

// Sample permanent function with one-use callback
r1.register("add", function add(a, b, callback) {
  callback(a + b);
});

expect("done");
// test 1,000,000 times.
var left = 1000000;
for (var i = 0; i < 100; i++) {
  test();
}
function test() {
  r2.callRemote("add", 1, 2, function callback(result) {  
    assert.equal(result, 3);  
    if (--left > 0) test();
    else if (left === 0) fulfill("done");
  });
}
