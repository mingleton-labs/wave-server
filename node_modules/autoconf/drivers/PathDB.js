"use strict"

/* PathDB reads each key from a separate JSON file on the filesystem */

const {DBDriver} = require('../drivers'),
      Path = require('path'),
      fs = require('fs');

class PathDB extends DBDriver {
    constructor(opts) {
        super(opts);
        if (!opts || !opts.dbpath)
            throw new Error('Missing required configuration: dbpath');
        this.dbpath = opts.dbpath;
        try {
            /* eslint-disable-next-line no-sync */
            let stat = fs.lstatSync(this.dbpath);
            if (!stat.isDirectory())
                throw new Error(`Invalid path specified: ${this.dbpath}`);
        } catch (e) {
            if (e.code == 'ENOENT')
                throw new Error(`Invalid path specified: ${this.dbpath}`);
            else
                throw e;
        }
        this.debug(`Initializing driver with path ${this.dbpath}`);
        if (opts.global) {
          try {
              /* eslint-disable-next-line no-sync */
              this.global = JSON.parse(fs.readFileSync(this._getKey(opts.global), 'utf8'));
              this.debug(`Enabled global record from ${opts.global}`);
          } catch (e) {
              if (e.code == 'ENOENT')
                  console.error(`${this.constructor.name}: Ignoring invalid global file '${opts.global}'`);
              else
                  throw e;
          }
        }
    }
    _getKey(key) {
        return Path.join(this.dbpath, `${key}.json`);
    }
    async seek(key) {
      try {
          let stat = await fs.promises.lstat(this._getKey(key));
          return stat.isFile();
      } catch (e) {
          if (e.code == 'ENOENT')
              return false;
          throw e;
      }
    }
    async read(key) {
        let o = this.global ? this.global : {};
        return Object.assign(o, JSON.parse((await fs.promises.readFile(this._getKey(key), 'utf8'))));
    }
  }

  module.exports = PathDB;