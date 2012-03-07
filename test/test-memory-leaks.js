require('./helpers');
var Agent = require('remoteagent-protocol').Agent;

var a = new Agent({
  add: function (a, b, callback) {
    callback(a + b);
  }
});
var b = new Agent();
var samples = [];

var pair = require('../lib/fake-transports')("A", "B");
a.attach(pair.A, function (AB) {
  console.log("A is connected to B!");
});
b.attach(pair.B, function (BA) {
  console.log("B is connected to A!");
  var left = 300000;
  for (var i = 0; i < 100; i++) {
    test();
  }

  function test() {
    BA.add(1, 2, function (result) {
      assert.equal(result, 3);
      if (left % 10000 === 0) samples.push(process.memoryUsage());
      if (--left > 0) test();
      else if (left === 0) done();
    });
  }
});


expect("done");
function done() {
  // Trim the first few samples to not include startup time
  samples = samples.slice(4);
  console.log(samples);
  getSlope("rss", 0x100000);
  fulfill("done");
}

function getSlope(key, limit) {
  var sum = 0;
  var max = 0;
  var min = Infinity;
  samples.forEach(function (sample) {
    var value = sample[key];
    sum += value;
    if (value > max) max = value;
    if (value < min) min = value;
  });
  var mean = sum / samples.length;
  var deviation = 0;
  samples.forEach(function (sample) {
    var diff = mean - sample[key];
    deviation += diff * diff;
  });
  deviation = Math.sqrt(deviation / (samples.length - 1));
  console.log("%s: min %s, mean %s, max %s, standard deviation %s", key, min, mean, max, deviation);
  if (deviation > limit) {
    throw new Error("Deviation for " + key + " over " + limit + ", probably a memory leak");
  }
}