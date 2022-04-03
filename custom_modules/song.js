/**
 * Handles searching and song-specific functions & routes
 */

// MODULES -------------------------------------------------------
const express = require('express');
const router = express.Router();
const youtubedl = require('youtube-dl-exec');


// VARIABLES -----------------------------------------------------
const youtubeDlParams = {
    dumpSingleJson: true,
    forceIpv4: true,
    defaultSearch: 'auto'
}


// FUNCTIONS -----------------------------------------------------
/** Searches YouTube for a video based on an URL or query. Will return a list of results.
 * @param {String} query A YouTube URL or search query to send. If this is an individual video URL, the limit param will be ignored and only this video will be returned.
 * @param {Number} limit The maximum number of results to return.
 */
async function getSongInfo(query, limit) {

    let resultList = [];

    // Check if the query is an URL 
    if (query.includes('youtu.be') || query.includes('youtube.com')) { 

        // [ TODO ] Check if this is a YouTube Shorts or Playlist link

        // This query is likely to be an URL, check to see if a valid video can be retrieved
        try { 
            let output = await youtubedl(query, youtubeDlParams);
            const outputInfo = JSON.parse(JSON.stringify(output));

            let songInfo = { 
                url: 'https://youtu.be/' + outputInfo.id,
                name: outputInfo.title,
                id: outputInfo.id,
                duration: outputInfo.duration,
                thumbnailUrl: outputInfo.thumbnail,
                artist: outputInfo.channel
            }
            resultList.push(songInfo);
        } catch (err) { 
            console.log(err)
            return false;
        }
    } else {

        // The query is most likely not a search query
        try { 
            let url = 'ytsearch' + limit + ':' + query;
            let output = await youtubedl(url, youtubeDlParams);
            const outputInfo = JSON.parse(JSON.stringify(output));

            for (item of outputInfo.entries) {
                let songInfo = {
                    url: 'https://youtu.be/' + item.id,
                    id: item.id,
                    name: item.title,
                    duration: item.duration,
                    thumbnailUrl: item.thumbnail,
                    artist: item.channel
                }
                resultList.push(songInfo);
            }
        } catch (err) { 
            console.log(err)
            return false;
        }
    }

    // Return the list
    return(resultList);
}

/** Retrieves & rebuilds the song object from the database
 * @param {PGCLIENT} pgClient PostgreSQL client object to run queries on
 * @param {Number} id The server-issued unique identifier for the song
 * @param {Number} queueIndex The queue index of the song (NOT EQUAL TO THE ID)
 * @param {Guild} discordGuild The Discord Guild object for this query
 */
async function retrieveSong(pgClient, id, queueIndex, discordGuild) { 

    if (!id) { 
        var query = 'SELECT * FROM queue WHERE queue_position = $1;';
        var params = [ queueIndex ];
    } else { 
        var query = 'SELECT * FROM queue WHERE id = $1;';
        var params = [ id ];
    }

    var err, result = await pgClient.query(query, params);
    if (err || result.rows.length === 0) { return false; }

    let songInfo = {
        itemID: result.rows[0].id,
        queuePosition: result.rows[0].queue_position,
        name: result.rows[0].name,
        artist: result.rows[0].artist,
        duration: result.rows[0].duration,
        youtubeUrl: 'https://youtu.be/' + result.rows[0].youtube_id,
        thumbnailUrl: result.rows[0].thumbnail_url,
        userID: result.rows[0].user_id
    }

    // Get the item's associated user's information
    let userInfo = await discordGuild.members.fetch(result.rows[0].user_id);
    songInfo.username = userInfo.displayName || 'Unknown';
    return(songInfo);
}


// ROUTES --------------------------------------------------------
router.get('/search', async function(req, res) { 

    // Get essential variables
    const searchQuery = req.query.searchQuery;
    const searchLimit = req.query.searchLimit || 10;

    if (!searchQuery) { res.status(400).send('Missing searchQuery parameter.'); return; }

    let songInfo = await getSongInfo(searchQuery, searchLimit);

    // Return to caller
    if (songInfo === false) { res.status(500).send('Internal server error.'); return; }

    res.status(200).send(JSON.stringify(songInfo));
});


// EXPORT --------------------------------------------------------
module.exports = {
    songRouter: router,
    getSongInfo: getSongInfo,
    retrieveSong: retrieveSong
};