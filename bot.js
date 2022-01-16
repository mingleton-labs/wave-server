// MODULES ----------------------------------------------------------------------------
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { Client, Intents } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES] });

const { VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, entersState } = require('@discordjs/voice');

const ytdl = require('ytdl-core');
const youtubedl = require('youtube-dl-exec');

const express = require('express');
const cors = require('cors');


// CONFIG -----------------------------------------------------------------------------
const config = require('./savefiles/config.json');


// POSTGRES ---------------------------------------------------------------------------
const { Client: PGCLIENT } = require('pg');
const pgClient = new PGCLIENT({
    user: config.postgres.user,
    host: config.postgres.host,
    database: config.postgres.database,
    password: config.postgres.password,
    port: config.postgres.port,
    ssl: { rejectUnauthorized: false }
});
pgClient.connect();



// EXPRESS ----------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));
const corsOptions = { 
    origin: '*',
}


// CORS MIDDLEWARE --------------------------------------------------------------------
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'accept, authorization, content-type, x-requested-with');
    res.setHeader('Access-Control-Allow-Credentials', true);

    next();
});


// VARIABLES ---------------------------------------------------------------------------
let queue = [];
let history = [];
let isPlaying = false;
let isPaused = false;
let isLooping = false;
let durationTime = 0;

let boundTextChannel = null;
let boundVoiceChannel = null;
let boundGuild = null;

var player;
var resource; 
var connection;


// COMMANDS ----------------------------------------------------------------------------
const commands = [{
    name: 'play',
    description: 'Searches YouTube for a song and plays it.',
    options: [
        { type: 3, name: 'song', description: 'URL or search term for a song', required: true }
    ]
}, {
    name: 'remove',
    description: 'Removes a song from the queue.',
    options: [
        { type: 4, name: 'song', description: 'The queue index of the song', required: true }
    ]
}, {
    name: 'skip',
    description: 'Skips the current song.'
}, {
    name: 'rewind',
    description: 'Restarts or rewinds the song.'
}, {
    name: 'stop',
    description: 'Stops the bot and clears the queue.'
}, {
    name: 'queue',
    description: 'Shows the current queue.'
}, {
    name: 'history',
    description: 'Shows the history of played songs.'
}, {
    name: 'pause',
    description: 'Pauses/resumes the current song.'
}, {
    name: 'resume',
    description: 'Resumes/resumes the current song.'
}, { 
    name: 'loop',
    description: 'Toggles looping of the current queue.'
}, {
    name: 'shuffle',
    description: 'Shuffles the order of the current queue.'
}];

const rest = new REST({ version: '9' }).setToken(config.bot.discordAPIKey);

// SETUP COMMANDS
(async () => { 
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands('931031404706422825', '618748256028983326'),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();



// HELPER FUNCTIONS --------------------------------------------------------------------
/* Shuffles an array in an unbiased fashion
 * @param {Array} array - The array to shuffle */
function shuffle(array) { 
    let currentIndex = array.length,  randomIndex;

    // While there remain elements to shuffle...
    while (currentIndex != 0) {

        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }

    return array;
}



// CLIENT EVENTS -----------------------------------------------------------------------
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    client.user.setPresence({
        activities: [{ 
            name: 'mingleton.isaacshea.com',
            type: 'LISTENING'
        }],
        status: 'online'
    });

    // Set default channels
    boundTextChannel = client.channels.cache.get('619426531508355072');
    boundVoiceChannel = client.channels.cache.get('705278326713090058');
    boundGuild = client.guilds.cache.get(config.bot.guildID);
});

client.on('interactionCreate', async interaction => {

    console.log('NEW COMMAND ------------------------------------------------------------');
    console.log('isPlaying', isPlaying);
    
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'play') {

        // Bind to text channel
        boundTextChannel = interaction.channel;
        console.log('Bound to text channel: ' + boundTextChannel.name);

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            interaction.reply('Unable to play: you must be in a voice channel.');
            return;
        }

        // Add song to queue
        let song = interaction.options.data.find(option => option.name === 'song').value;
        if (!song) {
            interaction.reply('Unable to play: no song specified.');
            return;
        }

        // Defer the reply
        interaction.deferReply();

        let songInfo = await addToQueue(song, interaction.member.displayName, false);
        if (!songInfo) { 
            interaction.editReply('Unable to play: no song found.');
            return;
        }

        // Play song
        if (!isPlaying) {
            await playSong(interaction.member.voice.channel, true);
            interaction.editReply('Now playing **' + songInfo.name + '** by **' + songInfo.artist + '**.');
        } else { 
            interaction.editReply('Added **' + songInfo.name + '** by **' + songInfo.artist + '** to the queue.');
        }
    }
 
    if (interaction.commandName === 'remove') {

        // Remove from queue
        let removedSong = queue[interaction.options.data.find(option => option.name === 'song').value - 1];

        if (!removedSong) {
            interaction.reply('Unable to remove: no song found.');
        } else {
            interaction.reply('Removed **' + removedSong.name + '** from the queue.');
            queue.splice(interaction.options.data.find(option => option.name === 'song').value - 1, 1);
        }
    }

    if (interaction.commandName === 'skip') {

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            interaction.reply('Unable to skip: you must be in a voice channel.');
            return;
        }

        // Check if is playing
        if (!isPlaying) {
            interaction.reply('Unable to skip: no song is playing.');

            if (connection) { connection.destroy(); }
            if (player) { player.stop(); }

            return;
        }

        // Skip the song
        await skipSong(interaction.member.voice.channel);
        interaction.reply('Skipped the current song.');
    }

    if (interaction.commandName === 'rewind') {

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) { 
            interaction.reply('Unable to rewind: you must be in a voice channel.');
            return;
        }

        // Check if is playing
        if (!isPlaying) {
            interaction.reply('Unable to rewind: no song is playing.');
            return;
        }

        // Rewind the song
        await rewindSong(interaction.member.voice.channel);
        interaction.reply('Rewound the current song.');
    }

    if (interaction.commandName === 'stop') {

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            interaction.reply('Unable to stop: you must be in a voice channel.');
            return;
        }

        // Check if is playing
        if (!isPlaying) {
            interaction.reply('Unable to stop: Already stopped.');

            if (connection) { connection.destroy(); }
            if (player) { player.stop(); }

            return;
        }

        // Stop the song
        await stopSong();
        interaction.reply('Stopped the current song!');
    }

    if (interaction.commandName === 'pause' || interaction.commandName === 'resume') { 

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            interaction.reply('Unable to pause/resume: you must be in a voice channel.');
            return;
        }

        // Check if is playing
        if (!isPlaying) {
            interaction.reply('Unable to pause/resume: no song is playing.');

            if (connection) { connection.destroy(); }
            if (player) { player.stop(); }

            return;
        }

        // Pause/resume the song
        if (isPaused) {
            await resumeSong();
            interaction.reply('Resumed the current song.');
        } else {
            await pauseSong();
            interaction.reply('Paused the current song.');
        }
    }

    if (interaction.commandName === 'shuffle') {

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            interaction.reply('Unable to shuffle: you must be in a voice channel.');
            return;
        }

        // Check if is playing
        if (!isPlaying) {
            interaction.reply('Unable to shuffle: no song is playing.');
            return;
        }

        // Check if there is a queue
        if (queue.length === 0) {
            interaction.reply('Unable to shuffle: no songs in queue.');
            return;
        }

        // Shuffle the queue
        await shuffleQueue();
        interaction.reply('Shuffled the queue.');
    }

    if (interaction.commandName === 'queue') {

        // Check length of queue
        if (queue.length === 0) {
            interaction.reply('No queue to show.');
            return;
        }

        let messageText = 'Current queue:\n';
        for (let i = 0; i < queue.length; i++) {
            messageText += (i + 1) + ' • **' + queue[i].name + '** by **' + queue[i].artist + '**\n';
        }

        interaction.reply(messageText);
    }

    if (interaction.commandName === 'history') { 

        // Check length of history
        if (history.length === 0) {
            interaction.reply('No history to show.');
            return;
        }

        let messageText = 'History:\n';
        for (let i = 0; i < history.length; i++) {
            messageText += (i + 1) + ' • **' + history[i].name + '** by **' + history[i].artist + '**\n';
        }
    }

    if (interaction.commandName === 'loop') {

        // Check if there is a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            interaction.reply('Unable to loop: you must be in a voice channel.');
            return;
        }

        isLooping = !isLooping;
        interaction.reply('Looping is now ' + (isLooping ? 'enabled' : 'disabled') + '.');
    }
});


// COMMANDS ----------------------------------------------------------------------------
async function getSongInfo(song, isID) { 

    // Get song information
    let songInfo = {
        name: '',
        url: '',
        id: '',
        thumbnail_url: '',
        artist: '',
        duration: 0
    };

    // If this is the song's ID...
    let songQuery = '';
    if (isID) { 
        songQuery = 'https://www.youtube.com/watch?v=' + song;
    } else {
        // Check if song is a URL
        if (song.includes('youtube.com')) {
            // Extract song ID
            songQuery = 'https://www.youtube.com/watch?v=' + song.split('v=')[1].split('&')[0];
        } else {
            songQuery = 'ytsearch1:' + song;
        }
    }

    

    let output = await youtubedl(songQuery, { format: 'bestaudio[ext=m4a]', defaultSearch: 'auto', dumpJson: true })

    // Check if song was found
    if (!output) {
        console.log('Song not found!');
        return;
    }

    // Get song information
    songInfo.url = 'https://www.youtube.com/watch?v=' + output.id;
    songInfo.id = output.id;
    songInfo.name = output.title;
    songInfo.thumbnail_url = output.thumbnail;
    songInfo.artist = output.uploader;
    songInfo.duration = output.duration;

    return songInfo;
}

async function addToQueue(song, user, isID = false) {
    console.log('Adding song to queue: ' + song);

    // Get song information
    let songInfo = await getSongInfo(song, isID);

    // Add user
    if (typeof user == 'string') { songInfo.user = user; } else { songInfo.user = 'Unknown'; }

    // Add to queue
    queue.push(songInfo);
    console.log(songInfo);
}

async function playSong(channel, isInQueue = false) { 

    // Bind to channel for future events
    boundVoiceChannel = channel;

    // Attempt to find connection
    connection = getVoiceConnection(channel.guild.id);
    console.log(connection);
    if (!connection) {
        console.log('No connection found!');

        // Create a new connection
        connection = await joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator
        });

        console.log('connected');
    }

    // Check if there are songs in the queue
    if (queue.length === 0) {
        if (boundTextChannel) { boundTextChannel.send('Stopped playing: no songs in queue.'); }

        console.log('Queue is empty!');
        await stopSong();
        return;
    } 
    else { isPlaying = true; isPaused = false; }

    // Get song information
    let songInfo = queue[0];

    // Download video
    let stream = ytdl(songInfo.url);
    player = createAudioPlayer();
    resource = createAudioResource(stream);

    // Play song
    player.play(resource);
    connection.subscribe(player);
    player.on(AudioPlayerStatus.Playing, () => { 
        console.log('Playing!'); 
    });

    if (boundTextChannel && isInQueue == false) { boundTextChannel.send('Now playing **' + songInfo.name + '** by **' + songInfo.artist + '**.'); }

    // Reset timer
    durationTime = 0;
    
    player.on('error', console.error);
    player.on('debug', (info) => { console.log(info); 
        
        if (info.includes('to {"status":"idle"')) {
            console.log('Song ended!');
            let currentSong = queue.shift();

            // If looping, add song back to queue
            if (isLooping) { queue.push(currentSong); }
            else { history.push(currentSong); }

            playSong(channel);
        } else if (info.includes('to {"status":"autopaused"')) {
            console.log('Song paused!');
            // isPlaying = true;
            isPaused = true;
        } else if (info.includes('to {"status":"playing"')) {

            console.log('Song resumed!');
            isPlaying = true;
            isPaused = false;
        }
    });

    connection.on(VoiceConnectionStatus.Signalling, (oldState, newState) => {
        console.log(`Voice connection state changed from ${oldState} to ${newState}`);
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log('The connection has entered the Ready state - ready to play audio!');
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
            connection.destroy();

            console.log('Disconnected from voice channel!');
            if (boundTextChannel) { boundTextChannel.send('Stopped playing: disconnected from voice channel.'); }
            queue = [];

            connection.destroy();
            player.stop();
            connection = null;
            player = null;

            isPlaying = false;
            isPaused = false;
        }
    });

    connection.on('error', console.log);
}

async function skipSong(channel) {

    // Check if there is a player
    if (!player) {
        console.log('There is no player!');
        return;
    }

    // Check if there is a connection
    if (!connection) {
        console.log('There is no connection!');
        return;
    }

    // Stop the player
    player.stop();

    // Remove song from queue
    let currentSong = queue.shift();

    // If looping, add song back to queue
    if (isLooping) { queue.push(currentSong); }
    else { history.push(currentSong); }

    // Play next song
    await playSong(channel, false);
}

async function rewindSong(channel) { 

    // Check if there is a player
    if (!player) {
        console.log('There is no player!');
        return;
    }

    // Check if there is a connection
    if (!connection) {
        console.log('There is no connection!');
        return;
    }

    // If the song is more than 5 seconds through...
    if (durationTime > 5) {
        // Rewind the song
        await playSong(channel, false);
    } else {
        // Play the previous song
        let previousSong = null;
        if (isLooping) { previousSong = queue.pop();
        } else { 
            if (history.length > 0) { 
                previousSong = history.shift(); 
            }
        }

        // Add to queue
        if (previousSong) { queue.unshift(previousSong); }

        // Play the previous song
        await playSong(channel, false);
    }

}

async function stopSong() { 

    // Empty the queue
    queue = [];

    // Stop the player
    if (player) { player.stop(); } 
    player = null;

    // Destroy the connection
    if (connection) { connection.destroy(); }
    connection = null;

    // Reset the player
    isPlaying = false;
    isPaused = false;
}

async function pauseSong() { 
    
    // Check if there is a player
    if (!player) {
        console.log('There is no player!');
        return;
    }

    // Check if there is a connection
    if (!connection) {
        console.log('There is no connection!');
        return;
    }

    // Pause the player
    player.pause();
    isPaused = true;
}

async function resumeSong() { 

    // Check if there is a player
    if (!player) {
        console.log('There is no player!');
        return;
    }

    // Check if there is a connection
    if (!connection) {
        console.log('There is no connection!');
        return;
    }

    // Resume the player
    player.unpause();
    isPaused = false;
}

async function shuffleQueue() { 

    console.log('Shuffling queue!');

    // Check if there is a queue
    if (queue.length === 0) {
        console.log('Queue is empty!');
        return;
    }

    // Remove the first (currently playing) item from the queue
    let song = queue.shift();

    // Shuffle the queue
    queue = shuffle(queue);

    // Add the song back to the queue
    queue.unshift(song);

    console.log(queue);
}



// SERVER -----------------------------------------------------------------------------
app.get('/test', cors(corsOptions), async function (req, res) {  
    res.send('Hello World!');
});

app.get('/queue', cors(corsOptions), async function (req, res) {

    res.send({
        queue: queue,
        history: history,
        isPlaying: isPlaying,
        isPaused: isPaused,
        isLooping: isLooping
    });
});

app.get('/nowPlaying', cors(corsOptions), async function (req, res) {

    res.send({
        song: queue[0],
        isPlaying: isPlaying,
        isPaused: isPaused,
        isLooping: isLooping,
        durationTime: durationTime
    });
});

app.post('/play', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.term || !payload.userID) { res.status(404).send('No search term or user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Add to queue
    await addToQueue(payload.term, member.displayName + ' (via web)', false);

    // Play song
    if (!isPlaying) { await playSong(member.voice.channel, false); }

    // Return success
    res.status(200).send('Added to queue!');
});

app.post('/playpause', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.userID) { res.status(404).send('No user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Check for player or connection
    if (!player || !connection) { res.send('There is no player or connection!'); return; }

    // Pause song
    if (isPaused) { resumeSong(); } 
    else { pauseSong(); }
    
    res.send('Song paused!');
});

app.post('/skip', cors(corsOptions), async function (req, res) { 
    
    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.userID) { res.status(404).send('No user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Check for player or connection
    if (!player || !connection) { res.send('There is no player or connection!'); return; }

    // Skip song
    if (boundVoiceChannel) { await skipSong(boundVoiceChannel); }
    res.send('Skipped!');
});

app.post('/rewind', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.userID) { res.status(404).send('No user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Check for player or connection
    if (!player || !connection) { res.send('There is no player or connection!'); return; }

    // Skip song
    if (boundVoiceChannel) { await rewindSong(boundVoiceChannel); }
    res.send('Rewinded!');
}); 

app.post('/shuffle', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.userID) { res.status(404).send('No user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }
    
    // Check for player or connection
    if (!player || !connection) { res.send('There is no player or connection!'); return; }

    // Shuffle queue
    shuffleQueue();
    res.send('Shuffled!');
});

app.post('/loop', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.userID) { res.status(404).send('No user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Toggle looping
    isLooping = !isLooping;
    res.send('Looping is now ' + isLooping);
});

app.post('/removeFromQueue', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.index || !payload.userID) { res.status(404).send('No index or user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Remove from queue
    queue.splice(payload.index, 1);
    console.log(queue, payload.index);
    res.send('Removed from queue!');
});

app.post('/stopPlaying', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.userID) { res.status(404).send('No user id!'); return; }

    // Get a user's name from their ID
    let member = await boundGuild.members.cache.get(payload.userID)
    if (!member) { res.status(404).send('No user found!'); return; }

    // Check if the user is in a voice channel
    if (!member.voice.channel) { res.status(401).send('User is not in a voice channel!'); return; }

    // Stop song
    await stopSong();
    res.send('Stopped playing!');
});

// PLAYLISTS
app.get('/playlist/list', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let userID = req.query.userID;

    // Get the playlist list
    let playlistList = [];

    if (userID) { 
        // Get a particular user's playlists
        var query = 'SELECT * FROM playlists WHERE user_id = $1 ORDER BY name;';
        var params = [userID];
        pgClient.query(query, params, function(err, result) {
            if (err) { 
                console.log(err); 
                res.status(500).send('An error occurred while getting the playlist list.'); 
                return;
            }

            // Check if there are any items in the result
            if (result.rows.length == 0) { res.status(500).send('No playlists with the current query found.'); return; }

            // Add the items to the playlist list
            for (item of result.rows) {

                // Get associated username
                let member = boundGuild.members.cache.get(item.user_id);

                // Add items to playlist list
                playlistList.push({
                    id: item.id,
                    name: item.name,
                    userID: item.user_id,
                    userName: member.displayName
                });
            }

            res.status(200).send(JSON.stringify(playlistList));
        });
    } else {
        // Get all playlists
        var query = 'SELECT * FROM playlists ORDER BY name;';
        pgClient.query(query, function(err, result) {
            if (err) { 
                console.log(err); 
                res.status(500).send('An error occurred while getting the playlist list.');
                return;
            }

            // Check if there are any items in the result
            if (result.rows.length == 0) { res.status(500).send('No playlists with the current query found.'); return; }

            // Add the items to the playlist list
            for (item of result.rows) {
                
                // Get associated username
                let member = boundGuild.members.cache.get(item.user_id);

                // Add items to playlist list
                playlistList.push({
                    id: item.id,
                    name: item.name,
                    userID: item.user_id,
                    userName: member.displayName
                });
            }

            console.log(playlistList);

            res.status(200).send(JSON.stringify(playlistList));
        });
    }
});

app.get('/playlist', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let userID = req.query.userID;
    let playlistID = req.query.playlistID;

    // Check required content
    if (!userID) { res.status(400).send('No userID supplied.'); return; }
    if (!playlistID) { res.status(400).send('No playlistID supplied.'); return; }

    let playlistInfo = {
        id: '',
        name: '',
        userID: '',
        userName: 'unknown',
        items: []
    }

    // Get the playlist
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2';
    var params = [playlistID, userID];
    var err, result = await pgClient.query(query, params);
    if (err) { 
        console.log(err); 
        res.status(500).send('An error occurred while getting the playlist.'); 
        return;
    }

    if (result.rows.length === 0) {
        console.log('Playlist does not exist!');
        res.status(404).send('A playlist with that playlistID and userID does not exist.');
        return;
    }

    // Add info 
    playlistInfo.id = playlistID;
    playlistInfo.name = result.rows[0].name;
    playlistInfo.userID = userID;

    // Get the guild member associated with the id
    let member = boundGuild.members.cache.get(userID);
    if (member) { playlistInfo.userName = member.displayName; }

    // Get the playlist items
    var query = 'SELECT * FROM playlistitems WHERE playlist_id = $1 AND user_id = $2 ORDER BY index';
    var params = [playlistID, userID];
    var err, result = await pgClient.query(query, params)
    if (err) { 
        console.log(err); 
        res.status(500).send('An error occurred while getting the playlist\'s items.');
        return; 
    }

    console.log('Got playlist!');

    // Add the items to the playlist
    for (item of result.rows) {
        // Get song info
        let songInfo = await getSongInfo(item.url, false);
        console.log(songInfo);

        playlistInfo.items.push({
            index: item.index,
            id: item.id,
            url: item.url,
            name: songInfo.name,
            thumbnail_url: songInfo.thumbnail_url,
            artist: songInfo.artist,
            duration: songInfo.duration
        });
    }

    res.status(200).send(JSON.stringify(playlistInfo));
});

app.post('/playlist/addToQueue', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let userID = req.body.userID;
    let playlistID = req.body.playlistID;

    // Check required content
    if (!userID) { res.status(400).send('No userID supplied.'); return; }
    if (!playlistID) { res.status(400).send('No playlistID supplied.'); return; }

    // Check if the playlist exists
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2';
    var params = [playlistID, userID];
    var err, result = await pgClient.query(query, params);
    if (err) { 
        console.log(err); 
        res.status(500).send('An error occurred while getting the playlist.'); 
        return;
    }

    if (result.rows.length === 0) {
        console.log('Playlist does not exist!');
        res.status(404).send('A playlist with that playlistID and userID does not exist.');
        return;
    }

    var query = 'SELECT * FROM playlistitems WHERE playlist_id = $1 AND user_id = $2 ORDER BY index';
    var params = [playlistID, userID];
    var err, result = await pgClient.query(query, params)
    if (err) { 
        console.log(err); 
        res.status(500).send('An error occurred while getting the playlist\'s items.');
        return; 
    }

    if (result.rows.length === 0) { 
        console.log('Insufficient playlist items');
        res.status(401).send('There are no items on this playlist');
        return;
    }

    // Get member associated with ID
    let userName = 'unknown via playlist.';
    let member = boundGuild.members.cache.get(userID);
    if (member) { userName = member.displayName + ' via playlist'; }

    // Add items to queue
    for (item of result.rows) { 
        console.log(item);

        // Add to queue
        await addToQueue(item.id, userName, true);
    }

    // Play song
    if (!isPlaying) { await playSong(member.voice.channel, false); }

    res.status(200).send('Playlist successfully queued!');
});

app.post('/playlist/create', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let userID = req.body.userID;
    let playlistName = req.body.playlistName;

    // Check required content
    if (!userID) { res.status(400).send('No userID supplied.'); return; }
    if (!playlistName) { res.status(400).send('No playlistName supplied.'); return; }

    // Check if a playlist with the same name already exists
    var query = 'SELECT * FROM playlists WHERE name = $1 AND user_id = $2';
    var params = [playlistName, userID];
    pgClient.query(query, params, function(err, result) {
        if (err) { 
            console.log(err); 
            res.status(500).send('An error occurred while creating that playlist.'); 
            return;
        }

        if (result.rows.length > 0) {
            console.log('Playlist already exists!');
            res.status(409).send('A playlist with that playlistName and userID already exists.'); 
            return;
        }

        // Create the playlist
        query = 'INSERT INTO playlists (name, user_id) VALUES ($1, $2)';
        params = [playlistName, userID];
        pgClient.query(query, params, function(err, result) {
            if (err) { 
                console.log(err); 
                res.status(500).send('An error occurred while creating that playlist.'); 
                return;
            }

            console.log('Created playlist!');
            res.status(200).send('Playlist successfully created.'); 
        });
    });
});

app.post('/playlist/edit', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let playlistID = req.body.playlistID;
    let userID = req.body.userID;
    let newPlaylistName = req.body.newPlaylistName;

    // Check required content
    if (!playlistID) { res.status(400).send('No playlistID supplied.'); return; }
    if (!userID) { res.status(400).send('No userID supplied.'); return; }
    if (!newPlaylistName) { res.status(400).send('No newPlaylistName supplied.'); return; }

    // Check if that playlist exists
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2';
    var params = [playlistID, userID];
    pgClient.query(query, params, function(err, result) {
        if (err) { 
            console.log(err); 
            res.status(500).send('An error occurred while editing that playlist.'); 
            return;
        }

        if (result.rows.length === 0) {
            console.log('Playlist does not exist!');
            res.status(404).send('A playlist with that playlistID and userID does not exist.'); 
            return;
        }

        // Edit the playlist
        query = 'UPDATE playlists SET name = $1 WHERE id = $2 AND user_id = $3';
        params = [newPlaylistName, playlistID, userID];
        pgClient.query(query, params, function(err, result) {
            if (err) { 
                console.log(err); 
                res.status(500).send('An error occurred while editing that playlist.'); 
                return;
            }

            console.log('Edited playlist!');
            res.status(200).send('Playlist successfully edited.'); 
        });
    });
});

app.post('/playlist/song/add', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let playlistID = req.body.playlistID;
    let userID = req.body.userID;
    let song = req.body.song;

    // Check required content
    if (!playlistID) { res.status(400).send('No playlistID supplied.'); return; }
    if (!userID) { res.status(400).send('No userID supplied.'); return; }
    if (!song) { res.status(400).send('No song provided.'); return; }

    // Get song info
    let songInfo = await getSongInfo(song, true);

    // Check if that playlist exists
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2';
    var params = [playlistID, userID];
    pgClient.query(query, params, function(err, result) {
        if (err) { 
            console.log(err); 
            res.status(500).send('An error occurred while adding the song to that playlist.');
            return; 
        }

        if (result.rows.length === 0) {
            console.log('Playlist does not exist!');
            res.status(404).send('A playlist with that playlistID and userID does not exist.'); 
            return;
        }

        // Add the song to the playlist
        query = 'INSERT INTO playlistitems (id, playlist_id, url, user_id) VALUES ($1, $2, $3, $4) RETURNING index;';
        params = [songInfo.id, playlistID, songInfo.url, userID];
        pgClient.query(query, params, function(err, result) {
            if (err) { 
                console.log(err); 
                res.status(500).send('An error occurred while adding the song to that playlist.');
                return; 
            }

            console.log('Added song to playlist!');
            res.status(200).send(JSON.stringify(result.rows[0].index)); 
        });
    });
});

app.post('/playlist/song/remove', cors(corsOptions), async function (req, res) { 

    // Collect variables
    let playlistID = req.body.playlistID;
    let userID = req.body.userID;
    let songIndex = req.body.songIndex;

    // Check required content
    if (!playlistID) { res.status(400).send('No playlistID supplied.'); return; }
    if (!userID) { res.status(400).send('No userID supplied.'); return; }
    if (!songIndex) { res.status(400).send('No songIndex provided.'); return; }

    // Check if that playlist exists
    var query = 'SELECT * FROM playlists WHERE id = $1 AND user_id = $2';
    var params = [playlistID, userID];
    pgClient.query(query, params, function(err, result) {
        if (err) { 
            console.log(err); 
            res.status(500).send('An error occurred while removing the song from that playlist.'); 
            return;
        }

        if (result.rows.length === 0) {
            console.log('Playlist does not exist!');
            res.status(404).send('A playlist with that playlistID and userID does not exist.'); 
            return;
        }

        // Remove the song from the playlist
        query = 'DELETE FROM playlistitems WHERE playlist_id = $1 AND user_id = $2 AND index = $3';
        params = [playlistID, userID, songIndex];
        pgClient.query(query, params, function(err, result) {
            if (err) { 
                console.log(err); 
                res.status(500).send('An error occurred while removing the song from that playlist.'); 
                return;
            }

            console.log('Removed song from playlist!');
            res.status(200).send('Song successfully removed from that playlist.'); 
        });
    });
});



// SIGN IN ENDPOINT -------------------------------------------------------------------
app.post('/authenticate', cors(corsOptions), async function (req, res) {

    // Collect variables
    let payload = req.body;

    // Check required content
    if (!payload.guilds) { res.send('No guilds!'); return; }

    // find correct guild
    let guild = payload.guilds.find(guild => guild.id === config.bot.guildID);

    if (!guild) { res.status(401).send('No guild found!'); return; }
    else { res.status(200).send('Guild found'); }
});



// TIMER ------------------------------------------------------------------------------
setInterval(async function () {
    if (isPlaying && !isPaused) { 
        durationTime += 1;
    }
}, 1000);



// RUN BOT
client.login(config.bot.discordAPIKey);

// RUN SERVER
const port = process.env.PORT || config.webClient.port;
app.listen(port, () => console.log('Running on port', port));