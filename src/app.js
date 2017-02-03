require('./config')
require('./helpers/appHelpers')

var express = require('express')
var fs = require('fs')
var path = require('path')
bodyParser = require('body-parser')
var uuid = require('node-uuid')
sync = require('synchronize')
var corser = require('corser')

app = express()

app.use(bodyParser.json())

// Setup CORS
app.use(corser.create({
    methods: corser.simpleMethods.concat(["PUT", "PATCH", "DELETE"]),
    requestHeaders: corser.simpleRequestHeaders.concat(["X-Requested-With"])
}))
app.all('*', function(request, response, next) {
    response.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Authorization, Access-Control-Allow-Origin, Accept, Origin');
    response.header('Access-Control-Allow-Methods', 'POST, GET, DELETE');
    response.header('Access-Control-Allow-Origin', '*');
    next();
})


//--------------------------------------------------------------------------------- ROUTES

// ENTITY ROUTES

require('./routes/artistRoutes.js')
require('./routes/albumRoutes.js')
require('./routes/trackRoutes.js')
require('./routes/genreRoutes.js')
require('./routes/relationshipRoutes.js')
require('./routes/graphRoutes.js')


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
              newData.relationships[safeString(track.trackId)] = newData.relationships[safeString(track.trackId)] || {from: safeString(track.trackId), to: safeString(tag.album), type: 'HAS_ALBUM'}
              newData.relationships[safeString(tag.album)] = newData.relationships[safeString(tag.album)] || {from: safeString(tag.album), to: safeString(tag.artist), type: 'HAS_MAIN_ARTIST'}
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
        if(rel.type == 'HAS_MAIN_ARTIST') {
          tx.relate(newDataDb.albums[rel.from].id, 'HAS_MAIN_ARTIST', newDataDb.artists[rel.to].id, {main: true})
        } else {
          tx.relate(newDataDb.tracks[rel.from].id, 'HAS_ALBUM', newDataDb.albums[rel.to].id)
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
  console.log('Graph Music Library backend listening at ' + global.serverAddr + '!')
})