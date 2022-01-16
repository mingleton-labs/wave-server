const config = {
    user: 'mhvnfyigirkygv',
    host: 'ec2-18-208-97-23.compute-1.amazonaws.com',
    database: 'ddmv8bq89irs3j',
    password: 'f60b372577ea0ecfa6bf063b192539e7a806bbce91bf745afc839edc913ad611',
    port: 5432, 
    ssl: { rejectUnauthorized: false }
}

// -- POSTGRES -- 
const { Client } = require('pg');
const client = new Client(config);
client.connect();


// SETUP THE DB --------------------------------------------------
function databaseSetup() {
    // REMOVE OLD TABLES
    var query = 'DROP TABLE IF EXISTS awards;';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    var query = 'DROP TABLE IF EXISTS awardtypes;';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    var query = 'DROP TABLE IF EXISTS cards;';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    var query = 'DROP TABLE IF EXISTS test;';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    var query = 'DROP TABLE IF EXISTS playlists';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    var query = 'DROP TABLE IF EXISTS playlistitems;';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    // CREATE PLAYLISTS TABLE
    var query = 'CREATE TABLE IF NOT EXISTS playlists (id SERIAL, user_id VARCHAR(255), name VARCHAR(255));';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    // CREATE PLAYLISTITEMS TABLE
    var query = 'CREATE TABLE IF NOT EXISTS playlistitems (index SERIAL, id VARCHAR(255), user_id VARCHAR(255), playlist_id VARCHAR(255), url VARCHAR(255));';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); } console.log('created table!'); });
}
databaseSetup();