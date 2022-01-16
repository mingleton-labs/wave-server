"use strict"

/* TasmotaClientInfo identifies the MAC address (and also hostname) of a tasmota device */

const {ClientInfo} = require('../drivers');

class TasmotaClientInfo extends ClientInfo {
  constructor(opts) {
    super(opts);
  }

  async parse(topic, payload) {
    switch (topic.toUpperCase()) {
      case "STATUS5":
        if (!(payload && payload.StatusNET && payload.StatusNET.Hostname && payload.StatusNET.Mac))
            break;
        this._debug(`Got network information`);
        this.info.Hostname = payload.StatusNET.Hostname;
        this.info.Mac = payload.StatusNET.Mac.replace(/:/g,'');
        this.emit('ready', this.info);
        break;
    }
  }

  async query() {
    return [{topic:'STATUS', payload: Buffer.from('5')}];
  }

  get DBKey() {return 'Mac';}
}

module.exports = TasmotaClientInfo;