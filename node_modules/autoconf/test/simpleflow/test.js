/* eslint-disable max-lines-per-function */

"use strict"

const chai = require('chai'),
      sinonChai = require('sinon-chai'),
      Aedes = require('aedes'),
      Path = require('path'),
      DBDriver = require('../../drivers/PathDB'),
      CIDriver = require('../../drivers/TasmotaClientInfo'),
      helper = require('aedes/test/helper'),
      Autoconf = require('../../autoconf');

// eslint-disable-next-line no-unused-vars
const should = chai.should();
chai.use(sinonChai);

describe('Simple Flow', function() {
    const statusPayload = Buffer.from(JSON.stringify({StatusNET: {
        Hostname: 'testclient',
        IPAddress: '10.0.23.231',
        Gateway: '10.0.23.1',
        Subnetmask: '255.255.255.0',
        DNSServer: '1.1.1.1',
        Mac: '11:22:33:44:55:66',
        Webserver: 1,
        WifiConfig: 1
    }}));
    let aedes = null;
    let app = null;
    let messageId = 0;
    before(async function() {
        aedes = Aedes();
        app = new Autoconf(aedes, DBDriver, {dbpath: Path.join(__dirname, '../db'), global: 'GLOBAL'}, CIDriver, null);
        await app.init();
    });
    after(async function() {
        aedes.close();
    });
    it('should return the correct config', function(done) {
        let gotQuery = false;
        let streams = helper.setup(aedes, false);

        streams.inStream.write({
            cmd: 'connect',
            protocolId: 'MQTT',
            version: 4,
            clean: false,
            clientId: 'simpleflow',
            keepalive: 0
        });
        streams.outStream.on('data', (packet) => {
            if (packet.cmd != 'publish')
                return;
            if (packet.topic == 'cmnd/simpleflow_fb/STATUS') {
                gotQuery = true;
                packet.payload.toString().should.equal('5');
                streams.inStream.write({cmd: 'publish', messageId: ++messageId, topic: 'stat/simpleflow_fb/STATUS5', payload: statusPayload});
            } else if (packet.topic == 'cmnd/simpleflow_fb/backlog') {
                if (!gotQuery) 
                    return done('Got config before got query');
                const rv = packet.payload.toString().split('; ');
                rv.should.deep.equal(['global true', 'foo bar', 'int 123']);
                done();
            } else {
                done(`Got unexpected topic ${packet.topic} with payload ${packet.payload}`);
            }
        });
        streams.inStream.write({
            cmd: 'subscribe',
            messageId: ++messageId,
            subscriptions: [{
              topic: 'cmnd/simpleflow_fb/#',
              qos: 0
            }]
        });
    });
});