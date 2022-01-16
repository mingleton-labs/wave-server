/* eslint-disable max-lines-per-function */
/* eslint-disable no-unused-expressions */

"use strict"

const chai = require('chai'),
      sinonChai = require('sinon-chai'),
      Path = require('path'),
      db = require('../db/filedb'),
      lib = require('../../drivers/FileDB');

const should = chai.should();
chai.use(sinonChai);

describe('FileDB', function() {
    describe('without global', function() {
        let l = null;
        beforeEach(function() {
            l = new lib({dbpath: Path.join(__dirname, '../db/filedb.json')});
        });
        it('should seek to valid section', async function() {
            const rv = await l.seek('112233445566');
            rv.should.be.true;
        });
        it('should not seek invalid section', async function() {
            const rv = await l.seek('665544332211');
            rv.should.be.false;
        });
        it('should read a valid section (no global)', async function() {
            const o = db['112233445566'];
            const rv = await l.read('112233445566');
            rv.should.deep.equal(o);
        });
        it('should not read invalid section (no global)', async function() {
            try {
                await l.read('665544332211');
                should.fail('Exception not thrown');
            } catch (e) {
                e.code.should.equal('ENOENT');
            }
        });
    });
    describe('with global', function() {
        let l = null;
        beforeEach(function() {
            l = new lib({dbpath: Path.join(__dirname, '../db/filedb.json'), global: 'GLOBAL'});
        });
        it('should read global section and merge with valid section', async function() {
            let o = db.GLOBAL;
            Object.assign(o, db['112233445566']);
            const rv = await l.read('112233445566');
            rv.should.deep.equal(o);
        });
        it('should warn, but silently continue, invalid global with valid section', async function() {
            let l = new lib({dbpath: Path.join(__dirname, '../db/filedb.json'), global: 'NOGLOBAL'});
            // TODO - stub console.error to ensure that we warn 
            const o = db['112233445566'];
            const rv = await l.read('112233445566');
            rv.should.deep.equal(o);
        });
    });
    it('should not initialize with bad database', function() {
        // Directory
        try {
            // eslint-disable-next-line no-unused-vars
            let l = new lib({dbpath: __dirname});
            should.fail('Exception not thrown');
        } catch (e) {
            e.should.be.an('error');
            e.message.should.have.string('Invalid path specified');
        }
        // Invalid path
        try {
            // eslint-disable-next-line no-unused-vars
            let l = new lib({dbpath: '/foo/bar/baz'});
            should.fail('Exception not thrown');
        } catch (e) {
            e.should.be.an('error');
            e.message.should.have.string('Invalid path specified');
        }
        // No dbpath
        try {
            // eslint-disable-next-line no-unused-vars
            let l = new lib({});
            should.fail('Exception not thrown');
        } catch (e) {
            e.should.be.an('error');
            e.message.should.equal('Missing required configuration: dbpath');
        }
    });
});