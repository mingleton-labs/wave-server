const rc = require("rc");
const manifest = require("./package");

var defaults = {
    mqtt: {
        port: 1883,
        tls_keyfile: null,
        tls_certfile: null,
        tls_passphrase: null
    },
    statPrefix: 'stat',
    cmndPrefix: 'cmnd',
    dbDriver: {
        name: './drivers/PathDB',
        opts: {
            dbpath: '../db',
            global: 'GLOBAL'
        }
    },
    clientInfoDriver: {
        name: './drivers/TasmotaClientInfo',
        opts: {}
    }
};

module.exports = rc(manifest.name, defaults);