require('./helpers');
var deFramer = require('architect-socket-transport').deFramer;

// Given an array of message buffers, this returns a single buffer that contains
// all the messages framed.
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
};

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
    var chunk = message.slice(offset, end);
    console.log(chunk);
    parser(chunk);
  }
  assert.deepEqual(input, output);
}

