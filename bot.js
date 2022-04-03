// MODULES ----------------------------------------------------------------------------
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { Client, Intents } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES, Intents.FLAGS.GUILD_MEMBERS] });

const express = require('express');
const cors = require('cors');

const request = require('request');


// CUSTOM MODULES ---------------------------------------------------------------------
const { websocketConnection } = require('./custom_modules/websocket.js');
const { queueRouter, getQueue, getHistory, addToQueue, removeFromQueue, getItem, getQueuePosition, setIsQueueLooping, isQueueLooping } = require('./custom_modules/queue.js');
const { playbackRouter, beginPlayback, skipSong, isPlayerActive, stopPlayback, pausePlayback, resumePlayback, nowPlaying, isPlayerPaused } = require('./custom_modules/playback.js');
const { playlistRouter, listPlaylists, getPlaylist, createPlaylist, editPlaylist, deletePlaylist, addPlaylistSong, removePlaylistSong, queuePlaylist } = require('./custom_modules/playlist.js');
const { songRouter, getSongInfo } = require('./custom_modules/song.js');


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
const expressWs = require('express-ws')(app);   // Although this variable is unused, it initialises necessary variables


// CORS MIDDLEWARE --------------------------------------------------------------------
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'accept, authorization, content-type, x-requested-with');
    res.setHeader('Access-Control-Allow-Credentials', true);

    next();
});


// VARIABLES ---------------------------------------------------------------------------
let boundTextChannel = null;
let boundVoiceChannel = null;
let boundGuild = null;


// COMMANDS ----------------------------------------------------------------------------
const commands = [{
    name: 'play',
    description: 'Searches YouTube for a song, then adds the first result to the queue.',
    options: [
        { type: 3, name: 'song', description: 'URL or search term for a song', required: true }
    ]
}, {
    name: 'add',
    description: 'Searches YouTube for a song, then adds the first result to the queue.',
    options: [
        { type: 3, name: 'song', description: 'URL or search term for a song', required: true }
    ]
}, {
    name: 'search',
    description: 'Searches YouTube for songs, returning a list of relevant results.',
    options: [
        { type: 3, name: 'song', description: 'URL or search term for a song', required: true },
        { type: 3, name: 'limit', description: 'The length of the list to return. Defaults to 6.', required: false, min_value: 1, max_value: 10 }
    ]
}, {
    name: 'lookup',
    description: 'Searches YouTube for songs, returning a list of relevant results.',
    options: [
        { type: 3, name: 'song', description: 'URL or search term for a song', required: true },
        { type: 3, name: 'limit', description: 'The length of the list to return. Defaults to 6.', required: false, min_value: 1, max_value: 10 }
    ]
}, {
    name: 'remove',
    description: 'If a song\'s index is provided, removes that item. Otherwise, skips the current song.',
    options: [
        { type: 4, name: 'song', description: 'The queue index of the song', required: false }
    ]
}, {
    name: 'skip',
    description: 'If a song\'s index is provided, removes that item. Otherwise, skips the current song.',
    options: [
        { type: 4, name: 'song', description: 'The queue index of the song', required: false }
    ]
}, {
    name: 'queue',
    description: 'Shows the queue of items to play next.'
}, {
    name: 'upnext',
    description: 'Shows the queue of items to play next.'
}, {
    name: 'history',
    description: 'Shows previously-played songs.'
}, {
    name: 'nowplaying',
    description: 'Shows the currently-playing song.'
}, {
    name: 'pause',
    description: 'Pauses/resumes the current song.'
}, {
    name: 'resume',
    description: 'pauses/resumes the current song.'
}, {
    name: 'stop',
    description: 'Stops the bot and clears the queue.'
}, { 
    name: 'loop',
    description: 'Toggles looping of the current queue.'
}, {
    name: 'playlist',
    description: 'Get or edit playlists & their items.',
    options: [
        { 
            name: 'get',
            description: 'Get or edit a playlist.',
            type: 2,
            options: [ 
                {
                    name: 'all',
                    description: 'Get a list of every playlist, including those that aren\'t yours.',
                    type: 1
                },
                {
                    name: 'mine',
                    description: 'Get a list of your playlists.',
                    type: 1
                },
                {
                    name: 'specific',
                    description: 'Get any particular playlist.',
                    type: 1,
                    options: [
                        { type: 4, name: 'id', description: 'The ID of the playlist', required: true }
                    ]
                }
            ]
        },
        {
            name: 'item',
            description: 'Get or edit a playlist\'s items.',
            type: 2,
            options: [
                {
                    name: 'add',
                    description: 'Adds an item to any of your playlists.',
                    type: 1,
                    options: [
                        { type: 4, name: 'playlist_id', description: 'The ID of the playlist', required: true },
                        { type: 3, name: 'song', description: 'URL or search term for a song', required: true }
                    ]
                },
                {
                    name: 'remove',
                    description: 'Removes an item from any of your playlists.',
                    type: 1,
                    options: [
                        { type: 4, name: 'playlist_id', description: 'The ID of the playlist', required: true },
                        { type: 4, name: 'song_id', description: 'The ID of the song in the playlist', required: true }
                    ]
                }
            ]
        },
        {
            name: 'delete',
            description: 'Deletes any of your playlists and all it\'s items. This cannot be undone.',
            type: 1,
            options: [
                { type: 4, name: 'id', description: 'The ID of the playlist', required: true },
                { type: 5, name: 'confirm', description: 'Confirm your action', required: true },
            ]
        },
        {
            name: 'edit',
            description: 'Edits any of your playlists.',
            type: 1,
            options: [
                { type: 4, name: 'id', description: 'The ID of the playlist', required: true },
                { type: 3, name: 'name', description: 'A new name for your playlist', required: false },
                { type: 3, name: 'description', description: 'A new description for your playlist. Can be up to 300 chracters', required: false },
                { type: 3, name: 'thumbnail_url', description: 'A new thumbnail for your playlist. This must link to a valid image to work', required: false },
            ]
        },
        {
            name: 'create',
            description: 'Creates a new playlist with the parameters you supply.',
            type: 1,
            options: [
                { type: 3, name: 'name', description: 'A name for your playlist', required: true },
                { type: 3, name: 'description', description: 'A description for your playlist. Can be up to 300 chracters', required: true },
                { type: 3, name: 'thumbnail_url', description: 'A thumbnail for your playlist. This must link to a valid image to work', required: true },
            ]
        },
        {
            name: 'queue',
            description: 'Adds the entirety of a playlist to the queue.',
            type: 1,
            options: [
                { type: 4, name: 'id', description: 'The ID of the playlist', required: true },
                { type: 5, name: 'confirm', description: 'Confirm your action', required: true },
            ]
        }
    ]
}];

const rest = new REST({ version: '9' }).setToken(config.bot.discordAPIKey);

// SETUP COMMANDS
(async () => { 
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands('948830655079395368', '618748256028983326'),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();



// HELPER FUNCTIONS --------------------------------------------------------------------
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

/** Checks if a given URL is a valid image link */
const isImgLink = (url) => {
    if (typeof url !== 'string') {
        return false;
    }
    return (url.match(/^http[^\?]*.(jpg|jpeg|gif|png|tiff|bmp)(\?(.*))?$/gmi) !== null);
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

    // Get info
    const displayColor = interaction.guild.me.displayColor;
    const memberVoiceChannel = interaction.member.voice.channel;
    const botVoiceChannel = interaction.guild.me.voice.channel;
    let isInSameVoiceChannel = false;
    if (botVoiceChannel) { 
        isInSameVoiceChannel = botVoiceChannel.id === memberVoiceChannel.id;
    }

    // Assemble user & bot information
    /** These objects are identical to the user & bot information supplied in a GET request. */
    const userInfo = { 
        displayName: interaction.member.displayName,
        id: interaction.member.id,
        voiceChannel: memberVoiceChannel,
        guild: interaction.guild,
        isBot: (interaction.member.user.bot),
        isInVoiceChannel: (memberVoiceChannel),
        isInSameVoiceChannel: isInSameVoiceChannel
    }

    console.log(userInfo);

    // Assemble information about the current state of the bot
    const botInfo = {
        clientObject: client,
        voiceChannel: botVoiceChannel,
        boundTextChannel: boundTextChannel
    }


    console.log('NEW COMMAND ------------------------------------------------------------');
    console.log('User information:', userInfo);
    console.log('Bot information:', botInfo);
    console.log('------------------------------------------------------------------------');
    
    if (!interaction.isCommand()) return;

    // REGULAR ------------------------------------------------------------------------
    if (interaction.commandName === 'play' || interaction.commandName === 'add') {

        // Check if there is a voice channel
        if (!memberVoiceChannel) {
            const embed = { 
                title: 'You must be in a voice channel',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play an item, join a voice channel!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }

        // Check if they're in the same voice channel
        if (botVoiceChannel && !isInSameVoiceChannel) { 
            const embed = { 
                title: 'You must be in my voice channel',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, join the same voice channel as me!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }

        // Add song to queue
        let songQuery = interaction.options.data.find(option => option.name === 'song').value;
        if (!songQuery) {
            const embed = { 
                title: 'You didn\'t specify a song',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'Put in the URL, name or other query and I\'ll try to find your song.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }

        // Defer the reply
        interaction.deferReply();

        // Add the song to the queue
        let songInfo = await addToQueue(pgClient, songQuery, interaction.member.id, userInfo.guild);
        if (songInfo === false) { 
            const embed = { 
                title: 'No song found',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'I had trouble finding that song. Something may have gone wrong, but try with broader search terms.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.editReply({
                embeds: [ embed ]
            }); return; 
        }

        // Return a message
        let embed = { 
            title: songInfo.name + ' by ' + songInfo.artist,
            url: songInfo.url,
            color: displayColor,
            description: 'Added to the queue!',
            image: {
                url: songInfo.thumbnailUrl,
                height: 200,
                width: 200
            },
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        interaction.editReply({
            embeds: [ embed ]
        });

        // Start playing
        if (isPlayerActive() === false) { 
            let playbackResponse = await beginPlayback(pgClient, botInfo.clientObject, userInfo.voiceChannel, boundTextChannel);
            if (playbackResponse === false) { 
                embed = { 
                    title: 'Unable to play song',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'Something went wrong. If this issue persists, let @zaccomode know.',
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }

                interaction.editReply({ embeds: [ embed ]}); 
            }
        }
    }
 
    if (interaction.commandName === 'skip' || interaction.commandName === 'remove') {

        // Check if the bot is in a voice channel
        if (!botVoiceChannel) { 
            const embed = { 
                title: 'I\'m not playing anything',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, use `/play` or `/add`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Check if the member is in the voice channel
        if (botVoiceChannel && !isInSameVoiceChannel) {
            const embed = { 
                title: 'You must be in my voice channel',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To skip or remove something, join the same voice channel as me!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }

        // Defer the reply
        interaction.deferReply();

        // Attempt to remove the song
        let queueIndex = interaction.options.data.find(option => option.name === 'song');
        if (!queueIndex || queueIndex.value === getQueuePosition()) {       // The user intends to skip the currently-playing song

            let skipResponse = await skipSong(pgClient, botInfo.clientObject, memberVoiceChannel, boundTextChannel);
            if (skipResponse === false) {   // Stop playback - there's nothing left in the queue

                await stopPlayback(pgClient, botInfo.clientObject);

                const embed = { 
                    title: 'There\'s nothing left to play',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'The queue is empty! I\'m going to take a break.',
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
    
                interaction.editReply({
                    embeds: [ embed ]
                }); return; 
            } else {
                interaction.editReply('Skipping...');    
            }

        } else {                // The user intends to skip an upcoming song
            queueIndex = queueIndex.value;

            // Check if this item actually exists
            let itemInfo = await getItem(pgClient, null, queueIndex);
            if (itemInfo === false) { 
                const embed = { 
                    title: 'This item doesn\'t exist',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'The song you\'re trying to remove doesn\'t seem to exist. Try another.',
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
    
                interaction.editReply({
                    embeds: [ embed ]
                }); return; 
            }

            let response = await removeFromQueue(pgClient, queueIndex);
            if (response === false) { 
                const embed = { 
                    title: 'Something went wrong',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'It looks like something went wrong! Try again shortly, and if this issue persists let @zaccomode know.',
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
    
                interaction.editReply({
                    embeds: [ embed ]
                }); return; 
            }

            const embed = { 
                title: 'Item removed!',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: '**' + itemInfo.name + '** by **' + itemInfo.artist + '** has been removed from the queue.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.editReply({
                embeds: [ embed ]
            });
        }
    }

    if (interaction.commandName === 'queue' || interaction.commandName === 'upnext') {

        // Get the queue
        let queueItems = await getQueue(pgClient, interaction.guild);

        // Check if there are no items
        if (queueItems.length === 0) { 
            const embed = { 
                title: 'Nothing could be found',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'It looks like there\'s nothing in the queue! Add something with `/play` or `/add`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        let embed = { 
            title: 'Up next',
            url: 'https://mingleton.isaacshea.com/nowplaying.html',
            color: displayColor,
            fields: [],
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        if (isQueueLooping() === true) { embed.title = '🔁 • ' + embed.title; }

        let itemCount = 0;
        let moreItems = 0;
        for (item of queueItems) {
            if (itemCount >= 10) { moreItems++; continue; }
            itemCount++;

            let embedField = {
                name: item.name + ' by ' + item.artist,
                value: '[Added by @' + item.username + ' • ' + normaliseMinutes(item.duration) + ' • #' + item.queuePosition + '](' + item.youtubeUrl + ')',
                inline: false
            }
            embed.fields.push(embedField);
        }
        if (moreItems > 0) { embed.footer.text = moreItems + ' more items available on the web client'; }

        interaction.reply({ embeds: [ embed ] });
    }

    if (interaction.commandName === 'history') { 

        // Get the history
        let historyItems = await getHistory(pgClient, interaction.guild);
        console.log(historyItems);

        if (historyItems.length === 0) { 
            const embed = { 
                title: 'Nothing could be found',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'It looks like there\'s nothing in the history yet! This will be filled out as you start listening.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }

        let embed = { 
            title: 'What\'s already played',
            url: 'https://mingleton.isaacshea.com/nowplaying.html',
            color: displayColor,
            fields: [],
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        let itemCount = 0;
        let moreItems = 0;
        for (item of historyItems) {
            if (itemCount >= 10) { moreItems++; continue; }
            itemCount++;

            let embedField = {
                name: item.name + ' by ' + item.artist,
                value: '[Added by @' + item.username + ' • ' + normaliseMinutes(item.duration) + ' • #' + item.queuePosition + '](' + item.youtubeUrl + ')',
                inline: false
            }
            embed.fields.push(embedField);
        }
        if (moreItems > 0) { embed.footer.text = moreItems + ' more items available on the web client'; }

        interaction.reply({ embeds: [ embed ] });
    }

    if (interaction.commandName === 'nowplaying') { 

        let nowPlayingInfo = await nowPlaying(pgClient, interaction.guild);
        if (nowPlayingInfo === false) { 
            const embed = { 
                title: 'Nothing is playing',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'It looks like nothing is playing. Add something with `/add` or `/play`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }

        console.log(nowPlayingInfo);
        songInfo = nowPlayingInfo.songInfo;

        let embed = { 
            title: songInfo.name + ' by ' + songInfo.artist,
            url: 'https://mingleton.isaacshea.com/nowplaying.html',
            color: displayColor,
            description: '[Added by @' + songInfo.username + ' • ' + normaliseMinutes(nowPlayingInfo.playbackDuration) + '/' + normaliseMinutes(songInfo.duration) + '](' + songInfo.youtubeUrl + ')',
            image : { url: songInfo.thumbnailUrl },
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        if (nowPlayingInfo.isPlayerActive === false) { 
            embed.title = '⏹ • ' + embed.title;
        } else if (nowPlayingInfo.isPlayerPaused === true) { 
            embed.title = '⏸ • ' + embed.title;
        }

        interaction.reply({
            embeds: [ embed ]
        });
    }

    if (interaction.commandName === 'search' || interaction.commandName === 'lookup') { 

        // Search for song
        let songQuery = interaction.options.data.find(option => option.name === 'song');
        if (!songQuery) {
            const embed = { 
                title: 'You didn\'t specify a song',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'Put in the URL, name or other query and I\'ll try to find your song.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({
                embeds: [ embed ]
            }); return; 
        }
        songQuery = songQuery.value;
        let songLimit = interaction.options.data.find(option => option.name === 'limit');
        if (songLimit) { songLimit = songLimit.value; }
        else { songLimit = 6; }

        if (songLimit > 10) { songLimit = 10; }
        else if (songLimit < 1) { songLimit = 1; }

        // Defer the reply
        interaction.deferReply();

        // Search for the song
        let infoList = await getSongInfo(songQuery, songLimit);

        if (infoList === false) { 
            const embed = { 
                title: 'Nothing found',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'I had trouble finding anything. Something may have gone wrong, but try with broader search terms.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.editReply({
                embeds: [ embed ]
            }); return; 
        }

        console.log(infoList);

        let embed = { 
            title: 'What I found',
            url: 'https://mingleton.isaacshea.com/nowplaying.html',
            color: displayColor,
            fields: [],
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        for (item of infoList) {

            let embedField = {
                name: item.name,
                value: '[By ' + item.artist + ' • ' + normaliseMinutes(item.duration) + '](' + item.url + ')',
                inline: false
            }
            embed.fields.push(embedField);
        }

        interaction.editReply({ embeds: [ embed ] });
    }

    if (interaction.commandName === 'stop') {

        // Check if the bot is in a voice channel
        if (!botVoiceChannel) { 
            const embed = { 
                title: 'I\'m not playing anything',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, use `/play` or `/add`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Check if they're in the same voice channel
        if (botVoiceChannel && !isInSameVoiceChannel) { 
            const embed = { 
                title: 'You must be in my voice channel',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, join the same voice channel as me!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Stop playback
        let stopResult = await stopPlayback(pgClient, botInfo.clientObject);
        if (stopResult === false) { 
            const embed = { 
                title: 'Something went wrong',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'Try again, and if this issue persists let @zaccomode know.',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Send an updated to the user
        const embed = { 
            title: 'Stopped playback',
            url: 'https://mingleton.isaacshea.com/nowplaying.html',
            color: displayColor,
            description: 'Everything has been stopped and reset, ready for your next listening session.',
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        interaction.reply({ embeds: [ embed ] });
    }

    if (interaction.commandName === 'loop') {

        // Check if the bot is in a voice channel
        if (!botVoiceChannel) { 
            const embed = { 
                title: 'I\'m not playing anything',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, use `/play` or `/add`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Check if they're in the same voice channel
        if (botVoiceChannel && !isInSameVoiceChannel) { 
            const embed = { 
                title: 'You must be in my voice channel',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, join the same voice channel as me!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Set looping status
        setIsQueueLooping(!isQueueLooping());

        const embed = { 
            title: 'Looping is now ' + (isQueueLooping() ? 'enabled' : 'disabled'),
            url: 'https://mingleton.isaacshea.com/nowplaying.html',
            color: displayColor,
            footer: {
                text: 'For a better experience, try the web client!',
                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
            }
        }

        interaction.reply({ embeds: [ embed ] });
    }

    if (interaction.commandName === 'pause' || interaction.commandName === 'resume') { 

        // Check if the bot is in a voice channel
        if (!botVoiceChannel) { 
            const embed = { 
                title: 'I\'m not playing anything',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, use `/play` or `/add`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Check if they're in the same voice channel
        if (botVoiceChannel && !isInSameVoiceChannel) { 
            const embed = { 
                title: 'You must be in my voice channel',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'To play something, join the same voice channel as me!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }

            interaction.reply({ embeds: [ embed ] }); return; 
        }

        // Play/pause the current song
        let playbackResult = false;
        if (isPlayerPaused() === true) {
            playbackResult = resumePlayback();
        } else { 
            playbackResult = pausePlayback();
        }

        if (playbackResult === true) { 
            const embed = { 
                title: (isPlayerPaused() ? '⏸ Paused' : '▶️ Resumed') + ' playback',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }
            interaction.reply({ embeds: [ embed ] });
        } else {
            const embed = { 
                title: 'It looks like nothing is playing',
                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                color: displayColor,
                description: 'Add something with `/add` or `/play`!',
                footer: {
                    text: 'For a better experience, try the web client!',
                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                }
            }
            interaction.reply({ embeds: [ embed ] });
        }
    }

    // PLAYLISTS ----------------------------------------------------------------------
    if (interaction.commandName === 'playlist') { 

        // Get any subcommands & subcommand groups
        const interactionSubCommandGroup = interaction.options.getSubcommandGroup(false);
        const interactionSubCommand = interaction.options.getSubcommand(false);

        if (interactionSubCommandGroup === 'get') {         // Information about playlists

            if (interactionSubCommand === 'all' || interactionSubCommand === 'mine') {          // List all playlists
                
                // List all playlists 
                let getAllPlaylists = true;
                if (interactionSubCommand === 'mine') { getAllPlaylists = false; }
                let playlistList = await listPlaylists(pgClient, userInfo.id, userInfo.guild, getAllPlaylists);
                if (playlistList === false) { 
                    const embed = { 
                        title: 'Nothing was found',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'It looks like there\'s no playlists! That, or something went wrong. If you want to create your own playlist, use `/playlist create`!',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Create the response embed
                let embed = { 
                    title: 'Here\'s some playlists',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    fields: [],
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }

                // Create fields for every item
                let itemCount = 0;
                let leftOverItems = 0;
                for (item of playlistList) { 
                    if (itemCount > 9) { leftOverItems++; continue; }

                    let embedField = {
                        name: item.name + ' • #' + normaliseNumber(item.id, 2),
                        value: 'Created by @' + item.userDisplayName + ' • ' + item.description.substring(0, 47) + '...',
                        inline: false
                    }
                    embed.fields.push(embedField);
                }

                if (leftOverItems > 0) { 
                    embed.footer.text = leftOverItems + ' more items on the web client.';
                }
    
                interaction.reply({ embeds: [ embed ] }); return; 
            }

            if (interactionSubCommand === 'specific') {     // Information about one playlist
                
                // Assemble required values
                let playlistID = interaction.options.getInteger('id', false);

                // Check required values
                if (!playlistID) { 
                    const embed = { 
                        title: 'Missing ID',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Provide the ID of the playlist you want to find.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                let playlistInfo = await getPlaylist(pgClient, userInfo.id,  userInfo.guild, playlistID);
                if (playlistInfo === false) { 
                    const embed = { 
                        title: 'Unable to find playlist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'This playlist may not exist, or an error has occurred.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                let embed = { 
                    title: playlistInfo.name + ' • #' + normaliseNumber(playlistInfo.id, 2),
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'Created by @' + playlistInfo.userDisplayName + ' • ' + playlistInfo.description,
                    thumbnail: { 
                        url: playlistInfo.thumbnailUrl
                    },
                    fields: [],
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }

                // Create fields for the playlist's songs
                let songsField = { 
                    name: 'Songs',
                    value: ''
                }
                if (playlistInfo.songs.length === 0) { songsField.value = 'No songs yet.'; }
                else { 
                    for (item of playlistInfo.songs) { 
                        songsField.value += '#' + normaliseNumber(item.id, 2) + ' • [' + item.name + ' by ' + item.artist + ' • ' + normaliseMinutes(item.duration) + '](' + item.youtubeUrl + ') \n';
                    }
                }
                embed.fields.push(songsField);

                interaction.reply({ embeds: [ embed ] }); return; 
            }
        } else if (interactionSubCommandGroup === 'item') { // About playlist items

            if (interactionSubCommand === 'add') {          // Add an item to the playlist
                
                // Assemble required values
                let playlistID = interaction.options.getInteger('playlist_id', false);
                let song = interaction.options.getString('song', false);

                // Check required values
                if (!playlistID || !song) { 
                    const embed = { 
                        title: 'Missing essential values',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Please provide the ID of the playlist and a query or an URL for the song you want to add.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Defer the reply
                interaction.deferReply();

                // Check if this playlist exists & if the user has edit access
                const playlistInfo = await getPlaylist(pgClient, userInfo.id, userInfo.guild, playlistID);
                if (playlistInfo === false) { 
                    const embed = { 
                        title: 'This playlist does not exist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you are looking for couldn\'t be found.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }
                if (playlistInfo.hasEditAccess === false) { 
                    const embed = { 
                        title: 'Incorrect permissions',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'You cannot add items to this playlist because it\'s not yours to modify.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }

                // Get the song information
                let songInfoList = await getSongInfo(song, 1);
                const songInfo = songInfoList[0];
                if (songInfo === false) { 
                    const embed = { 
                        title: 'No song found',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'I had trouble finding that song. Something may have gone wrong, but try with broader search terms.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return; 
                }

                // Add to the playlist
                let addResult = await addPlaylistSong(pgClient, userInfo.id, playlistID, songInfo);
                if (addResult === false) { 
                    const embed = { 
                        title: 'Something went wrong',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you\'re looking for may not exist, or an error occurred.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return; 
                }

                const embed = { 
                    title: 'Song added!',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: '[**' + songInfo.name + '** by **' + songInfo.artist + '**](' + songInfo.youtubeUrl + ') was added to your playlist **' + playlistInfo.name + '**.',
                    image: { 
                        url: songInfo.thumbnailUrl
                    },
                    thumbnail: { 
                        url: playlistInfo.thumbnailUrl
                    },
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
                interaction.editReply({ embeds: [ embed ] }); return; 
            }

            if (interactionSubCommand === 'remove') {       // Remove an item from the playlist

                // Assemble required values
                let playlistID = interaction.options.getInteger('playlist_id', false);
                let songID = interaction.options.getInteger('song_id', false);

                // Check required values
                if (!playlistID || !songID) { 
                    const embed = { 
                        title: 'Missing essential values',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Please provide the ID of the playlist and the ID for the song you want to remove.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Defer the reply
                interaction.deferReply();

                // Check if this playlist exists & if the user has edit access
                const playlistInfo = await getPlaylist(pgClient, userInfo.id, userInfo.guild, playlistID);
                if (playlistInfo === false) { 
                    const embed = { 
                        title: 'This playlist does not exist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you are looking for couldn\'t be found.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }
                if (playlistInfo.hasEditAccess === false) { 
                    const embed = { 
                        title: 'Incorrect permissions',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'You cannot remove items from this playlist because it\'s not yours to modify.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }

                // Remove the item from the playlist
                let removeResponse = await removePlaylistSong(pgClient, userInfo.id, playlistID, songID, null);
                if (removeResponse === false) { 
                    const embed = { 
                        title: 'This item does not exist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'It looks like the item you want to remove doesn\'t exist, or another error occurred.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return; 
                }

                const embed = { 
                    title: 'Song removed!',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'That song was removed from your playlist **' + playlistInfo.name + '**.',
                    thumbnail: { 
                        url: playlistInfo.thumbnailUrl
                    },
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
                interaction.editReply({ embeds: [ embed ] }); return; 
            }
        } else {                                            // Other misc commands

            if (interactionSubCommand === 'create') {       // Create a playlist

                // Assemble required values 
                let playlistName = interaction.options.getString('name', false);
                let playlistDesc = interaction.options.getString('description', false);
                let playlistThumbnailURL = interaction.options.getString('thumbnail_url', false);

                console.log(playlistName, playlistDesc, playlistThumbnailURL);

                if (!playlistName || !playlistDesc || !playlistThumbnailURL) { 
                    const embed = { 
                        title: 'Missing essential values',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'To create a playlist, fill out all the values!',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Defer the reply
                interaction.deferReply();

                // Check if the thumbnail URL is a valid link
                if (!isImgLink(playlistThumbnailURL)) { 
                    const embed = { 
                        title: 'That\'s...not an URL',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Whatever you provided as a thumbnail URL is not an URL. Try something else.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.editReply({ embeds: [ embed ] }); return; 
                }

                // Check if anything can be found at the URL
                request(playlistThumbnailURL, function (err, response, body) { 
                    console.log('statuscode:', response && response.statusCode);

                    if (!(response && response.statusCode === 200)) {
                        const embed = { 
                            title: 'Invalid thumbnail URL',
                            url: 'https://mingleton.isaacshea.com/nowplaying.html',
                            color: displayColor,
                            description: 'I couldn\'t find anything at that URL. Try something else.',
                            footer: {
                                text: 'For a better experience, try the web client!',
                                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                            }
                        }
            
                        interaction.editReply({ embeds: [ embed ] }); return; 
                    }

                    // Create the playlist
                    createPlaylist(pgClient, userInfo.id, playlistName, playlistDesc, playlistThumbnailURL).then(createResponse => {
                        if (createResponse === false) { 
                            const embed = { 
                                title: 'Something went wrong',
                                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                                color: displayColor,
                                description: 'This playlist couldn\'t be created. A playlist with its name may already exist, or an internal error may have occurred.',
                                footer: {
                                    text: 'For a better experience, try the web client!',
                                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                                }
                            }
                
                            interaction.editReply({ embeds: [ embed ] }); return; 
                        }

                        const embed = { 
                            title: 'Playlist created',
                            url: 'https://mingleton.isaacshea.com/nowplaying.html',
                            color: displayColor,
                            description: 'Your playlist has been created! You can find it with `/playlist get mine`.',
                            footer: {
                                text: 'For a better experience, try the web client!',
                                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                            }
                        }
            
                        interaction.editReply({ embeds: [ embed ] });
                    });
                });
            }

            if (interactionSubCommand === 'edit') {         // Edit an existing playlist

                // Assemble required values 
                let playlistID = interaction.options.getInteger('id', false);
                let playlistName = interaction.options.getString('name', false);
                let playlistDesc = interaction.options.getString('description', false);
                let playlistThumbnailURL = interaction.options.getString('thumbnail_url', false);

                // Check if values are given
                if (!playlistID || (!playlistName && !playlistDesc && !playlistThumbnailURL)) { 
                    const embed = { 
                        title: 'Missing essential values',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'To edit a playlist, please provide its ID and at least one thing to change.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Defer the reply
                interaction.deferReply();

                // Check if this playlist exists & if the user has edit access
                const playlistInfo = await getPlaylist(pgClient, userInfo.id, userInfo.guild, playlistID);
                if (playlistInfo === false) { 
                    const embed = { 
                        title: 'This playlist does not exist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you are looking for couldn\'t be found.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }
                if (playlistInfo.hasEditAccess === false) { 
                    const embed = { 
                        title: 'Incorrect permissions',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'You cannot add items to this playlist because it\'s not yours to modify.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }

                // Verify thumbnail URL
                if (playlistThumbnailURL) { 
                    // Check if the thumbnail URL is a valid link
                    if (!isImgLink(playlistThumbnailURL)) { 
                        const embed = { 
                            title: 'That\'s...not an URL',
                            url: 'https://mingleton.isaacshea.com/nowplaying.html',
                            color: displayColor,
                            description: 'Whatever you provided as a thumbnail URL is not an URL. Try something else.',
                            footer: {
                                text: 'For a better experience, try the web client!',
                                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                            }
                        }
            
                        interaction.editReply({ embeds: [ embed ] }); return; 
                    }

                    // Check if anything can be found at the URL
                    request(playlistThumbnailURL, function (err, response, body) { 
                        console.log('statuscode:', response && response.statusCode);

                        if (!(response && response.statusCode === 200)) {
                            const embed = { 
                                title: 'Invalid thumbnail URL',
                                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                                color: displayColor,
                                description: 'I couldn\'t find anything at that URL. Try something else.',
                                footer: {
                                    text: 'For a better experience, try the web client!',
                                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                                }
                            }
                
                            interaction.editReply({ embeds: [ embed ] }); return; 
                        }

                        // Create the playlist
                        editPlaylist(pgClient, userInfo.id, playlistID, playlistName, playlistDesc, playlistThumbnailURL).then(editResponse => {
                            if (editResponse === false) { 
                                const embed = { 
                                    title: 'Something went wrong',
                                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                                    color: displayColor,
                                    description: 'This playlist couldn\'t be edited. A playlist with its name may already exist, or an internal error may have occurred.',
                                    footer: {
                                        text: 'For a better experience, try the web client!',
                                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                                    }
                                }
                    
                                interaction.editReply({ embeds: [ embed ] }); return; 
                            }

                            const embed = { 
                                title: 'Playlist edited',
                                url: 'https://mingleton.isaacshea.com/nowplaying.html',
                                color: displayColor,
                                description: 'Your playlist **' + playlistInfo.name + '** has been edited! You can find it with `/playlist get mine`.',
                                thumbnail: { 
                                    url: playlistInfo.thumbnailUrl
                                },
                                footer: {
                                    text: 'For a better experience, try the web client!',
                                    iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                                }
                            }
                
                            interaction.editReply({ embeds: [ embed ] });
                        });
                    });
                } else {
                    let editResponse = await editPlaylist(pgClient, userInfo.id, playlistID, playlistName, playlistDesc, playlistThumbnailURL);
                    if (editResponse === false) { 
                        const embed = { 
                            title: 'Something went wrong',
                            url: 'https://mingleton.isaacshea.com/nowplaying.html',
                            color: displayColor,
                            description: 'This playlist couldn\'t be edited. A playlist with its name may already exist, or an internal error may have occurred.',
                            footer: {
                                text: 'For a better experience, try the web client!',
                                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                            }
                        }
            
                        interaction.editReply({ embeds: [ embed ] }); return; 
                    }

                    const embed = { 
                        title: 'Playlist edited',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Your playlist **' + playlistInfo.name + '** has been edited! You can find it with `/playlist get mine`.',
                        thumbnail: { 
                            url: playlistInfo.thumbnailUrl
                        },
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.editReply({ embeds: [ embed ] });
                }
            }

            if (interactionSubCommand === 'delete') {       // Delete an existing playlist

                // Assemble required values 
                let playlistID = interaction.options.getInteger('id', false);
                let confirmDeletion = interaction.options.getBoolean('confirm', false);

                // Check required values
                if (!playlistID) { 
                    const embed = { 
                        title: 'Missing ID',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Provide the ID of the playlist you want to delete.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Check confirmation
                if (!confirmDeletion || confirmDeletion === false) { 
                    const embed = { 
                        title: 'Deletion cancelled',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'If you did this in error, type "True" instead of "False" in the Confirm section.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Defer the reply
                interaction.deferReply();

                // Check if this playlist exists & if the user has edit access
                const playlistInfo = await getPlaylist(pgClient, userInfo.id, userInfo.guild, playlistID);
                if (playlistInfo === false) { 
                    const embed = { 
                        title: 'This playlist does not exist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you are looking for couldn\'t be found.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }
                if (playlistInfo.hasEditAccess === false) { 
                    const embed = { 
                        title: 'Incorrect permissions',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'You cannot add items to this playlist because it\'s not yours to modify.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }

                // Delete the playlist
                let deleteResponse = await deletePlaylist(pgClient, userInfo.id, playlistID);
                if (deleteResponse === false) { 
                    const embed = { 
                        title: 'Unable to delete',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you want to delete may not exist or belong to you, or an error could have occurred.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return; 
                }

                const embed = { 
                    title: 'Playlist deleted',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
                interaction.editReply({ embeds: [ embed ] }); 
            }

            if (interactionSubCommand === 'queue') {        // Add a playlist to the queue

                // Check if there is a voice channel
                if (!memberVoiceChannel) {
                    const embed = { 
                        title: 'You must be in a voice channel',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'To play an item, join a voice channel!',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }

                    interaction.reply({
                        embeds: [ embed ]
                    }); return; 
                }

                // Check if they're in the same voice channel
                if (botVoiceChannel && !isInSameVoiceChannel) { 
                    const embed = { 
                        title: 'You must be in my voice channel',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'To play something, join the same voice channel as me!',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }

                    interaction.reply({
                        embeds: [ embed ]
                    }); return; 
                }
                
                // Assemble required values 
                let playlistID = interaction.options.getInteger('id', false);
                let confirmAction = interaction.options.getBoolean('confirm', false);

                // Check required values
                if (!playlistID) { 
                    const embed = { 
                        title: 'Missing ID',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'Provide the ID of the playlist you want to delete.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
        
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Check confirmation
                if (!confirmAction || confirmAction === false) { 
                    const embed = { 
                        title: 'Queueing cancelled',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'If you did this in error, type "True" instead of "False" in the Confirm section.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.reply({ embeds: [ embed ] }); return; 
                }

                // Defer the reply
                interaction.deferReply();

                // Check if this playlist exists
                const playlistInfo = await getPlaylist(pgClient, userInfo.id, userInfo.guild, playlistID);
                if (playlistInfo === false) { 
                    const embed = { 
                        title: 'This playlist does not exist',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you are looking for couldn\'t be found.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return;
                }

                // Add the playlist to the queue
                let queueResponse = await queuePlaylist(pgClient, playlistID, userInfo.guild);
                if (queueResponse === false) { 
                    const embed = { 
                        title: 'Unable to Queue',
                        url: 'https://mingleton.isaacshea.com/nowplaying.html',
                        color: displayColor,
                        description: 'The playlist you want to queue may not exist, or an error could have occurred.',
                        footer: {
                            text: 'For a better experience, try the web client!',
                            iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                        }
                    }
                    interaction.editReply({ embeds: [ embed ] }); return; 
                }

                let embed = { 
                    title: 'Playlist queued!',
                    url: 'https://mingleton.isaacshea.com/nowplaying.html',
                    color: displayColor,
                    description: 'Your playlist **' + playlistInfo.name + '** has been added to the queue!',
                    footer: {
                        text: 'For a better experience, try the web client!',
                        iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                    }
                }
                interaction.editReply({ embeds: [ embed ] }); 

                // Start playing
                if (isPlayerActive() === false) { 
                    let playbackResponse = await beginPlayback(pgClient, botInfo.clientObject, userInfo.voiceChannel, boundTextChannel);
                    if (playbackResponse === false) { 
                        embed = { 
                            title: 'Unable to play song',
                            url: 'https://mingleton.isaacshea.com/nowplaying.html',
                            color: displayColor,
                            description: 'Something went wrong. If this issue persists, let @zaccomode know.',
                            footer: {
                                text: 'For a better experience, try the web client!',
                                iconURL: 'https://mingleton.isaacshea.com/content/images/favicon.png'
                            }
                        }

                        interaction.editReply({ embeds: [ embed ]}); 
                    }
                }
            }
        }
    }
});



// DISCORD AUTH MIDDLEWARE ------------------------------------------------------------
app.use(async function discordInformation (req, res, next) {

    // Collect variables
    const discordID = req.query.discordID || req.body.discordID;
    if (!discordID) { res.status(400).send('No discordID parameter supplied.'); return; }

    if (!boundGuild) { res.status(500).send('Bot not yet initialised.'); return; }

    console.log('Retrieving Discord information for user', discordID);

    // Check if this user exists within the guild
    let thisMember = null;
    try {
        thisMember = await boundGuild.members.fetch(discordID);
    } catch(err) { res.status(400).send('DiscordID is invalid.'); return; }
    if (!thisMember) { res.status(400).send('DiscordID does not match any members in this guild.'); return; }

    // Get info
    const memberVoiceChannel = thisMember.voice.channel;
    const botVoiceChannel = boundGuild.me.voice.channel;

    // Check if this user is on the same voice channel
    let isInSameVoiceChannel = false;
    if (botVoiceChannel && memberVoiceChannel) { isInSameVoiceChannel = botVoiceChannel.id === memberVoiceChannel.id; }

    // Assemble guild & user information
    const userInfo = { 
        displayName: thisMember.displayName,
        id: thisMember.id,
        voiceChannel: memberVoiceChannel,
        guild: boundGuild,
        isBot: thisMember.user.bot,
        isInVoiceChannel: (memberVoiceChannel),
        isInSameVoiceChannel: isInSameVoiceChannel
    }

    console.log(userInfo);

    // Assemble information about the current state of the bot
    const botInfo = {
        clientObject: client,
        voiceChannel: botVoiceChannel,
        boundTextChannel: boundTextChannel,
    }

    req.pgClient = pgClient;
    req.discordClient = client;
    req.discordUserInfo = userInfo;
    req.discordBotInfo = botInfo;
    next();
});


// SERVER -----------------------------------------------------------------------------
app.get('/test', cors(corsOptions), async function (req, res) {  
    res.send('Hello World!');
});


// USER INFO ENDPOINT -----------------------------------------------------------------
/* This endpoint effectively replaces the 22w01a 'authenticate' endpoint as authentication is now handled as middleware */
app.get('/user-info', cors(corsOptions), async function (req, res) { 

    // Get this user's guild information
    let thisMember = await boundGuild.members.fetch(req.discordUserInfo.id);
    if (!thisMember) { res.status(404).send('DiscordID does not match any members in this guild.'); return; }

    // Compile & return important information
    let payload = {
        id: thisMember.id,
        displayName: thisMember.displayName,
        displayColor: thisMember.displayHexColor,
        avatar: thisMember.avatarURL({ dynamic: true }) || thisMember.user.avatarURL({ dynamic: true })
    }

    res.status(200).send(JSON.stringify(payload));
})



// ROUTES -----------------------------------------------------------------------------
app.use('/websocket', cors(corsOptions), websocketConnection);
app.use('/queue', cors(corsOptions), queueRouter);
app.use('/playback', cors(corsOptions), playbackRouter);
app.use('/song', cors(corsOptions), songRouter);
app.use('/playlist', cors(corsOptions), playlistRouter);


// RUN BOT
client.login(config.bot.discordAPIKey);

// RUN SERVER
const port = process.env.PORT || config.webClient.port;
app.listen(port, () => console.log('Running on port', port));