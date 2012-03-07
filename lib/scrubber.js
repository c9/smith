/*
This file handles freezing of live objects and later livening them.  This
means that functions are replaces with placeholders and cycles in the object
are turned into symlinks.
*/

var getType = require('./helpers').getType;
var forEach = require('./helpers').forEach;
var map = require('./helpers').map;
var get = require('./helpers').get;

// TODO: escape λ -> @λ * -> @* and @ -> @@ so that *any* key can be used in
// objects.


// Convert a js object into a serializable object when functions are
// encountered, the storeFunction callback is called for each one.
// storeFunction takes in a function and returns a key.
exports.freeze = freeze;
function freeze(value, storeFunction) {
    var cycles = [];
    var seen = [];
    var paths = [];
    function find(value, path) {
        // find the type of the value
        var type = getType(value);
        // pass primitives through as-is
        if (type !== "function" && type !== "object" && type !== "array") {
            return value;
        }

        // Look for duplicates
        var index = seen.indexOf(value);
        if (index >= 0) {
            return { "*": paths[index] };
        }
        // If not seen, put it in the registry
        index = seen.length;
        seen[index] = value;
        paths[index] = path;

        // Look for functions
        if (type === "function") {
            // λ is "\u03bb" and is a valid JS identifier.
            return { λ: storeFunction(value) };
        }

        // Recurse on objects and arrays
        return map(value, function (sub, key) {
            return find(sub, path.concat([key]));
        });
    }
    return find(value, []);
}

// Converts flat objects into live objects.  Cycles are re-connected and
// functions are inserted. The getFunction callback is called whenever a
// frozen function is encountered. It expects an id and returns a function.
exports.liven = liven;
function liven(message, getFunction) {
    function find(value, parent, key) {
        // find the type of the value
        var type = getType(value);

        // pass primitives through as-is
        if (type !== "function" && type !== "object" && type !== "array") {
            return parent[key] = value;
        }

        // Load functions
        if (value.hasOwnProperty("λ")) {
            return parent[key] = getFunction(value.λ);
        }

        // Load backreferences
        if (value.hasOwnProperty("*")) {
            return parent[key] = get(obj.root, value["*"]);
        }

        // Recurse on objects and arrays
        forEach(value, function (sub, key) {
            find(sub, value, key);
        });
        return obj;
    }
    var obj = {root:message};
    find(message, obj, "root");
    return obj.root;
}