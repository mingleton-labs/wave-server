"no strict"

const util = require('util'),
      DEBUG = require('debug'),
      config = require('./config');

class Autoconf {
  constructor(aedes, DB, DBOpts, CI, CIOpts) {
    this._aedes = aedes;
    this._DBOpts = DBOpts;
    this._CIOpts = CIOpts;
    this._DB = new DB(this._DBOpts);
    this._CI = CI;

    // TODO convert clients to LRU 
    this.clients = {};

    this.debug = DEBUG(this.constructor.name);
  }

  get aedes() {return this._aedes;}
  get DB() {return this._DB;}
  get CI() {return this._CI;}

  reduceTopic(topic, clientId) {
    let base = `${config.statPrefix}/${clientId}_fb/`;
    let subj = topic.substring(base.length, topic.length);
    if (topic == `${base}${subj}`)
      return subj;
    return topic;
  }
  
  ValidateClient(client) {
    if (!(client && client.id))
      return false;
    if (this.clients[client.id])
      return true;
    this.debug(`Invalid client ${client.id}`);
    client.close();
    return false;
  }
  
  async QueryClient(client) {
    const debug = DEBUG(client.id);
    
    if (!this.ValidateClient(client))
      return;
    
    let sub = `${config.statPrefix}/${client.id}_fb/`;
    let clientInfo = this.clients[client.id].clientInfo;
    clientInfo.debug = debug
    
    clientInfo.on('ready', async () => {
      await this.aedes.unsubscribe(`${sub}#`, onSubscribe);
      setImmediate(this.LookupClient.bind(this), client);   
    });
    clientInfo.on('timeout', async () => {
      debug('Client timed out waiting for query.  Disconnecting.');
      setImmediate(this.CleanupClient.bind(this));
    })
  
    const onSubscribe = async (packet, cb) => {
      // Examine packet
      if (!this.ValidateClient(client))
        return;
      let topic = this.reduceTopic(packet.topic, client.id);
      let payload = {};
      try {
        payload = JSON.parse(packet.payload.toString());
      } catch (e) {}
      DEBUG('STATUS')(`${client.id} ${packet.topic} ${packet.payload.toString()}`);  
      
      clientInfo.parse(topic, payload);
  
      cb();
    };
    
    debug(`Querying client`);
    await this.aedes.subscribe(`${sub}#`, onSubscribe);
    for (let query of await clientInfo.query()) {
      await this.aedes.publish({
        cmd: 'publish',
        retain: false,
        qos: 0,
        dup: false,
        topic: `${config.cmndPrefix}/${client.id}_fb/${query.topic}`,
        payload: query.payload
      });
    }
  }
  
  async LookupClient(client) {
    const debug = DEBUG(client.id);
    if (!this.ValidateClient(client))
      return;
    const clientInfo = this.clients[client.id].clientInfo;
    require('eyes').inspect(clientInfo.info);
    
    function ObjToArr(obj) {
      let arr = [];
      Object.keys(obj).forEach(key => {
        arr.push([key, obj[key]])
      });
      return arr;
    }
    
    this.clients[client.id].clientConfig = [];
    debug("Looking up client information");
    if (await this.DB.seek(clientInfo.info[clientInfo.DBKey])) {
      debug("Found client information");
      this.clients[client.id].clientConfig = ObjToArr(await this.DB.read(clientInfo.info[clientInfo.DBKey]));
      setImmediate(this.ConfigureClient.bind(this), client);
    } else {
      debug("Couldn't find matching client information.  Disconnecting");
      setImmediate(this.CleanupClient.bind(this), client);
    }
  }
  
  async ConfigureClient(client) {
    const debug = DEBUG(client.id);
    if (!this.ValidateClient(client))
      return;
    const clientConfig = this.clients[client.id].clientConfig;
    let backlog = clientConfig.map(entry => {
        return `${entry[0]} ${String(entry[1])}`;
    }).join("; ")
    debug(backlog);
    await this.aedes.publish({
      cmd: 'publish',
      retain: false,
      qos: 0,
      dup: false,
      topic: `${config.cmndPrefix}/${client.id}_fb/backlog`,
      payload: Buffer.from(backlog)    
    });
    setImmediate(this.CleanupClient.bind(this), client);
  }
  
  async CleanupClient(client) {
    if (!this.ValidateClient(client))
      return;
    setTimeout(function() {
      delete this.clients[client.id];
      client.close();
    }.bind(this), 5000);
  }

  /* eslint-disable max-lines-per-function */
  async init() {
    this.aedes.subscribe = util.promisify(this.aedes.subscribe);
    this.aedes.unsubscribe = util.promisify(this.aedes.unsubscribe);
    this.aedes.publish = util.promisify(this.aedes.publish);

    this.aedes.on('publish', function (packet, client) {
      DEBUG('MQTT')('PUBLISH PACKET');
      if (!client && DEBUG('MQTT').enabled) require('eyes').inspect(packet);
      if (client) {
        DEBUG('MQTT')('publish from client', client.id)
      }
    });
    
    this.aedes.on('subscribe', function (subscriptions, client) {
      DEBUG('MQTT')(`${client ? client.id : 'INTERNAL'} subscription: ${JSON.stringify(subscriptions)}`);
      if (client && !this.clients[client.id].subscribed) {
        subscriptions.forEach((sub) => {
          if (sub.topic == `${config.cmndPrefix}/${client.id}_fb/#`) {
            this.QueryClient(client);
          }
        });
      }
    }.bind(this));
    
    this.aedes.on('client', function (client) {
      let socket = client.conn;
      this.debug(`${client.id} connected from ${socket.remoteAddress}:${socket.remotePort}`);
      this.clients[client.id] = {client: client, clientInfo: new this.CI(this.CIOpts)};
    }.bind(this));
    
    this.aedes.authorizePublish = (client, packet, cb) => {
      let re = RegExp(`${config.statPrefix}/${client.id}_fb/STATUS`);
      if (re.test(packet.topic)) {
        DEBUG('MQTT')(`Allowing ${client.id} publish to ${packet.topic}`);
        return cb();
      }
      DEBUG('MQTT')(`Denying ${client.id} publish to ${packet.topic}`);
      packet.topic = "dev/null";
      packet.payload = Buffer.from('0');
      cb();
    };
    
    this.aedes.authorizeSubscribe = (client, sub, cb) => {
      if (sub.topic == `${config.cmndPrefix}/${client.id}_fb/#`) {
        DEBUG('MQTT')(`Allowing ${client.id} subscription to ${sub.topic}`);
        return cb(null, sub);
      }
      DEBUG('MQTT')(`Denying ${client.id} subscription to ${sub.topic}`);
      sub = false;
      cb(null, sub);
    };

    this.aedes.on('clientError', function (client, err) {
      if (err.message == 'Forbidden') return;
      if (err.code == 'ECONNRESET') return;
      console.log('client error', client.id, err.message, err.stack)
    });
    
    this.aedes.on('connectionError', function (client, err) {
      console.log('client error', client, err.message, err.stack)
    });
  }
  /* eslint-enable max-lines-per-function */
}

module.exports = Autoconf;