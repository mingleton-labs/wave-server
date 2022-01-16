"use strict"

/* FileDB reads each key from a single JSON file on the filesystem.  The file is cached at startup */

const {DBDriver} = require('../drivers'),
      Path = require('path'),
      fs = require('fs');

class FileDB extends DBDriver {
    constructor(opts) {
        super(opts);
        if (!opts || !opts.dbpath)
            throw new Error('Missing required configuration: dbpath');
        this.dbpath = opts.dbpath;
        try {
            /* eslint-disable-next-line no-sync */
            let stat = fs.lstatSync(this.dbpath);
            if (!stat.isFile())
                throw new Error(`Invalid path specified: ${this.dbpath}`);
            /* eslint-disable-next-line no-sync */
            this.db = JSON.parse(fs.readFileSync(this.dbpath, 'utf8'));
        } catch (e) {
            if (e.code == 'ENOENT')
                throw new Error(`Invalid path specified: ${this.dbpath}`);
            else
                throw e;
        }
        this.debug(`Initializing driver with path ${this.dbpath}`);
        if (opts.global) {
          try {
              this.global = this.db[opts.global];
              this.debug(`Enabled global record from ${opts.global}`);
          } catch (e) {
              if (e.code == 'ENOENT')
                  console.error(`${this.constructor.name}: Ignoring invalid global section '${opts.global}'`);
              else
                  throw e;
          }
        }
    }

    async seek(key) {
        return Boolean(this.db[key]);
    }

    async read(key) {
        let o = this.global ? this.global : {};
        if (await this.seek(key))
            return Object.assign(o, this.db[key]);
        let e = new Error('Invalid key')
        e.code = 'ENOENT';
        throw e;
    }
  }

  module.exports = FileDB;