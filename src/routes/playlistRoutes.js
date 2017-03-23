var Playlist = require('../models/Playlist.js')

var _ = require('lodash')

app.get('/playlists', function (req, res) {
  var query = ' \
  MATCH (playlist:Playlist) \
  OPTIONAL MATCH (playlist)-[r:IS_IN_PLAYLIST]-(t:Track) \
  WITH playlist, r.position as pos, ID(t) as track \
  RETURN ID(playlist) as id, playlist.name as name, COLLECT({position: pos, id: track}) as tracks \
  '
  db.query(query, function (err, result) {
    console.log(err)
    res.json(result)
  })
})

app.get('/playlists/:id', function (req, res) {
  sync.fiber(function () {
    try {
      var playlistId = parseInt(req.params.id)
      if (isNaN(playlistId) || !sync.await(Playlist.exists(playlistId, sync.defer()))) {
        res.status(404).send('Playlist with specified ID doesn\'t exist')
        return
      }
      var query = ' \
      MATCH (playlist:Playlist) \
      OPTIONAL MATCH (playlist)-[r:IS_IN_PLAYLIST]-(t:Track) \
      WHERE ID(playlist) = {playlistId} \
      WITH playlist, r.position as pos, ID(t) as track \
      RETURN ID(playlist) as id, playlist.name as name, COLLECT({position: pos, id: track}) as tracks \
      '
      var result = sync.await(db.query(query, {playlistId: playlistId}, sync.defer()))
      if (result && result.length) {
        result = result[0]
        res.json(result)
      }
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.post('/playlists/generator', function (req, res) {
  var request = req.body
  var seed = null
  if (request.seedTrackIds) {
    seed = _.castArray(request.seedTrackIds)
  }
  var usedTrackIds = _.castArray(_.compact(request.usedTrackIds)) // ensures no falsey values
  console.log(seed)
  console.log(usedTrackIds)
  var n = request.n || 3
  if (!seed) {
    res.status(400).send('Parameters seedTrackIds and usedTrackIds must be present.')
    return
  }

  var newTrackIdsPool = []

  // Fill the pool with the tracks
  sync.fiber(() => {
    try {
      // Array of [query, multiplier(priority)]
      var queries = []

      // Track->Album->SIMILAR_TO->Album(s)->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:SIMILAR_TO]-(album2:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 5])
      // Track->Album->Artist->SIMILAR_TO->Artist->Album(s)->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:HAS_MAIN_ARTIST|:HAS_ARTIST]-(artist:Artist)-[:SIMILAR_TO]-(artist:Artist)-[:HAS_MAIN_ARTIST|:HAS_ARTIST]-(album2:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 4])
      // Track->HAS_LABEL->Label->Tracks/Album(s)->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_LABEL]-(label:Label)-[:HAS_LABEL]-(album2:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      UNION \
      MATCH (seedTrack:Track)-[:HAS_LABEL]-(label:Label)-[:HAS_LABEL]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 3])
      // Track->Album->HAS_LABEL->Label->Tracks/Album(s)->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:HAS_LABEL]-(label:Label)-[:HAS_LABEL]-(album2:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      UNION \
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:HAS_LABEL]-(label:Label)-[:HAS_LABEL]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 3])
      // Track->Album->HAS_GENRE->Genres->Albums->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:HAS_GENRE]-(genre:Genre)-[:HAS_GENRE]-(album2:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 2])
      // Track->Album->Main Artist->Albums->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:HAS_MAIN_ARTIST|:HAS_ARTIST]-(artist:Artist)-[:HAS_MAIN_ARTIST|:HAS_ARTIST]-(album2:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 2])
      // Track->Album->Tracks
      queries.push(['\
      MATCH (seedTrack:Track)-[:HAS_ALBUM]-(album:Album)-[:HAS_ALBUM]-(newTrack:Track) \
      WHERE ID(seedTrack) IN {seedTrackIds} AND NOT ID(newTrack) IN {usedTrackIds} \
      WITH DISTINCT newTrack ORDER BY RAND() LIMIT 10 \
      RETURN COLLECT(ID(newTrack)) \
      ', 1])
      // TODO Fallback - generate something randomly

      // Execute the queries, add to pool
      var i = 0
      queries.forEach(queryItem => {
        var result = sync.await(db.query(queryItem[0], {seedTrackIds: seed, usedTrackIds: usedTrackIds}, sync.defer()))
        if (result && result.length) {
          var result = result[0]
          // console.log('Adding '+result.length*queryItem[1]+' items for query '+i)
          // console.log(result)
          // Add items queryItem[1]-times
          for (let i = 0; i < queryItem[1]; i++) {
            newTrackIdsPool = newTrackIdsPool.concat(result)
          }
        }
        i++
      })

      // Remove seed tracks from pool
      newTrackIdsPool = _.compact(newTrackIdsPool.filter(item => {
        return seed.indexOf(item) === -1
      }))

      // Randomly select n values
      var selectedTrackIds = []
      var randomIndices = []
      for (let i = 0; i < n && i < newTrackIdsPool.length; i++) {
        var max = newTrackIdsPool.length - 1 // Maximum possible index, min is 0
        var generatedIndex = -1
        var tryCounter = 0 // We don't want an infinite loop if there are no viable candidates
        // Select unique values if possible
        while (tryCounter < newTrackIdsPool.length * 2 && (generatedIndex == -1 || randomIndices.indexOf(generatedIndex) != -1 || selectedTrackIds.indexOf(newTrackIdsPool[generatedIndex]) != -1)) {
          generatedIndex = Math.floor(Math.random() * max)
          tryCounter++
        }
        if (tryCounter < newTrackIdsPool.length * 2) {
          randomIndices.push(generatedIndex)
          selectedTrackIds.push(newTrackIdsPool[generatedIndex])
        }
      }
      res.json(selectedTrackIds)
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})