Smith is an RPC agent system for Node.JS used in architect and vfs.

## Class: Agent

Agent is the main class used in smith.  It represents an agent in your mesh
network.  It provides a set of service functions exposed as async functions.

### new Agent(api)

Create a new Agent instance that serves the functions listed in `api`.

### agent.api

The functions this agent serves to other agents.

### agent.connectionTimeout

If the connection hasn't happened by 10,000 ms, an ETIMEDOUT error will
happen.  To change the timeoutvalue, change `connectionTimeout` on either the
instance or the prototype.  Set to zero to disable.

### agent.connect(transport, callback)

Convenience wrapper to connect the local Agent instance to a remote Agent
instance. The `transport` argument is a Transport instance.  The callback will
be called with `(err, remote)` where `remote` is a Remote instance.

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

### new Remote(agent)

Create a new remote that will be paired with the local `agent`.

### remote.api

A object containing proxy functions for the api functions in the remote agent.  Calling these functions when the remote is offline will result in the last argument being called with a ENOTCONNECTED error (assuming it's a function).

### Event: `connect`

`function (remote) { }`

When the rpc handshake is complete, the remote will emit a connect event containing itself.

### Event: `disconnect`

`function () { }`

Emitted when the transport dies and the remote becomes offline

### remote.connect(transport)

Start the connection to a new remote using `transport`.  Emits `connect` when ready or `error` on failure.
