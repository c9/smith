var net = require('net');
var Agent = require('smith').Agent;
var Transport = require('smith').Transport;
var Remote = require('smith').Remote;

// Create our client remote.
var remote = new Remote();

var backoff = 1000;
var add;

// Query the API to test the connection
function query() {
  var a = Math.floor(Math.random() * 10) + 1;
  var b = Math.floor(Math.random() * 10) + 1;
  console.log("%s + %s = ...", a, b);
  add(a, b, function (err, result) {
    if (err) console.error(err.stack);
    else console.log("%s + %s = %s", a, b, result);
  });
}

// On the first connect, store a reference to the add function and start
// calling it on an interval
remote.once("connect", function (api) {
  add = api.add;
  console.log("Running query() every 3000 ms");
  setInterval(query, 3000);
  query();
});

// On every connect, log the connection and reset the backoff time.
remote.on("connect", function () {
  console.log("Connected!");
  if (backoff > 1000) {
    console.log(" Resetting backoff to 1000ms.");
    backoff = 1000;
  }
});

// Set up auto-reconnect and do initial connection
remote.on("disconnect", onError);
connect();

function connect() {
  var socket = net.connect(1337, function () {
    remote.connect(new Transport(socket));
  });
  socket.on("error", onError);
}

function onError(err) {
  if (err) console.error(err.stack);
  console.log("Reconnecting in %s ms", backoff);
  setTimeout(connect, backoff);
  backoff *= 2;
}
