/** 
 * Handles connections bewtween the server and any clients
 */

// MODULES -------------------------------------------------------
const express = require('express');
const router = express.Router();
const expressWs = require('express-ws')(router);


// VARIABLES -----------------------------------------------------
var activeConnections = [];
var previousItemID = 0;


// CONNECTION CLASS ----------------------------------------------
/** Describes a user websocket connection. Allows users with the same Discord ID to connect, relying instead on the connID for uniqueness.
 * @param connID server-issued connection identifier
 * @param discordID discord-issued identifier; must exist in the Mingleton guild
 * @param ws user's websocket connection instance
 */
class Connection {
    constructor(
        connID,
        discordID, 
        ws
    ) {
        this.connID = connID || createUUID();
        this.discordID = discordID;
        this.ws = ws;
    }

    push() { 
        // Check if this user already has an active connection
        let user = activeConnections.find(u => u.connID === this.connID);
        if (user) { return; }

        // Add this user to the activeConnections list
        activeConnections.push(this);

        // Send a notification to every socket
        connectionsUpdated();

        console.log('Added user to activeConnections:', this.connID);
        return true;
    }

    remove() { 
        // Check if this user has an active connection
        let user = activeConnections.find(u => u.connID === this.connID);
        if (!user) { return; }

        // Remove this user from the activeConnections list
        let userIndex = activeConnections.indexOf(user);
        activeConnections.splice(userIndex, 1);

        // Send a notification to every socket
        connectionsUpdated();

        console.log('Removed user from activeConnections:', this.connID);
        return true;
    }
}

// HELPER FUNCTIONS ----------------------------------------------
/** Sends an HTTP-like event to a client's ws connection
 * @param {*} ws the client's websocket connection
 * @param {*} event event type/title
 * @param {*} status HTTP status code
 * @param {*} content any other string/JSON-based content
 */
function socketSend(ws, event, status, content) {
    try { 
        ws.send(JSON.stringify({ event: event, status: status, content: content }));
    } catch(err) { 
        console.log('Unable to send to socket:', err);

        // TODO - remove the socket connection
    }
}

/** Creates a random UUID v4 */
function createUUID() { 
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}


// ROUTES --------------------------------------------------------
/** Regular user connection */
router.ws('/', async function (ws, req) { 

    // Collect relevant variables
    const discordUserInfo = req.discordUserInfo;
    const connID = req.query.connID;

    // Add this user to the list of connections
    let userConnection = new Connection(connID, discordUserInfo.id, ws);
    let userConnectionStatus = userConnection.push();
    if (userConnectionStatus === false) {      // This connection already exists, find it.
        userConnection = activeConnections.find(u => u.connID === connID);
    }

    // Send validity responseq
    socketSend(ws, 'connection', 200, 'Connected user successfully.');

    // Handle connection events
    ws.on('close', function() { 
        // Remove this user from the party connections list
        let userDisconnectionStatus = userConnection.remove();
    });
});


// FUNCTIONS -----------------------------------------------------
/** Broadcast to every connected user the number of connections has changed */
function connectionsUpdated() { 

    // Broadcast this to every connected user
    for (connection of activeConnections) { 
        socketSend(connection.ws, 'connections-updated', 200, { connectionCount: activeConnections.length });
    }

    console.log('Broadcast message: connections updated (count: ' + activeConnections.length + ').');
}

/** Called when an item has been added to the queue. Will notify every connected user; does not actually add the item
 * @param {Array} itemInfo Information about the song item added
 * @param {Boolean} isHistory Indicates whether this item belongs in the history or queue
 */
function queueItemAdded(itemInfo, isHistory) { 

    // Broadcast this to every connected user
    for (connection of activeConnections) { 
        socketSend(connection.ws, 'queue-item-added', 200, { itemInfo: itemInfo, isHistory: isHistory });
    }

    console.log('Broadcast message: queue item added.');
}

/** Called when an item has been removed from the queue. Will notify every connected user; does not actually remove the item 
 * @param {String} itemID Server-issued item ID
*/
function queueItemRemoved(itemID) { 

    // Broadcast this to every connected user
    for (connection of activeConnections) { 
        socketSend(connection.ws, 'queue-item-removed', 200, { itemID: itemID });
    }

    console.log('Broadcast message: queue item removed (ID: ' + itemID + ').');
}

/** Called to update the status of the player. Will include information like the current queue item, how far through, etc. 
 * @param {String} itemID server-issued item ID
 * @param {Boolean} isPlayerActive whether the player is active (used to be called isPlaying)
 * @param {Boolean} isPaused whether the player is currently paused
 * @param {Number} playbackDuration how far through the current song the player is
*/
function playbackUpdated(itemID, isPlayerActive, isPaused, isQueueLooping, playbackDuration) { 

    if (itemID) { previousItemID = itemID; }

    let payload = {
        itemID: itemID || previousItemID,
        isPlayerActive: isPlayerActive,
        isPaused: isPaused,
        isQueueLooping: isQueueLooping,
        playbackDuration: playbackDuration
    }

    // Broadcast this to every connected user
    for (connection of activeConnections) { 
        socketSend(connection.ws, 'playback-updated', 200, payload);
    }

    console.log('Broadcast message: playback status updated.');
}

/** Called when the player is completely stopped. */
function playbackStopped() {

    // Broadcast this to every connected user
    for (connection of activeConnections) { 
        socketSend(connection.ws, 'playback-stopped', 200, '');
    }

    console.log('Broadcast message: playback stopped.');
}


// EXPORT --------------------------------------------------------
module.exports = {
    websocketConnection: router,
    connectionsUpdated: connectionsUpdated,
    queueItemAdded: queueItemAdded,
    queueItemRemoved: queueItemRemoved,
    playbackUpdated: playbackUpdated,
    playbackStopped: playbackStopped
};