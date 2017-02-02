var Artist = require('../models/Artist.js')

app.get('/artists', function (req, res) {
  Artist.findAll(function (err, artists) {
    res.json(artists)
  })
})

app.get('/artists/:id', function (req, res) {
  var id = req.params.id
  Artist.where(id, function (err, artist) {
    res.json(artist)
  })
})