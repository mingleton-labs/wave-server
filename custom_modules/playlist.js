/** 
 * Handles all routes & functions relating to playlist manipulation.
 */

// MODULES -------------------------------------------------------
const express = require('express');
const { getSongInfo } = require('./song.js');
const router = express.Router();


// CUSTOM MODULES ------------------------------------------------
const { addToQueue } = require('./queue.js');


// FUNCTIONS -----------------------------------------------------
/** List all of a user's playlist names & basic information
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {Guild} discordGuild Discord Guild object of the guild
 * @param {Boolean} isGetAll If true, will retrieve all playlists (not just this user's)
 */
async function listPlaylists(pgClient, discordID, discordGuild, isGetAll) { 
    
    let playlistList = [];

    if (!isGetAll === true) {    // Select only this user's playlists
        var query = 'SELECT * FROM playlists WHERE user_id = $1 ORDER BY user_id, name;';
        var params = [ discordID ];
    } else { 
        var query = 'SELECT * FROM playlists ORDER BY user_id, name;';
        var params = [ ];
    }

    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Add items to the playlist list
    for (item of result.rows) { 
        let playlistInfo = { 
            id: item.id,
            name: item.name, 
            description: item.description,
            thumbnailUrl: item.thumbnail_url, 
            userID: item.user_id,
            userDisplayName: 'Unknown',
            hasEditAccess: false
        }

        // Get the user's display name
        let userInfo = await discordGuild.members.fetch(playlistInfo.userID);
        if (userInfo) { playlistInfo.userDisplayName = userInfo.displayName; }

        // Check for edit access
        if (playlistInfo.userID === discordID) { playlistInfo.hasEditAccess = true; }

        // Add to the list
        playlistList.push(playlistInfo);
    }

    // Return the list
    return(playlistList);
}

/** Get all information, edit access and songs in a playlist
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {Int} playlistID Server-issued playlist identifier
 */
async function getPlaylist(pgClient, discordID, discordGuild, playlistID) { 

    // Retrieve this playlist
    var query = 'SELECT * FROM playlists WHERE id = $1;';
    var params = [ playlistID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Compile playlist information
    playlistInfo = {
        id: result.rows[0].id,
        name: result.rows[0].name,
        description: result.rows[0].description,
        thumbnailUrl: result.rows[0].thumbnail_url,
        userID: result.rows[0].user_id,
        userDisplayName: 'Unknown',
        hasEditAccess: false,
        songs: []
    }

    // Get the user's display name
    let userInfo = await discordGuild.members.fetch(result.rows[0].user_id);
    if (userInfo) { playlistInfo.userDisplayName = userInfo.displayName; }

    // Check for edit access
    if (result.rows[0].user_id === discordID) { playlistInfo.hasEditAccess = true; }

    // Find all playlist items
    var query = 'SELECT * FROM playlistitems WHERE playlist_id = $1;';
    var params = [ playlistID ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Loop through every item to get it's information
    for (item of result.rows) { 
        let itemInfo = {
            id: item.id,
            playlistID: item.playlist_id,
            playlistPosition: item.playlist_position,
            youtubeID: item.youtube_id,
            youtubeUrl: 'https://youtu.be/' + item.youtube_id,
            name: item.name,
            artist: item.artist,
            duration: item.duration,
            thumbnailUrl: item.thumbnail_url,
            userID: item.user_id,
            userDisplayName: 'Unknown'
        }

        // Get the user's display name
        let itemUserInfo = await discordGuild.members.fetch(result.rows[0].user_id);
        if (itemUserInfo) { playlistInfo.userDisplayName = itemUserInfo.displayName; }

        /* The above code may seem useless, but should mean users are correctly attributed if/when collaborative playlists become a feature */

        playlistInfo.songs.push(itemInfo);
    }

    // Return to caller
    return(playlistInfo);
}

/** Creates a playlist 
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {String} name Name of the playlist
 * @param {String} description Description of the playlist. Will be cut at 300 characters
 * @param {String} thumbnailUrl Valid URL for a thumbnail. Assumes it is valid
*/
async function createPlaylist(pgClient, discordID, name, description, thumbnailUrl) { 

    // Check if a playlist with this name already exists
    var query = 'SELECT * FROM playlists WHERE name = $1;';
    var params = [ name ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length > 0) { return false; }

    // Shorten the name & description if necessary
    if (name.length > 50) { name = name.substring(0, 50); }
    if (description.length > 300) { descripton = description.substring(0, 300); }

    // Create the playlist
    var query = 'INSERT INTO playlists (user_id, name, description, thumbnail_url) VALUES ($1, $2, $3, $4);';
    var params = [ discordID, name, description, thumbnailUrl ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Return to the caller
    console.log('Playlist created with name: ' + name + ' for user: ' + discordID);
    return true;
}

/** Edits a playlist, modifying all values. Ignores null values.
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {Int} playlistID Server-issued playlist identifier
 * @param {String} name Name of the playlist
 * @param {String} description Description of the playlist. Will be cut at 300 characters
 * @param {String} thumbnailUrl Valid URL for a thumbnail. Assumes it is valid
 */
async function editPlaylist(pgClient, discordID, playlistID, name, description, thumbnailUrl) {

    // Retrieve this playlist
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2;';
    var params = [ playlistID, discordID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Update any non-null values 
    name = name || result.rows[0].name;
    description = description || result.rows[0].description;
    thumbnailUrl = thumbnailUrl || result.rows[0].thumbnail_url;

    // Shorten the name & description if necessary
    if (name.length > 50) { name = name.substring(0, 50); }
    if (description.length > 300) { descripton = description.substring(0, 300); }

    // Check if a playlist with this name already exists
    var query = 'SELECT * FROM playlists WHERE name = $1 AND id != $2;';
    var params = [ name, playlistID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length > 0) { return false; }

    // Update the playlist
    var query = 'UPDATE playlists SET name = $1, description = $2, thumbnail_url = $3 WHERE id = $4 AND user_id = $5;';
    var params = [ name, description, thumbnailUrl, playlistID, discordID ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Return to the caller
    console.log('Playlist: ' + playlistID + ' updated for user: ' + discordID);
    return true;
}

/** Deletes a playlist & all its items.
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {Int} playlistID Server-issued playlist identifier
 */
async function deletePlaylist(pgClient, discordID, playlistID) { 
    
    // Retrieve this playlist
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2;';
    var params = [ playlistID, discordID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Delete the playlist
    var query = 'DELETE FROM playlists WHERE id = $1 AND user_id = $2;';
    var params = [ playlistID, discordID ]; 
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Delete playlist items
    var query = 'DELETE FROM playlistitems WHERE playlist_id = $1;';
    var params = [ playlistID ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Return to caller
    console.log('Deleted playlist: ' + playlistID + ' by user: ' + discordID); 
    return true;
}

/** Adds a song to a playlist 
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {Int} playlistID Server-issued playlist identifier
 * @param {SongInfo} songInfo A singular song object retrieved using the getSongInfo function
*/
async function addPlaylistSong(pgClient, discordID, playlistID, songInfo) {

    // Check if the playlist exists
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2;';
    var params = [ playlistID, discordID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Search for the last added playlist item
    var query = 'SELECT playlist_position FROM playlistitems ORDER BY playlist_position DESC LIMIT 1;';
    var params = [ ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    let songPosition = 0;
    if (result.rows.length > 0) { songPosition = result.rows[0].playlist_position + 1; }

    // Add to the playlist
    var query = 'INSERT INTO playlistitems (playlist_id, user_id, youtube_id, name, artist, duration, thumbnail_url, playlist_position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);';
    var params = [ playlistID, discordID, songInfo.id, songInfo.name, songInfo.artist, songInfo.duration, songInfo.thumbnailUrl, songPosition ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; } 

    // Return to the caller
    console.log('Playlist item: ' + songInfo.id + ' added to playlist: ' + playlistID + ' by user: ' + discordID);
    return true;
}

/** Removes a song from the playlist
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Snowflake} discordID Discord-issued identifier
 * @param {Int} playlistID Server-issued playlist identifier
 * @param {Int} songID Server-issued identifier for the item. Leave null to use songIndex
 * @param {Int} songIndex Queue position for song object. Only considered if songID is null
 */
async function removePlaylistSong(pgClient, discordID, playlistID, songID, songIndex) { 

    // Check if the playlist exists
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2;';
    var params = [ playlistID, discordID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Check if the playlist item exists
    if (songID !== null) { 
        var query = 'SELECT * FROM playlistitems WHERE id = $1 AND playlist_id = $2 AND user_id = $3;';
        var params = [ songID, playlistID, discordID ];
    } else if (songIndex !== null) { 
        var query = 'SELECT * FROM playlistitems WHERE queue_position = $1 AND playlist_id = $2 AND user_id = $3;';
        var params = [ songIndex, playlistID, discordID ];
    } else { return false; }
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Remove the item
    if (songID !== null) { 
        var query = 'DELETE FROM playlistitems WHERE id = $1 AND playlist_id = $2 AND user_id = $3;';
        var params = [ songID, playlistID, discordID ];
    } else if (songIndex !== null) { 
        var query = 'DELETE FROM playlistitems WHERE queue_position = $1 AND playlist_id = $2 AND user_id = $3;';
        var params = [ songIndex, playlistID, discordID ];
    }
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Return to caller
    console.log('Removed item: ' + songID || songIndex + ' from playlist ' + playlistID + ' by user: ' + discordID);
    return true;
}

/** Adds all of a playlist's items to the queue. */
async function queuePlaylist(pgClient, playlistID, discordGuild) { 

    // Retrieve this playlist
    var query = 'SELECT * FROM playlists WHERE id = $1;';
    var params = [ playlistID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Retrieve all items for the playlist
    var query = 'SELECT youtube_id, user_id FROM playlistitems WHERE playlist_id = $1;';
    var params = [ playlistID ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Add every item to the queue
    for (item of result.rows) { 
        let addResult = await addToQueue(pgClient, 'https://youtu.be/' + item.youtube_id, item.user_id, discordGuild);
        if (addResult === false) { console.log('Adding item: ' + item.youtube_id + ' to queue failed.;'); }
    }

    // Return to caller
    console.log('Added ' + result.rows.length + ' items to queue from playlist: ' + playlistID);
    return true;
}

// MIDDLEWARE ----------------------------------------------------
router.use( function checkDiscordUserInfo(req, res, next)  {
    const discordUserInfo = req.discordUserInfo;

    // Block anyone trying to make requests when not signed in - saves us calling this later
    if (!discordUserInfo.id) { res.status(400).send('User must be signed in to use this endpoint.'); return; }
    next();
})


// ROUTES --------------------------------------------------------
router.get('/', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;
    const playlistID = req.query.playlistID;
    const isGetAll = req.query.isGetAll || false;

    if (!playlistID) {      // ... List all the playlists
        const playlistList = await listPlaylists(pgClient, discordUserInfo.id, discordUserInfo.guild, isGetAll);
        if (playlistList === false) { res.status(500).send('Internal server error.'); return; }

        // Return to the caller
        res.status(200).send(JSON.stringify(playlistList));
        return;
    } else {                // ... Get a specific playlist
        const playlistInfo = await getPlaylist(pgClient, discordUserInfo.id, discordUserInfo.guild, playlistID);
        if (playlistInfo === false) { res.status(500).send('Internal server error.'); return; }

        // Return to the caller
        res.status(200).send(JSON.stringify(playlistInfo));
        return;
    }
});

router.post('/queue', async function(req, res) {

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;

    // Get required values
    const playlistID = req.body.playlistID;
    if (!playlistID) { res.status(400).send('Missing playlistID parameter.'); return; }

    // Queue the playlist
    const playlistResponse = await queuePlaylist(pgClient, playlistID, discordUserInfo.guild);
    if (playlistResponse === false) { res.status(500).send('Internal server error.'); return; }

    // Return to sender
    res.status(200).send('Successfully queued playlist.');
});

router.post('/create', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;

    const playlistInfo = { 
        name: req.body.name,
        description: req.body.description,
        thumbnailUrl: req.body.thumbnailUrl
    }

    // Check required values
    if (!playlistInfo.name || !playlistInfo.description || !playlistInfo.thumbnailUrl) { res.status(400).send('Missing name, description and/or thumbnailUrl parameters'); return; }

    // Create the playlist 
    const playlistResponse = await createPlaylist(pgClient, discordUserInfo.id, playlistInfo.name, playlistInfo.description, playlistInfo.thumbnailUrl);
    if (playlistResponse === false) { res.status(500).send('Internal server error.'); return; }

    // Return to sender
    res.status(200).send('Successfully created playlist.');
});

router.post('/edit', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;

    const playlistInfo = { 
        id: req.body.playlistID,
        name: req.body.name,
        description: req.body.description,
        thumbnailUrl: req.body.thumbnailUrl
    }

    // Check required values
    if (!playlistInfo.id || !playlistInfo.name || !playlistInfo.description || !playlistInfo.thumbnailUrl) { res.status(400).send('Missing playlistID, name, description and/or thumbnailUrl parameters'); return; }

    // Edit the playlist
    const playlistResponse = await editPlaylist(pgClient, discordUserInfo.id, playlistInfo.id, playlistInfo.name, playlistInfo.description, playlistInfo.thumbnailUrl);
    
    if (playlistResponse === false) { res.status(500).send('Internal server error.'); return; }

    // Return to sender
    res.status(200).send('Successfully created playlist.');
});

router.post('/delete', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;
    const playlistID = req.body.playlistID;

    if (!playlistID) { res.status(400).send('Missing playlistID parameter.'); return; }

    // Delete the playlist
    const playlistResponse = await deletePlaylist(pgClient, discordUserInfo.id, playlistID);
    if (playlistResponse === false) { res.status(500).send('Internal server error.'); return; }

    // Return to sender
    res.status(200).send('Successfully deleted playlist.');
});

router.post('/item/add', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;

    // Get required values
    const playlistID = req.body.playlistID;
    const songQuery = req.body.songQuery;
    if (!playlistID || !songQuery) { res.status(400).send('Missing playlistID and/or songQuery parameters.'); return; }

    // Get the song's information
    let songInfoList = await getSongInfo(songQuery, 1);
    if (songInfoList === false) { res.status(500).send('Internal server error.'); return; }
    const songInfo = songInfoList[0];

    // Add this item to the playlist
    const playlistResponse = await addPlaylistSong(pgClient, discordUserInfo.id, playlistID, songInfo);
    if (playlistResponse === false) { res.status(500).send('Internal server error.'); return; }

    // Return to sender
    res.status(200).send('Successfully added item to playlist.');
});

router.post('/item/remove', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;

    // Get required values
    const playlistID = req.body.playlistID;
    const songID = req.body.songID;
    if (!playlistID || !songID) { res.status(400).send('Missing playlistID and/or songID parameters.'); return; }

    // Remove the item from the playlist
    const playlistResponse = await removePlaylistSong(pgClient, discordUserInfo.id, playlistID, songID, null);
    if (playlistResponse === false) { res.status(500).send('Internal server error.'); return; }

    // Return to sender
    res.status(200).send('Successfully removed item from playlist.');
});


// EXPORT --------------------------------------------------------
module.exports = {
    playlistRouter: router,
    listPlaylists: listPlaylists,
    getPlaylist: getPlaylist,
    createPlaylist: createPlaylist,
    editPlaylist: editPlaylist,
    deletePlaylist: deletePlaylist,
    addPlaylistSong: addPlaylistSong,
    removePlaylistSong: removePlaylistSong,
    queuePlaylist: queuePlaylist
};