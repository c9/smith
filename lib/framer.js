/*
This file contains code for framing and deframing of messages on a binary
stream using 32bit length headers.

This layer isn't needed when using websockets or some other high-level
transport that has framing built-in.
*/

// A simple state machine that consumes raw bytes and emits message events.
// Returns a parser function that consumes buffers.  It emits message buffers
// via onMessage callback passed in.
exports.deFramer = function deFramer(onMessage) {
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
};


// Given an array of message buffers, this returns a single buffer that contains
// all the messages framed.
exports.frameMessages = function frameMessages(messages) {
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
