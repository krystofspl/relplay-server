var Album = require('../models/Album.js')
var Track = require('../models/Track.js')
var Label = require('../models/Label.js')
var path = require('path')

app.get('/tracks', function (req, res) {
  Track.compose(Album, 'album', 'HAS_ALBUM')
  Track.compose(Label, 'labels', 'HAS_LABEL', {many: true})
  Track.findAll(function (err, tracks) {
    tracks.forEach(track => {
      if (track.album) {
        track.album = track.album.id
      }
      if (track.labels) {
        track.labels = track.labels.map(label => label.id)
      } else {
        track.labels = []
      }
    })
    res.json(tracks)
  })
})

// TODO Uses this route suffix because of a bug on Howler.js's side - needs .mp3 in URL
app.get('/tracks/:id/file.mp3', function (req, res) {
  sync.fiber(() => {
    var track = sync.await(Track.read(parseInt(req.params.id), sync.defer()))
    var filePath = track.filePath
    res.set('Content-Type', 'audio/mpeg3')
    res.sendFile(path.join(global.libraryPath, filePath))
  })
})

app.patch('/tracks/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Track.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Track with specified ID doesn\'t exist')
        return
      }
      var nodeData = {
        id: parseInt(req.params.id)
      }
      var track = null
      var newLabels = null

      // TODO all track params
      var request = req.body

      // Take attributes data from the request
      if (request.title) {nodeData.title = request.title}
      if (request.trackNr) {nodeData.trackNr = request.trackNr}
      if (request.diskNr) {nodeData.diskNr = request.diskNr}
      if (request.playCount) {nodeData.playCount = request.playCount}
      if (request.filePath) {nodeData.filePath = request.filePath}
      // TODO albumId, lyrics

      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      if (request.labels) {newLabels = request.labels; delete request.labels}
      // Update track if there's some data present
      var argsCount = Object.keys(nodeData).length
      if (argsCount >= 2) {
        sync.await(Track.update(nodeData, sync.defer()))
      }/* else {
        res.status(422).send('No parameters supplied')
        return
      }*/

      // Obtain the new album with relevant rels embedded
      // TODO same query as in GET :id
      var query = ' \
        MATCH (track:Track)-[:HAS_ALBUM]->(album:Album) \
        WHERE ID(track) = {id} \
        WITH track, album \
        OPTIONAL MATCH (track)-[:HAS_LABEL*]->(label:Label) \
        RETURN DISTINCT track, ID(album) as album, collect(ID(label)) as labels \
      '
      result = sync.await(db.query(query, {id: parseInt(nodeData.id)}, sync.defer()))
      if (result.length < 1) {
        throw 'ERR: No track with id ' + nodeData.id
      }
      result = result[0]

      track = result.track // result is [{track:.., album: int, labels: int[], ...}]
      if (result.album) {track.album = result.album}
      if (result.labels) {
        track.labels = result.labels
      } else {
        track.labels = []
      }
      // Update related entities if requested
      var tx = db.batch()
      // Update and set new labels if present
      if (newLabels) {
        // Delete old label rels
        tx.query('MATCH (track:Track)-[r:HAS_LABEL]->(Label) WHERE ID(track)={id} DELETE r', {id: parseInt(nodeData.id)})
        // Add new label rels
        track.labels = []
        newLabels.forEach(labelId => {
          tx.relate(nodeData.id, 'HAS_LABEL', labelId)
          track.labels.push(labelId)
        })
      }
      sync.await(tx.commit(sync.defer()))

      res.json(track)
      return
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})