/** 
 * Handles any routes & functions relating to the currently-playing object, including live bot playback.
 */

// MODULES -------------------------------------------------------
const express = require('express');
const router = express.Router();
const ytdl = require('ytdl-core');

const { VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, entersState } = require('@discordjs/voice');


// CUSTOM MODULES ------------------------------------------------
const { playbackUpdated, queueItemRemoved, playbackStopped, queueItemAdded } = require('./websocket.js');
const { retrieveSong } = require('./song.js');
const { getQueuePosition, setQueuePosition, addToQueue, isQueueLooping, setIsQueueLooping } = require('./queue.js');


// VARIABLES -----------------------------------------------------
let isPlayerActive = false;
let isPlayerPaused = false;
let playbackDuration = 0;

var connection;
var player;

// VARIABLE FUNCTIONS --------------------------------------------
/* These functions return or modify the value of exported variables */
function getIsPlayerActive() { return isPlayerActive; }
function getIsPlayerPaused() { return isPlayerPaused; }


// HELPER FUNCTIONS ----------------------------------------------
/** Normalises a number, appending a number of 0 digits beforehand if necessary 
 * @param {Number} number the number to calculate
 * @param {Number} digits the number of digits to prepend, if necessary
*/
function normaliseNumber(number, digits) { 
    // Make a fixed-length number to the number of digits
    // If a number has less digits, it will be padded with zeros

    let string = number.toString();
    let length = string.length;

    if (length < digits) {
        for (let i = 0; i < digits - length; i++) {
            string = '0' + string;
        }
    }

    return string;
}

/** Normalises a value of seconds into hours, minutes & seconds
 * @param {Number} calcSeconds seconds to calculate
 */
function normaliseMinutes(calcSeconds) {
    // Converts seconds to hours, minutes and seconds
    let hours = Math.floor(calcSeconds / 3600);
    let minutes = Math.floor((calcSeconds - (hours * 3600)) / 60);
    let seconds = calcSeconds - (hours * 3600) - (minutes * 60);

    if (hours > 0) {
        return normaliseNumber(hours, 2) + ':' + normaliseNumber(minutes, 2) + ':' + normaliseNumber(seconds, 2);
    } else {
        return normaliseNumber(minutes, 2) + ':' + normaliseNumber(seconds, 2);
    }
}


// FUNCTIONS -----------------------------------------------------
/** Plays the current song in the queue, if there is any */
async function beginPlayback(pgClient, botClient, voiceChannel, textChannel) {

    // Check if it is already playing
    if (isPlayerActive) { return false; }
    console.log(getQueuePosition);

    // Find the current song
    let songInfo = await retrieveSong(pgClient, null, getQueuePosition(), voiceChannel.guild);
    if (songInfo === false) { isPlayerActive = false; return false; }
    console.log(songInfo);
    isPlayerActive = true; isPlayerPaused = false;
    
    // Attempt to find a connection
    connection = getVoiceConnection(voiceChannel.guild.id);
    // console.log('Connection:', connection);

    if (!connection) {      // If a connection couldn't be found...
        console.log('No connection found, creating new one.');

        // Create a new connection
        connection = await joinVoiceChannel({ 
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });

        console.log('New connection created.');
    }
    console.log('Connection established.');

    // Begin streaming the video
    let stream = ytdl(songInfo.youtubeUrl, {
        filter: 'audioonly',
        quality: 'lowestaudio',
        source_address: '0.0.0.0'
    });

    // Create the player & resource
    console.log('Creating audio player...');
    player = createAudioPlayer();
    console.log('Creating audio resource...');
    let resource = createAudioResource(stream);

    // Play the song
    player.play(resource);
    connection.subscribe(player);
    
    // Handle player events
    player.on(AudioPlayerStatus.Playing, () => {
        console.log('Playback begun.');

        console.log(songInfo);

        // Update status
        botClient.user.setPresence({
            activities: [{ 
                name: songInfo.name || 'Unknown',
                type: 'LISTENING'
            }],
            status: 'online'
        });

        // Send update to channel
        let embed = { 
            title: 'Now playing ' + songInfo.name + ' by ' + songInfo.artist,
            url: songInfo.youtubeUrl,
            color: voiceChannel.guild.me.displayColor,
            description: 'Added by @' + songInfo.username + ' • ' + normaliseMinutes(songInfo.duration),
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }
        textChannel.send({ embeds: [ embed ]});

        // Send webhook update
        playbackUpdated(songInfo.itemID, isPlayerActive, isPlayerPaused, isQueueLooping(), playbackDuration);
        
        // Reset playback status
        isPlayerActive = true;

        console.log('isPlayerActive:', isPlayerActive)
    });

    player.on('error', console.error);

    player.on('debug', (info) => {

        console.log('Playback debug event:', info);

        if (info.includes('to {"status":"idle"')) {         // The current song has ended
            console.log('Song ended, playing next song.');

            skipSong(pgClient, botClient, voiceChannel, textChannel).then(skipResponse => {
                if (skipResponse === false) { 
                    embed = { 
                        title: 'Stopped playing',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: voiceChannel.guild.me.displayColor,
                        description: 'There\'s nothing left in the queue. Add some more with `/play` or `/add`!',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    textChannel.send({ embeds: [ embed ]});
    
                    // Stop playback
                    stopPlayback(pgClient, botClient);
                }
            });
        }
    });

    // Handle connection events
    connection.on(VoiceConnectionStatus.Signalling, (oldState, newState) => {
        console.log(`Connection state changed from ${oldState} to ${newState}.`);
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log('Connection entered Ready state - ready to play audio.');
    });

    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
            // Seems to be reconnecting to a new channel - ignore disconnect
        } catch (error) {
            // Seems to be a real disconnect which SHOULDN'T be recovered from
            console.log('Forcefully disconnected from voice channel.');
            embed = { 
                title: 'Stopped playing',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: voiceChannel.guild.me.displayColor,
                description: 'Looks like I got disconnected. I\'ll assume you don\'t want me around anymore and take a rest.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }
            textChannel.send({ embeds: [ embed ]});

            // Stop playback
            stopPlayback(pgClient, botClient);
        }
    });
}

/** Moves to the next item in the queue, ignoring any remaining playback on the current item */
async function skipSong(pgClient, botClient, voiceChannel, textChannel) { 

    // Re-add the current item
    let currentItemInfo = await retrieveSong(pgClient, null, getQueuePosition(), voiceChannel.guild);
    if (isQueueLooping()) { 
        await addToQueue(pgClient, currentItemInfo.youtubeUrl, currentItemInfo.userID, voiceChannel.guild);
    }

    // Remove from queue & add to history
    queueItemRemoved(currentItemInfo.itemID);
    queueItemAdded(currentItemInfo, true);

    // Get the queue position of the next item
    var query = 'SELECT queue_position FROM queue WHERE queue_position >= $1 ORDER BY queue_position LIMIT 2;';
    var params = [ getQueuePosition() ];
    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length < 2) { return false; }

    // Skipping the song doesn't remove it from the queue, it simply moves to the next item
    playbackDuration = 0;
    isPlayerActive = false;

    setQueuePosition(result.rows[1].queue_position);

    await beginPlayback(pgClient, botClient, voiceChannel, textChannel);
}

/** Stops all playback of the current song, leaves the voice channel, and clears the queue */
async function stopPlayback(pgClient, botClient) { 

    // Clear the queue
    var query = 'DELETE FROM queue WHERE queue_position >= $1;';
    var params = [ getQueuePosition(), ];
    var err, result = await pgClient.query(query, params);
    if (err) { return false; }

    // Stop the player & terminate the connection
    if (player) { player.stop(); }; player = null;
    if (connection) { connection.destroy(); }; connection = null;

    // Reset the player
    isPlayerActive = false;
    isPlayerPaused = false;
    setIsQueueLooping(false);

    // Update bot presence
    botClient.user.setPresence({
        activities: [{ 
            name: 'mingleton.isaacshea.com',
            type: 'LISTENING'
        }],
        status: 'online'
    });

    // Send webhook event
    playbackStopped();
}

/** Pauses any playback of the current song */
function pausePlayback() { 

    if (!player || isPlayerActive === false) { return false; }

    // Pause the playback
    player.pause();
    isPlayerPaused = true;

    // Send webhook event
    playbackUpdated(null, isPlayerActive, isPlayerPaused, isQueueLooping(), playbackDuration);

    return true;
}

/** Resumes any playback of the current song */
function resumePlayback() { 

    if (!player || isPlayerActive === false) { return false; }

    // Resume the playback
    player.unpause();
    isPlayerPaused = false;

    // Send webhook event
    playbackUpdated(null, isPlayerActive, isPlayerPaused, isQueueLooping(), playbackDuration);

    return true;
}

/** Gets information currently-playing song */
async function nowPlaying(pgClient, discordGuild) { 

    let songInfo = await retrieveSong(pgClient, null, getQueuePosition(), discordGuild);
    if (songInfo === false) { return false; }

    let nowPlayingInfo = {
        songInfo: songInfo,
        playbackDuration: playbackDuration,
        isPlayerActive: isPlayerActive,
        isPlayerPaused: isPlayerPaused
    }
    return(nowPlayingInfo);
}


// ROUTES --------------------------------------------------------
router.get('/', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordBotInfo = req.discordBotInfo;

    // Get the current queue item
    var query = 'SELECT * FROM queue WHERE queue_position = $1;';
    var params = [ getQueuePosition() ];
    var err, result = await pgClient.query(query, params);
    if (err) { res.status(500).send('Internal server error.'); return; }
    if (result.rows.length === 0) { res.status(404).send('Nothing was found.'); return; }

    let itemUserInfo = await boundGuild.members.fetch(result.rows[0].user_id);

    // Compile the item's information
    let itemInfo = { 
        itemID: result.rows[0].id,
        name: result.rows[0].name,
        artist: result.rows[0].artist,
        youtubeUrl: 'https://youtu.be/' + result.rows[0].youtube_id,
        thumbnailUrl: result.rows[0].thumbnail_url,
        duration: result.rows[0].duration,
        getQueuePosition: result.rows[0].queue_position,
        username: itemUserInfo.nickname || itemUserInfo.user.username
    }

    // Compile the now playing info
    let nowPlayingInfo = {
        currentItem: itemInfo,
        getQueuePosition: getQueuePosition(),
        playbackDuration: playbackDuration,
        isPlayerActive: isPlayerActive,
        isPlayerPaused: isPlayerPaused
    }

    // Return to client
    res.status(200).send(JSON.stringify(nowPlayingInfo));
});

router.post('/toggle-pause', async function(req, res) { 

    const discordUserInfo = req.discordUserInfo;
    const discordBotInfo = req.discordBotInfo;

    // Check if the bot is playing
    if (!discordBotInfo.voiceChannel) { res.status(404).send('Nothing is playing.'); return; }

    // Check if the client & bot are in the same voice channel
    if (discordBotInfo.voiceChannel && !discordUserInfo.isInSameVoiceChannel) {
        res.status(400).send('User and bot are not in the same voice channel.'); return; 
    }

    // Toggle the current playback status
    let playbackResult = false;
    if (isPlayerPaused) { 
        playbackResult = resumePlayback();
    } else {
        playbackResult = pausePlayback();
    }

    // Return to caller
    if (playbackResult === true) { 
        res.status(200).send('Playback is now ' + isPlayerPaused ? 'paused' : 'resumed'); 
    } else { 
        res.status(404).send('Nothing is playing.');
    }
});

router.post('/stop', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;
    const discordBotInfo = req.discordBotInfo;

    // Check if the bot is playing
    if (!discordBotInfo.voiceChannel) { res.status(404).send('Nothing is playing.'); return; }

    // Check if the client & bot are in the same voice channel
    if ((discordBotInfo.voiceChannel && !discordUserInfo.isInSameVoiceChannel) || !discordUserInfo.isInSameVoiceChannel) {
        res.status(400).send('User and bot are not in the same voice channel.'); return; 
    }

    // Stop playback
    let stopResult = await stopPlayback(pgClient, discordBotInfo.clientObject);
    if (stopResult === false) { res.status(500).send('Internal server error.'); return; }

    // Return to caller
    res.status(200).send('Stopped playback.');
});

router.post('/skip', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;
    const discordBotInfo = req.discordBotInfo;

    // Check if the bot is playing
    if (!discordBotInfo.voiceChannel) { res.status(404).send('Nothing is playing.'); return; }

    // Check if the client & bot are in the same voice channel
    if (discordBotInfo.voiceChannel && !discordUserInfo.isInSameVoiceChannel) {
        res.status(400).send('User and bot are not in the same voice channel.'); return; 
    }

    // Skip the song
    let skipResponse = await skipSong(pgClient, discordBotInfo.clientObject, discordUserInfo.voiceChannel, discordBotInfo.boundTextChannel);

    if (skipResponse === false) {   // Nothing left in the queue

        // Stop playback
        let stopResult = await stopPlayback(pgClient, discordBotInfo.clientObject);
        if (stopResult === false) { res.status(500).send('Internal server error.'); return; }

        // Return to caller
        res.status(200).send('Item skipped & playback stopped.');        
    } else { 
        res.status(200).send('Item skipped.');
    }
});

router.post('/begin', async function(req, res) { 

    const pgClient = req.pgClient;
    const discordUserInfo = req.discordUserInfo;
    const discordBotInfo = req.discordBotInfo;

    // Check if the client & bot are in the same voice channel
    if (discordBotInfo.voiceChannel && !discordUserInfo.isInSameVoiceChannel) {
        res.status(400).send('User and bot are not in the same voice channel.'); return; 
    }

    if (isPlayerActive === false) { 
        let playbackResponse = await beginPlayback(pgClient, discordBotInfo.clientObject, discordUserInfo.voiceChannel, discordBotInfo.boundTextChannel);

        if (playbackResponse === false) { res.status(500).send('Internal server error.'); return; }
        res.status(200).send('Begun playback');
    } else { 
        res.status(404).send('Something is already playing.');
    }
})


// TIMER ---------------------------------------------------------
setInterval(async function () {
    if (isPlayerActive === true && isPlayerPaused === false) { 
        playbackUpdated(null, isPlayerActive, isPlayerPaused, isQueueLooping(), playbackDuration);
        playbackDuration += 1;
    } else if (isPlayerActive === false) { playbackDuration = 0; }
}, 1000);


// EXPORT --------------------------------------------------------
module.exports = {
    playbackRouter: router,
    beginPlayback: beginPlayback,
    skipSong: skipSong,
    stopPlayback: stopPlayback,
    pausePlayback: pausePlayback,
    resumePlayback: resumePlayback,
    nowPlaying: nowPlaying,
    isPlayerActive: getIsPlayerActive,
    isPlayerPaused: getIsPlayerPaused
};