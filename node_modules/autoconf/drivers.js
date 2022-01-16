"no strict"

const EventEmitter = require('events'),
      DEBUG = require('debug');

class DBDriver {
    constructor(opts) {
        if (opts && opts.debug)
            this._debug = opts.debug;
        else 
            this._debug = DEBUG(this.constructor.name);
    }

    get debug() {
        return this._debug;
    }
    
    set debug(_debug) {
        this._debug = _debug;
    }

    async seek() {
        throw new Error("Attempt to use parent class DBDriver at runtime");
    }
    async read() {
        throw new Error("Attempt to use parent class DBDriver at runtime");
    }
}

class ClientInfo extends EventEmitter {
  constructor(opts) {
      super(opts);
      this.info = {};
      if (opts && opts.debug)
          this._debug = opts.debug;
      else 
          this._debug = DEBUG(this.constructor.name);
      let timeout = (opts && opts.timeout) ? opts.timeout : 5000;
      this.on('ready', function() {
          clearTimeout(this.timeout);
      }.bind(this));
      this.timeout = setTimeout(function() {
          this.emit('timeout');
      }.bind(this), timeout);
  }

  get debug() {
      return this._debug;
  }

  set debug(_debug) {
      this._debug = _debug;
  }

  async parse() {
      throw new Error("Attempt to use parent class ClientInfo at runtime");
  }

  async query() {
      throw new Error("Attempt to use parent class ClientInfo at runtime");
  }
}

module.exports = {
    DBDriver: DBDriver,
    ClientInfo: ClientInfo
};