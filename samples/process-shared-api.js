// A very simple API
exports.ping = ping;
function ping(callback) {
    callback(null, process.pid + " pong");
}
