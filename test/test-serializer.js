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


var protocol = require('../protocol');

var s = protocol.serializer(0, function proxyCall(id, args) {
  // Simulate network transfer of args
  var remoteArgs = s2.deserialize(s.serialize(args));
  console.log("ProxyCall", id, args, remoteArgs);
  s2.proxyCall(id, remoteArgs);
});
var s2 = protocol.serializer(1, function proxyCall(id, args) {
  // Simulate network transfer of args
  var remoteArgs = s.deserialize(s2.serialize(args));
  console.log("ProxyCall2", id, args, remoteArgs);
  s.proxyCall(id, remoteArgs);
});


var values = [
  true, false, null, undefined, 0, -1, 1, 1.5, -1.5,
  [1,2,3],
  {name:"Tim"},
  Buffer([1,2,3,4,5,6]),
  // TODO: find a way to test functions.  These fail since functions are wrapped now and aren't the originals when deserialized.
  // function foo(){},
  // [console,console]
];

var cycle = {a:true}
cycle.b = cycle;
values.push(cycle);

values.forEach(function (input) {
  var serialized = s.serialize(input);
  console.log("compare", serialized);
  console.log(input);
  var out = s.deserialize(serialized);
  console.log(out);
  assert.equal(util.inspect(input, false, 10), util.inspect(out, false, 10));
});

expect("add called");
var add = s2.deserialize(s.serialize(function add(a, b, callback) {
  fulfill("add called");
  callback(a + b);
}));

console.log(add);
expect("callback called");
add(1, 2, function (result) {
  fulfill("callback called");
  assert.equal(result, 3);
});

// Test calling remote methods and preserving the "this" value
var bot = {
  greet: function (callback) {
    callback(this.name + ' says ' + this.message);
  },
  name: "DX500",
  message: "Hello World",
}
// Throw in a few cycles for good measure :)
bot.bot = bot;
bot.bot2 = [bot,bot, bot.greet, bot.greet];
// Methods need to be bound
bot.greet = bot.greet.bind(bot);

// Clone and test
var clone = s2.deserialize(s.serialize(bot));
expect("greet");
clone.greet(function (message) {
  fulfill("greet");
  assert.equal(message, "DX500 says Hello World");
});

