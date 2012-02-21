This module is the actual serialization format and protocol for the remoteagent system.

It is transport agnostic so that it can work on any duplex socket.  A modified version of msgpack is used as the serialization format (`undefined` and `Buffer` types are added)

Encoded on top of the msgpack format is functions and cycles.  This almost any basic value can be encoded and sent across the socket.

Since functions can be serialized, rpc using callbacks is natural.  Simply pass your callback as an argument and the other side will get a proxy function when it's deserialized.  When they call that proxt function, a message will be sent back and your callback will get called with the deserialized arguments (which can include yet another callback).  Since the callbacks are executed on their native side, closure variables and all other state is preserved.

If you just want to know how to use this protocol, skip down to `protocol.Remote()`.  The rest is explaining the actual protocol format in detail.

## Message Framing

Messages are framed in the stream using a 4 byte length header (UInt32BE) before every message.  This way the receiving end knows how much buffer to allocate and can efficiently scan and deframe the incoming message stream.  This also means that the msgpack parser can assume it has the entire message in memory once the message emit from the deframer.  To manually frame and deframe messages, use the `frameMessages` and `deFramer` functions in the module.

### protocol.frameMessages(Array<Buffer> buffers) -> Buffer framed

This function takes in an array of Buffer instances and creates a new composite buffer of all the smaller buffers with the 4 byte header added before each one.

```js
var message = new Buffer("Hello");
// message -> <Buffer 48 65 6c 6c 6f>
var framed = protocol.frameMessages([message]);
// framed -> <Buffer 00 00 00 05 48 65 6c 6c 6f>
```

### protocol.deFramer(Function onMessage) -> Function parse

This functions creates a deFramer state-machine in a closure and returns the parse function of the state machine.  The passed in `onMessage` callback is called every time a message is de-framed and fully received.  Normally the parse function is given as the `data` event handler of an input stream.

```js
var parse = protocol.deFramer(console.log);
parse(new Buffer([0x00, 0x00, 0x00, 0x05, 0x48]));
// -> undefined
parse(new Buffer([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
// <Buffer 48 48 65 6c 6c>
// -> undefined
```

## Message Serializing

The base of the message format is msgpack-js serialization.  This means that any Array, Object, Number, String, Buffer, Boolean, null, or undefined value can be serialized and come out on the other side as it's same type (strings stay strings, buffers stay buffers).  The actual format is very compact and has zero encoding overhead for binary buffers other than a fixed length header (3 or 5 bytes).  See the msgpack-js project for full details.

### msgpack.encode(value) -> Buffer encoded

Encode any serializable value into the binary representation as a Buffer instance.

```js
msgpack.encode(true)
// -> <Buffer c3>
msgpack.encode(null)
// -> <Buffer c0>
msgpack.encode(undefined)
// -> <Buffer c4>
msgpack.encode(4)
// -> <Buffer 04>
msgpack.encode("Hello")
// -> <Buffer a5 48 65 6c 6c 6f>
msgpack.encode(new Buffer("Hello"))
// -> <Buffer d8 00 05 48 65 6c 6c 6f>
msgpack.encode([1,2,3])
// -> <Buffer 93 01 02 03>
```

As you can see, this is a very compact format.  It's pretty fast too.

### msgpack.decode(Buffer encoded) -> value

This is simply the inverse of `msgpack.encode`.  Give it a msgpack encoded buffer and it will return the original value.

```js
var encoded = new Buffer([0x93, 0x01, 0x02, 0x03]);
// encoded -> <Buffer 93 01 02 03>
var message = msgpack.decode(encoded);
// message -> [1, 2, 3]
```

## Message Encoding

On top of serializing primitive values and basic data structures, remoteagent-protocol can encode proxy functions and cycles in an object.  This is encoded using objects with magic keys.

### Function Encoding

Functions are encoded with the `λ` key.  This is chosen because it's short (2 bytes), unique (I'll bet it's not a key in your node app), and descriptive (it's the mathematical symbol for functions).  The value of this object is the unique function index in the local function repository.  Function keys are 16 bit random numbers and are name-spaced to the side of the connection that generated them.  The server gets even numbers and the client gets odd numbers. An example encoded function can look like `{λ: 0x6d78}` where `functions[0x6d78]` in the server is the real function and that same index in the client is the proxy function.

### Cycle Encoding

Sometimes objects have cycles in them.  It would be nice if these could be encoded, serialized, and send to the other side intact without blowing up the rpc system.  Cycles are encoded with the `*` key.  This is only one byte, pretty unique and represents a reference or pointer.  The value is the path to the actual value.  In this way it works like a file-system symlink.  Currently the path is absolute starting at the root of the message.  For example.  Given the following cyclic object:

```js
var entry = {
  name: "Bob",
  boss: { name: "Steve" }
};
entry.self = entry;
entry.manager = entry.boss;
```

The following encoded object is generated by the internal `freeze` function in `protocol.serializer()`.

```js
{
  name: 'Bob',
  boss: { name: 'Steve' },
  self: { '*': [] },
  manager: { '*': [ 'boss' ] }
}
```

See that the path `[]` point to the object itself, and `['boss']` points to the boss property in the root.

### protocol.serializer(Number keyOffset, Function proxyCall) -> Object s

Since things start to get tightly integrated at this level, a managed object called the serializer is used to encode/serialize and deserialize/decode messages.  It includes an internal database of functions and takes in a callback for when proxy functions need to call out to the other side.  This object has no network ability and is meant to be embeded in `Remote` instances.

The first argument, `keyOffset` should be `0` for the server-side and `1` for the client-side.

The `proxyCall` argument gets called every time a proxy function created by the internal decoder gets called.  This needs to get routed to the other size of the socket externally for the proxy function to operate properly. (The Remote class does do this for you when it embeds a serializer)

See the `test/test-serializer.js` file for an example usage.

#### serializer.serialize(value) -> Buffer serialized

Encodes and serializes a value returning the buffer.

#### serializer.deserialize(Buffer serialized) -> value

Deserialized and decodes a buffer, creating proxy functions if needed.

#### serializer.proxyCall(Number λ, Array args)

Hook to call into real functions from proxy calls on the other side.

#### serializer.release(Number λ)

Since it's impossible to know when proxy functions on the remote machine get GCed, there has to be an explicit mechanism to free references to callbacks.  This function removes a function from the function repository.

#### serializer.getFunction(Number λ)

Pulls a function from the internal function repository by λ id.  If the id is new and matches the pattern from the other size (even vs odd) then a proxy function is created and returned.

#### serializer.storeFunction(Function fn)

Stores a function in the internal repository. It tags the function with a λ id property so that in the future it won't be stored duplicate.

## protocol.Remote(Stream input, Stream output, Number keyOffset) constructor

The `Remote` constructor ties all the other components together into a single smart object.  It embeds an instance of the serializer for uses the framer and deframer to route messages to and from it's `input` and `output` sockets.  These sockets can be the same object if it's duplex, for example if it's a node tcp connection.  In other cases like in stdout and stdin of a child process, they are two streams.

The keyOffset is passed directly to the embedded serializer and tells this instance if it's a client or server and it can route messages accordingly.

### Remote.prototype.wrap(String name)

A private method used to bind callbacks to an instance and route errors.

### Remote.prototype.onFrame(Buffer frame)

A private callback called when the deFramer outputs a message.  This is the function that deserializes messages and routes them to the right place.

If there is an `fn` key, then it's a proxy function call.  Someone called a remote proxy function and we need to route the args to the local real function via `serializer.proxyCall()`.

If there is an `rm` key, then it's a remove message for freeing function references.  This means that the other side will never call said function again and we don't need to remember it anymore.

All other keys are emitted as named events.  For example, if there is an `init` key then an `init` event will be emitted on the `remote` instance.

### Remote.prototype.onCall(λ, args)

A private callback for when a local proxy function is called.  This function sends a `fn` request to the other side to make the real call.

### Remote.prototype.sendObject(object)

A private helper method for serializing and sending messages to the other size.

### Remote.prototype.emitRemove(name, value)

A public method for emitting a named event on the other side.

## protocol.startClient(Stream input, Stream output, functions) -> Remote

For cases where the remoteagent server runs the client in a subprocess from the server and so the server has to initiate the connection to the client. 

This helper function is called from the child process where `input` and `output` are the child's `process.stdin` and `process.stdout` streams.  It simply creates a Remote client instance and emits an `init` remote event with the passed in `functions` serialized so the server knows that functions it can call on the client.

## protocol.connectToClient(Stream input, Stream output, Function callback(Error err, Remote remote, functions))

For cases where the remoteagent server runs the client in a subprocess from the server and so the server has to initiate the connection to the client. 

This function is called as soon as the server has a communication channel with the remote client.  It adds a listener for the `init` event that the client emits when it's ready to be queried.  Once this event it caught, the passed in `callback` gets called with `(err, remote, functions)`.  The server can now start making RPC queries using the proxy functions in the deserialized `functions` object.




