var express = require('express')
var app = express()

global.db = require('seraph')({
  server: 'http://localhost:7474',
  user: 'neo4j',
  pass: 'password'
})
//global.libraryPath = '/home/krystof/Code/School/graph_music_library/library/'
global.libraryPath = '/mnt/G/Hudba/Ef'
var fs = require('fs')
var path = require('path')

var bodyParser = require('body-parser')
app.use(bodyParser.json())

var uuid = require('node-uuid')
var sync = require('synchronize')

var Track = require('./models/Track.js')
var Album = require('./models/Album.js')
var Artist = require('./models/Artist.js')

//--------------------------------------------------------------------------------- ROUTES

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

function safeString(str) {
  return '' + str
}

app.get('/rescan', function (req, res) {  
  //TODO ??! make this responsive, scanning may be long, show progress, inform the user, prevent double scanning(adding)
  var recursive = require('recursive-readdir')
  var mediaTags = require('audio-metadata')
  var fs = require('fs')

  try {
    var oldData = {}
    var newData = {tracks: [], albums: {}, artists: {}, relationships: {}}
    var newDataDb = {tracks: {}, albums: {}, artists: {}}
    sync.fiber(function () {
      //TODO only return needed attributes to save time & bandwidth
      oldData.tracks = sync.await(Track.findAll(sync.defer())).reduce((map, obj) => {
        map[obj.filePath] = {trackId: obj.trackId, id: obj.id}
        return map
      }, {})
      oldData.artists = sync.await(Artist.findAll(sync.defer())).reduce((map, obj) => {
        map[obj.name] = {artistId: obj.artistId, id: obj.id}
        return map
      }, {})

      var files = sync.await(recursive(libraryPath, [], sync.defer()))
      var tx = db.batch()
      Track.db = tx
      files.forEach(file => {
        if(!['mp3', 'flac'].includes(file.split('.').pop().toLowerCase()) || !file) {return}
        if(!(file in oldData.tracks)) {
          var tag = mediaTags.id3v1(fs.readFileSync(file))
          if (!tag) {return}
          //console.log(tag)
          try {
            Track.save({
              trackId: uuid.v4(),
              title: safeString(tag.title),
              trackNr: safeString(tag.track).replace(/(^\d+)(.+$)/i,'$1'),
              filePath: file                  
            }, (err, track) => {
              newDataDb.tracks[safeString(track.trackId)] = track
              //TODO assuming there are no two albums with the same name during the import
              //TODO year
              newData.albums[safeString(tag.album)] = null
              newData.artists[safeString(tag.artist)] = null
              newData.relationships[safeString(track.trackId)] = newData.relationships[safeString(track.trackId)] || {from: safeString(track.trackId), to: safeString(tag.album), type: 'DIRTY_HAS_ALBUM'}
              newData.relationships[safeString(tag.album)] = newData.relationships[safeString(tag.album)] || {from: safeString(tag.album), to: safeString(tag.artist), type: 'DIRTY_HAS_ARTIST'}
            })
          } catch (err) {
            console.log(err)
          }          
        }
      })
      Track.db = db
      sync.await(tx.commit(sync.defer()))

      console.log(newData)

      var tx = db.batch()
      Album.db = tx
      Object.keys(newData.albums).forEach(album => {
        Album.save({
          albumId: uuid.v4(),
          title: album
        }, function (err, album) {
          newDataDb.albums[album.title] = album
        })
      })
      Album.db = db
      console.log(sync.await(tx.commit(sync.defer())))

      var tx = db.batch()
      Artist.db = tx
      Object.keys(newData.artists).forEach(artist => {
        Artist.save({
          artistId: uuid.v4(),
          name: artist
        }, function (err, artist) {
          newDataDb.artists[artist.name] = artist
        })
      })
      Artist.db = db
      sync.await(tx.commit(sync.defer()))

      var tx = db.batch()
      Object.keys(newData.relationships).forEach(relationship => {
        var rel = newData.relationships[relationship]
        if(rel.type == 'DIRTY_HAS_ARTIST') {
          tx.relate(newDataDb.albums[rel.from].id, 'DIRTY_HAS_ARTIST', newDataDb.artists[rel.to].id)
        } else {
          tx.relate(newDataDb.tracks[rel.from].id, 'DIRTY_HAS_ALBUM', newDataDb.albums[rel.to].id)
        }        
      })      
      sync.await(tx.commit(sync.defer())) 
    })
  } catch (err) {
    console.log(err)
  } finally {
  }
  res.send('scanned')
})

//---------------------------------------------------------------------------------
app.listen(8079, function () {
  console.log('Graph Music Library backend listening at localhost:8079!')
})