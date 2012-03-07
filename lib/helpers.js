// This file is just some helpful js functions used by the protocol.

// forEach that works on both arrays and objects
exports.forEach = function forEach(value, callback, thisp) {
    if (typeof value.forEach === "function") {
        return value.forEach.call(value, callback, thisp);
    }
    var keys = Object.keys(value);
    for (var i = 0, l = keys.length; i < l; i++) {
        var key = keys[i];
        callback.call(thisp, value[key], key, value);
    }
};

// map that works on both arrays and objects
exports.map = function map(value, callback, thisp) {
    if (typeof value.map === "function") {
        return value.map.call(value, callback, thisp);
    }
    var obj = {};
    var keys = Object.keys(value);
    for (var i = 0, l = keys.length; i < l; i++) {
        var key = keys[i];
        obj[key] = callback.call(thisp, value[key], key, value);
    }
    return obj;
};

// Traverse an object to get a value at a path
exports.get = function get(root, path) {
    var target = root;
    for (var i = 0, l = path.length; i < l; i++) {
        target = target[path[i]];
    }
    return target;
};

// Typeof is broken in javascript, add support for null and buffer types
exports.getType = function getType(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (Buffer.isBuffer(value)) {
        return "buffer";
    }
    return typeof value;
};