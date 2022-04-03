/**
 * Handles all queue-related functions & routes
 */

// MODULES -------------------------------------------------------
const express = require('express');
const router = express.Router();
const fs = require('fs');

// CUSTOM MODULES ------------------------------------------------
const { queueItemAdded, queueItemRemoved } = require('./websocket.js');
const { getSongInfo, retrieveSong } = require('./song.js');


// VARIABLES -----------------------------------------------------
let isQueueLooping = false;
let queuePosition = 0;


// VARIABLE FUNCTIONS --------------------------------------------
/* These functions return or modify the value of exported variables */

/** Returns the queue's position */
function getQueuePosition() { 
    const data = fs.readFileSync(__dirname + '/queueconfig.json');
    if (data) { queuePosition = JSON.parse(data).queuePosition; }

    return queuePosition; 
}
queuePosition = getQueuePosition();
/** Changes the queue's position, returning it.
 * @param {Number} value the value to set the queue position to
 */
function setQueuePosition(value) { 
    queuePosition = value; 
    fs.writeFileSync(__dirname + '/queueconfig.json', JSON.stringify({ queuePosition : queuePosition }));
    return (queuePosition);
}

/** Returns whether the queue is looping currently */
function getisQueueLooping() { return isQueueLooping; } 
/** Changes whether the queue is looping, returning it.
 * @param {Boolean} value the value to change to.
 */
function setIsQueueLooping(value) { isQueueLooping = (value === true); return isQueueLooping; }


// FUNCTIONS -----------------------------------------------------
/** Get the items in the queue (excluding history)
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Guild} discordGuild The Discord Guild object for this query
 */
async function getQueue(pgClient, discordGuild) { 

    var query = 'SELECT * FROM queue WHERE queue_position >= $1;';
    var params = [ queuePosition ]
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Go through each item & add the user's display name, etc.
    let queueItems = [];
    result.rows.forEach(item => {
        let itemInfo = {
            itemID: item.id,
            queuePosition: item.queue_position,
            name: item.name,
            artist: item.artist,
            thumbnailUrl: item.thumbnail_url,
            duration: item.duration,
            youtubeUrl: 'https://youtu.be/' + item.youtube_id
        }

        // Get the item's associated user's information
        discordGuild.members.fetch(item.user_id)
        .then(userInfo => {
            if (!userInfo) { itemInfo.username = 'Unknown'; }
            else { 
                itemInfo.username = userInfo.nickname || userInfo.user.username
            }
            queueItems.push(itemInfo);
        });
    });

    return(queueItems);
}

/** Get the items in the history (excluding queue)
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 */
async function getHistory(pgClient, discordGuild) { 

    var query = 'SELECT * FROM queue WHERE queue_position < $1 ORDER BY queue_position DESC;';
    var params = [ queuePosition ]
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Go through each item & add the user's display name, etc.
    let queueItems = [];
    result.rows.forEach(item => {
        let itemInfo = {
            itemID: item.id,
            queuePosition: item.queue_position,
            name: item.name,
            artist: item.artist,
            thumbnailUrl: item.thumbnail_url,
            duration: item.duration,
            youtubeUrl: 'https://youtu.be/' + item.youtube_id
        }

        discordGuild.members.fetch(item.user_id)
        .then(userInfo => {
            if (!userInfo) { itemInfo.username = 'Unknown'; }
            else { 
                itemInfo.username = userInfo.nickname || userInfo.user.username
            }
            queueItems.push(itemInfo);
        });
    });

    return(queueItems);
}

/** Get a specific item from the queue (by ID or queue position) */
async function getItem(pgClient, itemID, queueIndex) { 

    if (!itemID) { 
        var query = 'SELECT * FROM queue WHERE queue_position = $1 LIMIT 1;';
        var params = [ queueIndex ];
    } else { 
        var query = 'SELECT * FROM queue WHERE id = $1 LIMIT 1;';
        var params = [ itemID ];
    }

    var err, result = await pgClient.query(query, params);
    if (err) { return false; }
    if (result.rows.length === 0) { return false; }

    let itemInfo = {
        itemID: result.rows[0].id,
        queuePosition: result.rows[0].queue_position,
        name: result.rows[0].name,
        artist: result.rows[0].artist,
        thumbnailUrl: result.rows[0].thumbnail_url,
        duration: result.rows[0].duration,
        youtubeUrl: 'https://youtu.be/' + result.rows[0].youtube_id
    }
    return(itemInfo);
}

/** Add an item to the queue
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {String} searchQuery YouTube URL for the item to play
 * @param {Snowflake} discordID Discord-issued user ID of the associated user
 */
async function addToQueue(pgClient, searchQuery, discordID, discordGuild) { 

    // Get the information about this item
    let itemInfo = await getSongInfo(searchQuery, 1);
    if (itemInfo === false) { return false; }
    itemInfo = itemInfo[0];

    // Get the previous item in the queue
    var query = 'SELECT queue_position FROM queue ORDER BY queue_position DESC LIMIT 1;';
    var params = [];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }
    let itemQueuePosition = 0;
    if (result.rows.length !== 0) { 
        itemQueuePosition = result.rows[0].queue_position + 1;
    }

    // Add to the database
    var query = 'INSERT INTO queue (queue_position, user_id, youtube_id, name, duration, artist, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;';
    var params = [ itemQueuePosition, discordID, itemInfo.id, itemInfo.name, itemInfo.duration, itemInfo.artist, itemInfo.thumbnailUrl ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }
    const currentSongID = result.rows[0].id;

    console.log('Item added to queue: ' + itemInfo.url + ', position: ' + itemQueuePosition);

    // Remove any items more than 100 ID's before
    var query = 'DELETE FROM queue WHERE id < $1;';
    var params = [ currentSongID - 100 ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Call the webhook event
    itemInfo = await retrieveSong(pgClient, currentSongID, null, discordGuild);
    queueItemAdded(itemInfo);
    return itemInfo;
}

/** Remove an item from the queue 
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {String} itemID server-issued item ID of the item to remove
*/
async function removeFromQueue(pgClient, queueIndex) {

    // Check if this item exists
    var query = 'SELECT * FROM queue WHERE queue_position = $1;';
    var params = [ queueIndex ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    // Check if this item is currently playing
    if (result.rows[0].queue_position === queuePosition) { return false; }

    // Remove the item
    var query = 'DELETE FROM queue WHERE queue_position = $1 RETURNING id;';
    var params = [ queueIndex ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    console.log('Removed item from the queue: ' + queueIndex);

    // Call the webhook event
    queueItemRemoved(result.rows[0].id);
    return true;
}


// ROUTES --------------------------------------------------------
router.get('/', async function(req, res) { 

    const pgClient = req.pgClient;

    // Get the queue
    let queueItems = await getQueue(pgClient, req.discordUserInfo.guild);
    if (queueItems === false) { res.status(500).send('Internal server error.'); return; }
    
    // Get the history
    let historyItems = await getHistory(pgClient, req.discordUserInfo.guild);
    if (historyItems === false) { res.status(500).send('Internal server error.'); return; }

    // Compile information
    const payload = { 
        queue: queueItems,
        history: historyItems,
        queuePosition: queuePosition,
        isQueueLooping: isQueueLooping
    }
    res.status(200).send(JSON.stringify(payload));
});

router.post('/add', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;
    const discordBotInfo = req.discordBotInfo; 

    // Check if the user is within the voice channel
    if (discordBotInfo.voiceChannel && !discordUserInfo.isInSameVoiceChannel) {
        res.status(401).send('User must be in the same voice channel.'); return; 
    }

    // Collect body variables
    let searchQuery = req.body.searchQuery;
    if (!searchQuery) { res.status(400).send('Missing searchQuery parameter.'); return; }

    // Add the item to the queue
    let resultStatus = await addToQueue(pgClient, searchQuery, discordUserInfo.id, discordUserInfo.guild);
    if (resultStatus === false) { res.status(404).send('Nothing could be found with that searchQuery.'); return; }

    // Return to caller
    res.status(200).send('Item successfully added to queue.');
});

router.post('/remove', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;

    // Check if the user is within the voice channel
    if (!discordUserInfo.isInSameVoiceChannel && discordBotInfo.connection) { res.status(401).send('User must be in the same voice channel.'); return; }

    // Collect body variables
    const queueIndex = req.body.queueIndex;
    if (!queueIndex) { res.status(400).send('Missing queueIndex parameter.'); return; }

    // Remove the item from the queue
    let resultStatus = await removeFromQueue(pgClient, queueIndex);
    if (resultStatus === false) { res.status(500).send('Internal server error.'); return }

    // Return to caller
    res.status(200).send('Item successfully removed from queue.');
});

router.post('/toggle-loop', async function(req, res) { 

    const discordUserInfo = req.discordUserInfo;

    // Check if the user is within the voice channel
    if (!discordUserInfo.isInSameVoiceChannel && discordBotInfo.connection) { res.status(401).send('User must be in the same voice channel.'); return; }

    // Toggle the queue looping status
    setIsQueueLooping(!getisQueueLooping());

    // Return to the caller
    res.status(200).send('Queue successfully toggled.');
});


// EXPORT --------------------------------------------------------
module.exports = {
    queueRouter: router,
    getQueue: getQueue,
    getHistory: getHistory,
    getItem: getItem,
    addToQueue: addToQueue,
    removeFromQueue: removeFromQueue,
    getQueuePosition: getQueuePosition,
    setQueuePosition: setQueuePosition,
    isQueueLooping: getisQueueLooping,
    setIsQueueLooping: setIsQueueLooping
};