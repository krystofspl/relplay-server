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
      WHERE ID(playlist) = {playlistId} \
      WITH playlist \
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

app.delete('/playlists/:id', function (req, res) {
  sync.fiber(function () {
    try {
      var id = parseInt(req.params.id)
      if (isNaN(id) || !sync.await(Playlist.exists(id, sync.defer()))) {
        res.status(404).send('Playlist with specified ID doesn\'t exist')
        return
      }
      var query = ' \
      MATCH (playlist:Playlist) \
      WHERE ID(playlist) = {id} \
      WITH playlist \
      OPTIONAL MATCH (playlist)-[r]-() \
      DELETE r, playlist \
      '
      sync.await(db.query(query, {id: id}, sync.defer()))
      res.status(200).end()
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

// Expects {name: String, trackIds: [track ids in order]}
app.post('/playlists', function (req, res) {
  sync.fiber(function () {
    try {
      var nodeData = {}
      var playlist = null
      var trackIds = []

      var request = req.body
      // Take attributes data from the request
      if (request.name) {nodeData.name = request.name}
      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      if (request.trackIds) {trackIds = request.trackIds; delete request.trackIds}

      // Create playlist
      playlist = sync.await(Playlist.save(nodeData, sync.defer()))

      // Obtain new genre along with relevant rels embedded
      var query = ' \
        MATCH (playlist:Playlist) \
        WHERE ID(playlist) = {id} \
        RETURN playlist \
      '
      result = sync.await(db.query(query, {id: parseInt(playlist.id)}, sync.defer()))
      if (result.length < 1) {
        throw 'ERR: No playlist with id ' + playlist.id
      }
      playlist = result[0]

      // Create rels if requested
      playlist.tracks = []
      if (trackIds && trackIds.length) {
        trackIds.forEach((trackId, index) => {
          sync.await(db.relate(trackId, 'IS_IN_PLAYLIST', playlist.id, {position: index}, sync.defer()))
          playlist.tracks.push({ id: trackId, position: index })
        })
      }

      res.status(201).location(global.serverAddr + 'playlists/' + playlist.id).json(playlist)
      return
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

// Expects {name: String, trackIds: [track ids in order]}
app.patch('/playlists/:id', function (req, res) {
  sync.fiber(function () {
    try {
      var playlistId = parseInt(req.params.id)
      if (isNaN(playlistId) || !sync.await(Playlist.exists(playlistId, sync.defer()))) {
        res.status(404).send('Playlist with specified ID doesn\'t exist')
        return
      }
      var nodeData = {
        id: playlistId
      }
      var playlist = null
      var trackIds = 'nothing'

      var request = req.body
      // Take attributes data from the request
      if (request.name) {nodeData.name = request.name}
      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      // Can be an empty array, in that case, tracks will be deleted
      if ('trackIds' in request) {trackIds = request.trackIds; delete request.trackIds}

      // Update genre if there's ID and some data present
      var argsCount = Object.keys(nodeData).length
      if (argsCount >= 2) {
        sync.await(Playlist.update(nodeData, sync.defer()))
      }/* else {
        res.status(422).send('No parameters supplied')
        return
      }*/

      // Obtain new genre along with relevant rels embedded
      // TODO query same as in GET
      var query = ' \
        MATCH (playlist:Playlist) \
        WHERE ID(playlist) = {playlistId} \
        WITH playlist \
        OPTIONAL MATCH (playlist)-[r:IS_IN_PLAYLIST]-(t:Track) \
        WHERE ID(playlist) = {playlistId} \
        WITH playlist, r.position as pos, ID(t) as track \
        RETURN ID(playlist) as id, playlist.name as name, COLLECT({position: pos, id: track}) as tracks \
      '
      result = sync.await(db.query(query, {playlistId: playlistId}, sync.defer()))
      if (result.length < 1) {
        throw 'ERR: No playlist with id ' + playlistId
      }

      playlist = result[0]

      // Update related entities if requested
      var tx = db.batch()
      // Update and set new tracks if present
      if (trackIds !== 'nothing') { // has been set to array of length >= 0
        // Delete old track rels
        tx.query('MATCH (playlist:Playlist)-[r:IS_IN_PLAYLIST]-(track:Track) WHERE ID(genre)={playlistId} DELETE r', {playlistId: playlistId})
        // Add new track rels; if null, just delete
        if (trackIds.length) { // is non empty array
          playlist.tracks = []
          trackIds.forEach((trackId, index) => {
            tx.relate(trackId, 'IS_IN_PLAYLIST', playlistId, { position: index })
            playlist.tracks.push({ id: trackId, position: index })
          })
        }
      }
      sync.await(tx.commit(sync.defer()))

      res.json(playlist)
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

  // Fill the pool with the trackIds
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

      // Remove seed trackIds from pool
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