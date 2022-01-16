/* eslint-disable no-unused-expressions */
"use strict"

const chai = require('chai'),
      Autoconf = require('../autoconf'),
      Aedes = require('aedes'),
      Path = require('path'),
      sinon = require('sinon'),
      DBDriver = require('../drivers/PathDB'),
      CIDriver = require('../drivers/TasmotaClientInfo'),
      helper = require('aedes/test/helper'),
      sinonChai = require('sinon-chai');

// eslint-disable-next-line no-unused-vars
const should = chai.should();
chai.use(sinonChai);

function connect(aedes) {
    let streams = helper.setup(aedes, false);

    streams.inStream.write({
        cmd: 'connect',
        protocolId: 'MQTT',
        version: 4,
        clean: false,
        clientId: 'simpleflow',
        keepalive: 0
    });
    return streams;
}

describe('autoconf', async function() {
    let aedes = null;
    let app = null;
    before(async function() {
        aedes = Aedes();
        app = new Autoconf(aedes, DBDriver, {dbpath: Path.join(__dirname, './db'), global: 'GLOBAL'}, CIDriver, null);
        await app.init();
    });
    it('should fail ValidateClient on no client', function() {
        app.ValidateClient().should.be.false;
    });
    it('should failt ValidateClient on a disconnected client', function() {
        const client = {id: 'simpleflow1', close: sinon.spy()};
        app.ValidateClient(client).should.be.false;
        client.close.should.have.been.calledOnce;
    });
    it('should pass ValidateClient on a connected client', function(done) {
        let streams = connect(aedes);
        const client = {id: 'simpleflow', close: sinon.spy()};
        streams.outStream.on('data', (packet) => {
            if (packet.cmd != 'connack')
                return;
            app.ValidateClient(client).should.be.true;
            client.close.should.not.have.been.called;
            done();
        });

    });
});