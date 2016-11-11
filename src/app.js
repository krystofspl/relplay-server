var express = require('express')
var app = express()

global.db = require('seraph')({
  server: 'http://localhost:7474',
  user: 'neo4j',
  pass: 'password'
})

var bodyParser = require('body-parser')
app.use(bodyParser.json())

var Track = require('./models/Track.js')
var Album = require('./models/Album.js')
var Artist = require('./models/Artist.js')

app.get('/', function (req, res) {
  res.send('Hello World!')
})

app.get('/artists/:id', function (req, res) {
  var id = req.params.id
  var artistData = {}
  Artist.read(id, function (err, artist) {
    artistData = artist
  })
  res.json(artistData)
})

app.get('/artists', function (req, res) {
  var artistsData = []
  Artist.findAll(function (err, artists) {
    artistsData = artists
  })
  res.json(artistsData)
})

app.listen(8079, function () {
  console.log('Graph Music Library backend listening at localhost:8079!')
})