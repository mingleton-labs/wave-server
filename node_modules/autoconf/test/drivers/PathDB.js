/* eslint-disable max-lines-per-function */
/* eslint-disable no-unused-expressions */

"use strict"

const chai = require('chai'),
      sinonChai = require('sinon-chai'),
      fs = require('fs').promises,
      Path = require('path'),
      lib = require('../../drivers/PathDB');

const should = chai.should();
chai.use(sinonChai);

describe('PathDB', function() {
    describe('without global', function() {
        let l = null;
        beforeEach(function() {
            l = new lib({dbpath: Path.join(__dirname, '../db')});
        });
        it('should seek to valid file', async function() {
            const rv = await l.seek('112233445566');
            rv.should.be.true;
        });
        it('should not seek invalid file', async function() {
            const rv = await l.seek('665544332211');
            rv.should.be.false;
        });
        it('should read a valid file (no global)', async function() {
            const o = JSON.parse(await fs.readFile(Path.join(__dirname, '../db', '112233445566.json'), 'utf8'));
            const rv = await l.read('112233445566');
            rv.should.deep.equal(o);
        });
        it('should not read invalid file (no global)', async function() {
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
            l = new lib({dbpath: Path.join(__dirname, '../db'), global: 'GLOBAL'});
        });
        it('should read global file and merge with valid file', async function() {
            let o = JSON.parse(await fs.readFile(Path.join(__dirname, '../db', 'GLOBAL.json'), 'utf8'));
            Object.assign(o, JSON.parse(await fs.readFile(Path.join(__dirname, '../db', '112233445566.json'), 'utf8')));
            const rv = await l.read('112233445566');
            rv.should.deep.equal(o);
        });
        it('should warn, but silently continue, invalid global with valid file', async function() {
            let l = new lib({dbpath: Path.join(__dirname, '../db'), global: 'NOGLOBAL'});
            // TODO - stub console.error to ensure that we warn 
            const o = JSON.parse(await fs.readFile(Path.join(__dirname, '../db', '112233445566.json'), 'utf8'));
            const rv = await l.read('112233445566');
            rv.should.deep.equal(o);
        });
    });
    it('should not initialize with bad directory root', function() {
        // File
        try {
            // eslint-disable-next-line no-unused-vars
            let l = new lib({dbpath: __filename});
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