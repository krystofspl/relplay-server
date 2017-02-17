var Album = require('../models/Album.js')
var Track = require('../models/Track.js')
var path = require('path')

app.get('/tracks', function (req, res) {
  Track.compose(Album, 'album', 'HAS_ALBUM')
  Track.findAll(function (err, tracks) {
    tracks.forEach(track => {if (track.album) track.album = track.album.id})
    res.json(tracks)
  })
})

app.get('/tracks/:id/file.mp3', function (req, res) {
  sync.fiber(() => {
    var track = sync.await(Track.read(parseInt(req.params.id), sync.defer()))
    var filePath = track.filePath
    res.set('Content-Type', 'audio/mpeg3')
    res.sendFile(path.join(global.libraryPath, filePath))
  })
})