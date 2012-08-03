var creationix = require('creationix');
var stack = require('stack');
var http = require('http');
var WebSocketServer = require('ws').Server

var Agent = require('smith').Agent;
var WebSocketTransport = require('smith').WebSocketTransport


var api = {
  add: function (a, b, callback) {
    callback(null, a + b);
  }
};

var server = http.createServer(stack(
  creationix.log(),
  creationix.static("/", __dirname + "/public")
));

var wss = new WebSocketServer({server: server});
wss.on("connection", function (websocket) {
  var agent = new Agent(api);
  agent.connect(new WebSocketTransport(websocket, true), function (err, browserAgent) {
    if (err) throw err;
    console.log({browserAgent:browserAgent});
  });
});

server.listen(8080, function () {
  console.log("Point browser to http://localhost:8080/index.html to run test.");
});
