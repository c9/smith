var EventEmitter = require('events').EventEmitter;
var msgpack = require('msgpack-js');

// Here input is a readable binary stream and output is a writable binary
// stream.
module.exports = socketTransport;
function socketTransport(input, output) {
    // If there is just one stream, assume it's duplex.
    if (arguments.length === 1) {
        output = input;
    }
    var transport = new EventEmitter();

    // Parse tcp chunks into object messages
    var parseFrames = deFramer(function onFrame(frame) {
        var message = msgpack.decode(frame);
        // Emit on next tick so we don't get the event handler's errors and
        // also so it appears async.
        process.nextTick(function () {
            transport.emit("message", message);
        });
    });
    input.on('data', function onData(chunk) {
        try {
            // This will throw on malformed chunks, we need to catch this
            // error since we're at the root of a new event source.
            parseFrames(chunk);
        }
        catch (err) {
            transport.emit("error", err);
        }
    });

    // Encode messages and send as framed chunks
    transport.send = function send(message) {
        // Serialize the messsage.
        var frame = msgpack.encode(message);

        // Send a 4 byte length header before the frame.
        var header = new Buffer(4);
        header.writeUInt32BE(frame.length, 0);
        output.write(header);

        // Send the serialized message.
        output.write(frame);
    }
    return transport;
}

// A simple state machine that consumes raw bytes and emits message events.
// Returns a parser function that consumes buffers.  It emits message buffers
// via onMessage callback passed in.
socketTransport.deFramer = deFramer; // Export for unit testing.
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
