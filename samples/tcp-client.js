var net = require('net');
var Remote = require('smith').Remote;

// Create our client
var remote = new Remote()

var socket = net.connect(1337, function () {
  remote.connect(socket, function (err, api) {
    api.add(4, 5, function (err, result) {
      if (err) throw err;
      console.log("4 + 5 = %s", result);
      remote.disconnect();
    });
  });
});
