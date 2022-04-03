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
    // var query = 'DROP TABLE IF EXISTS playlists';
    // var params = [];
    // client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    // var query = 'DROP TABLE IF EXISTS playlistitems;';
    // var params = [];
    // client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    var query = 'DROP TABLE IF EXISTS queue;';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    // CREATE PLAYLISTS TABLE
    var query = 'CREATE TABLE IF NOT EXISTS playlists (id SERIAL, user_id VARCHAR(255), name VARCHAR(255), description VARCHAR(255), thumbnail_url VARCHAR(255));';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    // CREATE PLAYLISTITEMS TABLE
    var query = 'CREATE TABLE IF NOT EXISTS playlistitems (id SERIAL, playlist_position INT, user_id VARCHAR(255), playlist_id VARCHAR(255), youtube_id VARCHAR(255), name VARCHAR(255), duration INT, thumbnail_url VARCHAR(255), artist VARCHAR(255));';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});

    // CREATE QUEUE TABLE
    var query = 'CREATE TABLE IF NOT EXISTS queue (id SERIAL, queue_position INT, user_id VARCHAR(255), youtube_id VARCHAR(255), name VARCHAR(255), duration VARCHAR(255), thumbnail_url VARCHAR(255), artist VARCHAR(255));';
    var params = [];
    client.query(query, params, function(err, result) { if (err) { console.log(err); }});
    console.log('table created');
}
databaseSetup();

// var query = 'INSERT INTO playlists (user_id, name) VALUES ($1, $2);';
// var params = ['387942011010809856', 'The Bird\'s Tunes'];
// client.query(query, params, function(err, result) { if (err) { console.log(err); } console.log('Created playlist.'); });

