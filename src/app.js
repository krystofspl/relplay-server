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

// CORS
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next()
})

//TODO move to helper
function safeString(str) {
  return '' + str
}

//--------------------------------------------------------------------------------- ROUTES

// ENTITY ROUTES

app.get('/artists/:id', function (req, res) {
  var id = req.params.id
  Artist.where(id, function (err, artist) {
    res.json(artist)
  })
})

app.get('/artists', function (req, res) {
  Artist.findAll(function (err, artists) {
    //artists.forEach(artist => {if(artist.albums) artist.albums = artist.albums.map(album => album.id)})
    res.json(artists)
  })
})

app.get('/albums', function (req, res) {
  //TODO only include artist IDs, this is redundant
  Album.compose(Artist, 'artists', 'HAS_ARTIST', {many: true})
  Album.compose(Artist, 'artists', 'DIRTY_HAS_ARTIST', {many: true})
  Album.findAll(function (err, albums) {
    albums.forEach(album => {if(album.artists) album.artists = album.artists.map(artist => artist.id)})
    res.json(albums)
  })
})

app.get('/tracks', function (req, res) {
  Track.compose(Album, 'album', 'HAS_ALBUM')
  Track.compose(Album, 'album', 'DIRTY_HAS_ALBUM')
  Track.findAll(function (err, tracks) {
    tracks.forEach(track => {if(track.album) track.album = track.album.id})
    res.json(tracks)
  })
})

// GRAPH ROUTES

app.get('/graphs/artist-albums-graph', (req, res) => {
  var artist = req.query.artist
  if (!artist) {
    res.status(400).send('Artist id parameter ("artist") must be present.')
    return
  }
  var query = '\
    MATCH (mainArtist:Artist)<-[rel]-(album:Album) \
    WHERE ID(mainArtist) = {id} AND (type(rel) = "HAS_ARTIST" OR type(rel) = "DIRTY_HAS_ARTIST") \
    WITH album, mainArtist \
    MATCH (artist:Artist)<-[rel]-(album:Album) \
    WHERE (type(rel) = "HAS_ARTIST" OR type(rel) = "DIRTY_HAS_ARTIST") \
    RETURN ID(album) as album, \
    CASE ID(artist) \
      WHEN ID(mainArtist) THEN ID(mainArtist) \
      ELSE ID(artist) \
    END as artist, \
    CASE ID(artist) \
      WHEN ID(mainArtist) THEN true \
      ELSE false \
    END as primary \
    '
  db.query(query, {id: parseInt(artist)}, (err, result) => {
    console.log(err)
    res.json(result)
  })
})

app.get('/rescan', function (req, res) {
  //TODO??! make this responsive, scanning may be long, show progress, inform the user, prevent double scanning(adding)
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

      //TODO do this in batches for large imports?
      files.forEach(file => {
        //TODO more formats, change the tag reader for a more universal one
        if(!['mp3'].includes(file.split('.').pop().toLowerCase()) || !file) {return}
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
          tx.relate(newDataDb.albums[rel.from].id, 'DIRTY_HAS_ARTIST', newDataDb.artists[rel.to].id, {main: true})
        } else {
          tx.relate(newDataDb.tracks[rel.from].id, 'DIRTY_HAS_ALBUM', newDataDb.albums[rel.to].id)
        }
      })
      sync.await(tx.commit(sync.defer()))
    })
  } catch (err) {
    console.log(err)
  }
  res.send('scanned')
})

//---------------------------------------------------------------------------------
app.listen(8079, function () {
  console.log('Graph Music Library backend listening at localhost:8079!')
})