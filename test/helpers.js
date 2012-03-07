// Mini test framework for async tests.
var assert = require('assert');
var expectations = {};
function expect(message) { expectations[message] = new Error("Missing expectation: " + message); }
function fulfill(message) { delete expectations[message]; }
process.addListener('exit', function () {
  Object.keys(expectations).forEach(function (message) {
    throw expectations[message];
  });
});

global.assert = assert;
global.expect = expect;
global.fulfill = fulfill;