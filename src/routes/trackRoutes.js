var Album = require('../models/Album.js')
var Track = require('../models/Track.js')

app.get('/tracks', function (req, res) {
  Track.compose(Album, 'album', 'HAS_ALBUM')
  Track.findAll(function (err, tracks) {
    tracks.forEach(track => {if (track.album) track.album = track.album.id})
    res.json(tracks)
  })
})