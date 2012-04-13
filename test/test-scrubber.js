require('./helpers');
var freeze = require('..').freeze;
var liven = require('..').liven;
var getType = require('..').getType;

function foo() {}
var cycle = {a:true,b:false, d:[1,2,3]};
cycle.e = cycle.d;
cycle.cycle = cycle;
var pairs = [
  [{$:1,$$:2,$$$:3,$$$$:4}, {$$:1,$$$:2,$$$$:3,$$$$$:4}],
  [process.stdin, {$:{S:1,w:false}}],
  [process.stdout, {$:{S:2,r:false,w:true}}],
  [true, true],
  [false, false],
  [null, null],
  [undefined, undefined],
  [42, 42],
  [foo, { $: 3 }],
  [[1,2,3,foo],[1,2,3,{$:4}]],
  ["Hello", "Hello"],
  [new Buffer([0,1,2,3,4,5,6]), new Buffer([0,1,2,3,4,5,6])],
  [{fn:foo}, {fn:{$:5}}],
  [cycle, {a:true,b:false,d:[1,2,3],e:{$:["d"]},cycle:{$:[]}}]
];

var specials = {};
var nextKey = 0;
function onSpecial(value) {
  var key = ++nextKey;
  specials[key] = value;
  return key;
}
function onSpecialID(obj) {
  if (obj.S) return specials[obj.S];
  if (obj.F) return specials[obj.F];
}

pairs.forEach(function (pair) {
  var live = pair[0];
  var dead = pair[1];
  console.log("testing", pair);
  var frozen = freeze(live, onSpecial);
  if (!deepEqual(frozen, dead)) {
    console.error({actual:frozen,expected:dead});
    throw new Error("freeze fail");
  }
  var relive = liven(frozen, onSpecialID);
  if (!deepEqual(relive, live)) {
    console.error({actual:relive,expected:live});
    throw new Error("liven fail");
  }
});

function deepEqual(a, b) {
  var seen = [];
  function find(a, b) {
    if (a === b) return true;
    var type = getType(a);
    if (getType(b) !== type) return false;
    if (type === "buffer") return a.toString() === b.toString();
    if (type !== "object" && type !== "array") return a === b;

    // Ignore cycles for now
    // TODO: this isn't enough
    if (seen.indexOf(a) >= 0) {
      return true;
    }
    seen.push(a);

    if (type === "array") {
      if (a.length !== b.length) return false;
      for (var i = 0, l = a.length; i < l; i++) {
        if (!find(a[i], b[i])) return false;
      }
      return true;
    }
    var keys = Object.getOwnPropertyNames(a);
    if (!deepEqual(keys, Object.getOwnPropertyNames(b))) return false;
    for (var i = 0, l = keys.length; i < l; i++) {
      var key = keys[i];
      if (!find(a[key],b[key])) return false;
    }
    return true;
  }
  return find(a, b);
}
