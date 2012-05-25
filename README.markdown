Smith is an RPC agent system for Node.JS used in architect and vfs.

## Usage

Smith can be used in any situation where you have a duplex node stream.  This can be over tcp, stdio, a pipe, or anything that sends bytes back and forth.

### TCP client-server example

In this example, I have a TCP server that serves an add function to any agent clients who want to consume the service.

For the server, we create a small agent and serve it on a listening tcp port.

```js
var net = require('net');
var Agent = require('smith').Agent;
var Transport = require('smith').Transport;

// Create the agent that serves the `add` function.
var agent = new Agent({
  add: function (a, b, callback) {
    callback(null, a + b);
  }
});

// Start a TCP server
net.createServer(function (socket) {
  // Create a transport that wraps the duplex tcp socket
  var transport = new Transport(socket);
  // Connect to the remote agent
  agent.connect(transport, function (err, remote) {
    if (err) throw err;
    console.log("A new client connected");
    remote.on("disconnect", function (err) {
      console.error("The client disconnected")
    });
  });
}).listen(1337, function () {
  console.log("Agent server listening on port 1337");
});
```

Then to consume this TCP service, we write a client agent.

```js
var net = require('net');
var Agent = require('smith').Agent;
var Transport = require('smith').Transport;

// Create a dumb agent
var agent = new Agent();

// Connect to the TCP server
var socket = net.connect(1337, function () {
  // Wrap the socket in a transport.
  var transport = new Transport(socket);
  agent.connect(transport, function (err, remote) {
    if (err) throw err;

    // Call the `add` API
    remote.api.add(1, 3, function (err, result) {
      if (err) throw err;
      console.log("1 + 3 = " + result);
    });

    // Listen for disconnect and possibly reconnect.
    remote.on("disconnect", function (err) {
      var socket = net.connect(1337, function () {
        remote.connect(new Transport(socket))

      // We could create a new connection and reconnect with `remote.connect(transport)`
    });
  });

});

## Class: Agent

Agent is the main class used in smith.  It represents an agent in your mesh
network.  It provides a set of service functions exposed as async functions.

### new Agent(api)

Create a new Agent instance that serves the functions listed in `api`.

### agent.api

The functions this agent serves to other agents.

### agent.connect(transport, callback)

Convenience wrapper to connect the local Agent instance to a remote Agent
instance. The `transport` argument is a Transport instance.  The callback will
be called with `(err, remote, api)` where `remote` is a Remote instance.

## Class: Transport

Transport is a wrapper around a duplex socket to allow two Agent instances to
talk to eachother.  A transport will shut down itself if either end of the
socket ends and emit an `error` event.

### new Transport(input, [output])

Pass in either a duplex Stream instance or two streams (one readable, one
writable).  This transport object can then be used to connect to another
Agent.

### Event: 'message'

`function (message) { }`

Emitted when a message arrives from the remote end of the transport.ts

### transport.send(message)

Send a message to the other end of the transport.  Message is JSON
serializable object with the addition of being able to serialize node Buffer
instances and `undefined` values.

## Class: Remote

Remote represents a remote agent.

### new Remote([agent])

Create a new remote that will be paired with the local `agent`.

### remote.api

A object containing proxy functions for the api functions in the remote agent.  Calling these functions when the remote is offline will result in the last argument being called with a ENOTCONNECTED error (assuming it's a function).

### remote.connectionTimeout

If the connection hasn't happened by 10,000 ms, an ETIMEDOUT error will
happen.  To change the timeoutvalue, change `connectionTimeout` on either the
instance or the prototype.  Set to zero to disable.

### Event: 'connect'

`function (remote) { }`

When the rpc handshake is complete, the remote will emit a connect event containing itself.

### Event: 'disconnect'

`function () { }`

Emitted when the transport dies and the remote becomes offline

### remote.connect(transport, [callback]))

Start the connection to a new remote using `transport`.  Emits `connect` when
ready or `error` on failure.  Optionally use the callback to get `(err,
remote, api)` results.
