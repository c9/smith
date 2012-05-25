var net = require('net');
var Agent = require('smith').Agent;

// Create the agent that serves the `add` function.
var agent = new Agent({
  add: function (a, b, callback) {
    callback(null, a + b);
  }
});

// Start a TCP server
net.createServer(function (socket) {
  // Connect to the remote agent
  agent.connect(socket, function (err, api, remote) {
    if (err) return console.error(err.stack);
    console.log("A new client connected");
    remote.on("disconnect", function (err) {
      console.error("The client disconnected")
    });
  });

}).listen(1337, function () {
  console.log("Agent server listening on port 1337");
});
