"use strict"

const aedes = require('aedes'),
      tls = require('tls'), net = require('net'),
      fs = require('fs'),
      manifest = require('./package'),
      DEBUG = require('debug'),
      config = require('./config'),
      Autoconf = require('./autoconf');

let debug = DEBUG(manifest.name);

function createServer(app) {
  let opts = {};
  opts.module = net;
  opts.modname = " ";

  if (config.mqtt.tls_keyfile && config.mqtt.tls_certfile) {
    /* eslint-disable no-sync */
    opts.key = fs.readFileSync(config.mqtt.tls_keyfile);
    opts.cert = fs.readFileSync(config.mqtt.tls_certfile);
    /* eslint-enable no-sync */
    opts.module = tls;
    opts.modname = "secure ";
  }

  if (config.mqtt.tls_passphrase)
      opts.passphrase = config.mqtt.tls_passphrase;
  
  let server = opts.module.createServer(opts, app.aedes.handle);
  
  server.on('connection', (socket) => {
    debug(`New connection from ${socket.remoteAddress}:${socket.remotePort}`);
  });
  
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      debug('Address in use, retrying...');
      setTimeout(() => {
        server.close();
        server.listen(config.mqtt.port);
      }, 1000);
    }
  });
  
  server.on('listening', () => {
      debug(`Listening on ${opts.modname}${server.address().address}:${server.address().port}`);
  });

  return server;
}

async function main() {        
    const DBDriver = require(config.dbDriver.name);
    const DBOpts = config.dbDriver.opts ? config.dbDriver.opts : {};
    const ClientInfo = require(config.clientInfoDriver.name);
    const CIOpts = config.clientInfoDriver.opts ? config.clientInfoDriver.opts : {}
    const app = new Autoconf(aedes(), DBDriver, DBOpts, ClientInfo, CIOpts);
    await app.init();
    const server = createServer(app);
    server.listen(config.mqtt.port);
}

main();