var express = require('express')
var app = express()

global.db = require('seraph')({
  server: 'http://localhost:7474',
  user: 'neo4j',
  pass: 'password'
})
global.libraryPath = '/home/krystof/Code/School/graph_music_library/library/'

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

app.get('/rescan', function (req, res) {  
  //TODO ??! make this responsive, scanning may be long, show progress, inform the user, prevent double scanning(adding)
  var recursive = require('recursive-readdir')
  var mediaTags = require('jsmediatags')

  try {
    sync.fiber(function () {
      var oldData = {}
      var newData = {tracks: [], albums: {}, artists: {}, relationships: []}

      //TODO only return needed attributes to save time & bandwidth
      oldData.tracks = sync.await(Track.findAll(sync.defer())).reduce((map, obj) => {
        map[obj.filePath] = {trackId: obj.trackId, id: obj.id}
        return map
      }, {})
      oldData.artists = sync.await(Artist.findAll(sync.defer())).reduce((map, obj) => {
        map[obj.name] = {artistId: obj.artistId, id: obj.id}
        return map
      }, {})

      var txn = db.batch() // run this in a transaction
      Track.db = txn

      recursive(libraryPath, [], function (err, files) {
        files.forEach(file => {
          //TODO more fileformats
          if(!['mp3', 'flac'].includes(file.split('.').pop().toLowerCase())) {return}
          if(!(file in oldData.tracks)) {
            mediaTags.read(file, {
              onSuccess: function(tag) {
                //TODO investigate how to add diskNr, comments (has Hash structure from the library); ?add? genre, picture
                // TODO move uuid generation to model as a callable function and call before save

                // Save track
                var savedTrack = txn.save({
                  trackId: uuid.v4(),
                  title: tag.tags.title,
                  trackNr: tag.tags.track.replace(/(^\d+)(.+$)/i,'$1'),
                  lyrics: tag.tags.lyrics || '',
                  filePath: file                  
                })
                //txn.label(savedTrack, 'Track')

                //newData.tracks.push(savedTrack)
                 // Save or get old/new artist
                /*var currentArtist = null
                if (!(tag.tags.artist in newData.artists) && !(tag.tags.artist in oldData.artists)) {
                  // Create artist
                  var newArtist = {
                    artistId: uuid.v4(),
                    name: tag.tags.artist
                  }
                  currentArtist = Artist.save(newArtist, (err, currentArtist) => {console.log(err)})
                  newData.artists[tag.tags.artist] = currentArtist
                } else if ((tag.tags.artist in newData.artists) && !(tag.tags.artist in oldData.artists)) {
                  currentArtist = newData.artists[tag.tags.artist]
                } else if (!(tag.tags.artist in newData.artists) && (tag.tags.artist in oldData.artists)) {
                  currentArtist = oldData.artists[tag.tags.artist]
                }*/

                // Save or get new album

                //txn.relate(savedTrack, 'DIRTY_HAS_ALBUM', currentAlbum, (err, result) => {console.log(err);console.log(result)})
                //txn.relate(savedTrack, 'DIRTY_HAS_ALBUM', currentAlbum, (err, result) => {console.log(err);console.log(result)})
                                         
              },
              onError: function(error) {
                //TODO err handling (throw?)
                console.log(':( tag reading failed - ', error.type, error.info);
              }
            })
          }
        })
      })

      txn.commit(function (err, results) {
        console.log(results)
        console.log(err)
      })
      Track.db = db
    })
  } catch (err) {
    console.log(err)
  }

  // Get all tracks in DB - id, trackId, filePath
  // For each track check if it exists (through hash)
  // -> Add to db (through txn) if doesnt
  // -> Add album if doesnt exist, otherwise return existing (from hash)
  // -> Add artist if doesnt exist, otherwise return existing (from hash)
  // -> Relate track to returned album, artist
/*
  recursive(libraryPath, [], (err, files) => {
    files.forEach(file => {
      //TODO more fileformats
      if(!['mp3', 'flac'].includes(file.split('.').pop().toLowerCase())) {return}
      //TODO remove duplicates (check for nodes that exist in DB but dont exist in the library folder and mark them)
      Track.where({filePath: file}, function (err, tracks) {        
        if (tracks.length == 0) { // not in DB yet     
          var newTrack = {}, newAlbum = {}, newArtist = {}
          mediaTags.read(file, {
            onSuccess: function(tag) {
              //TODO investigate how to add diskNr, comments (has Hash structure from the library); ?add? genre, picture
              // TODO move uuid generation to model as a callable function and call before save
              var dataHash = {
                trackId: uuid.v4(),
                trackTitle: tag.tags.title,
                trackNr: tag.tags.track.replace(/(^\d+)(.+$)/i,'$1'),
                trackLyrics: tag.tags.lyrics || '',
                trackFilePath: file,
                filePath: file,
                albumId: uuid.v4(),
                albumTitle: tag.tags.album,
                albumYear: tag.tags.year,
                artistId: uuid.v4(),
                artistName: tag.tags.artist.toString()
              }
              //TODO!!! dateAdded u alba check nesmysl
              var albumQuery = "MERGE (t1:Track {trackId: {trackId}, title: {trackTitle}, trackNr: {trackNr}, lyrics: {trackLyrics}, filePath: {trackFilePath}, inInbox: true})-[:HAS_ALBUM]-(a1:Album {title: {albumTitle}, year: {albumYear}})-[:HAS_ARTIST]-(ar1:Artist {artistName: {artistName}})"
              db.query(albumQuery, dataHash, function (err, result) {
                console.log(err)
                console.log(result)
              })               
            },
            onError: function(error) {
              //TODO err handling (throw?)
              console.log(':(', error.type, error.info);
            }
          })
        }
      })
    })
  })*/
  res.send('scanned')
})

//---------------------------------------------------------------------------------
app.listen(8079, function () {
  console.log('Graph Music Library backend listening at localhost:8079!')
})