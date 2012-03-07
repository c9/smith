var frameMessages = require('../lib/framer').frameMessages;
var deFramer = require('../lib/framer').deFramer;
var Assert = require('assert');

// Test the de-framer by creating a sample message stream and simulating packet
// sizes from one-byte-per-packet to all-messages-in-one-packet.
var input = [
  {hello: "world"},
  {Goodbye: "Sanity"},
  [1,2,3,4,5,6,7,6,5,4,3,2,1]
];
var message = frameMessages(input.map(function (item) {
  return new Buffer(JSON.stringify(item)); }));
var length = message.length;
for (var step = 1; step < length; step++) {
  var output = [];
  var parser = deFramer(function (message) {
    output.push(JSON.parse(message.toString()));
  });
  for (var offset = 0; offset < length; offset += step) {
    var end = offset + step
    if (end > length) { end = length; }
    parser(message.slice(offset, end))
  }
  Assert.deepEqual(input, output);
}

