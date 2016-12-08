var express = require('express')
var app = express()

global.db = require('seraph')({
  server: 'http://localhost:7474',
  user: 'neo4j',
  pass: 'password'
})
//global.libraryPath = '/home/krystof/Code/School/graph_music_library/library/'
global.libraryPath = '/mnt/G/Hudba/Wayne Shorter'
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
  Album.compose(Artist, 'mainArtist', 'HAS_MAIN_ARTIST')
  Album.compose(Artist, 'artists', 'HAS_ARTIST', {many: true})
  Album.findAll(function (err, albums) {
    albums.forEach(album => {if(album.mainArtist) album.mainArtist = album.mainArtist.id})
    albums.forEach(album => {
      if(album.artists){
        album.artists = album.artists.map(artist => artist.id)
      } else {
        album.artists = []
      }
    })
    res.json(albums)
  })
})

app.get('/albums/:id', function (req, res) {
  var query = ' \
    MATCH (album:Album)-[rel]->(mainArtist:Artist) \
    WHERE ID(album) = {id} AND (TYPE(rel) = "HAS_MAIN_ARTIST") \
    WITH album, mainArtist \
    OPTIONAL MATCH (album)-[rel:HAS_ARTIST*]->(artist:Artist) \
    RETURN album, ID(mainArtist) as mainArtist, collect(ID(artist)) as artists \
  '
  db.query(query, {id: parseInt(req.params.id)}, function (err, album) {
    console.log(err)
    if(album.mainArtist) {album.mainArtist = album.mainArtist.id}
    if(album.artists) {
      album.artists = album.artists.map(artist => artist.id)
    } else {
      album.artists = []
    }
    res.json(album)
  })
})

app.get('/album-art/:id', function (req, res) {
  db.query('MATCH (t:Track)-[:HAS_ALBUM]->(a:Album) WHERE ID(a) = {id} RETURN t.filePath as path LIMIT 1', {id: parseInt(req.params.id)}, function (err, result) {
    if (result && result.length > 0) {
      res.set('Content-Type', 'image/jpeg')
      // TODO? compress?
      // TODO look for other jpgs
      res.sendFile(path.resolve(path.join(path.dirname(result[0].path), 'folder.jpg')));
    } else {
      res.status(404).send('Not found');
    }
  })
})

app.get('/tracks', function (req, res) {
  Track.compose(Album, 'album', 'HAS_ALBUM')
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
  // Query for (mainArtist)<-(albums)<-?-(otherArtists)
  var query = '\
    MATCH (mainArtist:Artist)<-[rel]-(album:Album) \
    WHERE ID(mainArtist) = {id} AND (type(rel) = "HAS_MAIN_ARTIST" OR type(rel)="HAS_ARTIST") \
    WITH album, mainArtist \
    MATCH (artist:Artist)<-[rel]-(album) \
    WHERE (type(rel) = "HAS_MAIN_ARTIST" OR type(rel)="HAS_ARTIST") \
    RETURN ID(album) as album, \
    CASE ID(artist) \
      WHEN ID(mainArtist) THEN ID(mainArtist) \
      WHEN ID(artist) THEN ID(artist) \
      ELSE ID(mainArtist) \
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

app.get('/graphs/artists-artists-graph', (req, res) => {
  // Query for (artist)<-[similarity]-(artist)
  var query = '\
    MATCH (artist:Artist) \
    WITH (artist) \
    OPTIONAL MATCH (artist)-[:SIMILAR_TO]->(artist2:Artist) \
    RETURN ID(artist) as artist, collect(ID(artist2)) as rels \
    '
  db.query(query, {}, (err, result) => {
    console.log(err)
    res.json(result)
  })
})

// MISC ROUTES

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

// TODO change to URI
app.post('/relationships/artist-similarity/add', function (req, res) {
  var edge = req.body.edge
  var artist1 = parseInt(edge.from)
  var artist2 = parseInt(edge.to)
  if (artist1 && artist2) {
    db.relate(artist1, 'SIMILAR_TO', artist2, (err, result) => {
      // TODO err
      console.log(err)
      res.status(200).json(result)
    })
  }
})

// TODO change to DELETE+URI
app.post('/relationships/artist-similarity/delete', function (req, res) {
  var edge = req.body.edge
  var artist1 = parseInt(edge.from)
  var artist2 = parseInt(edge.to)
  if (artist1 && artist2) {
    // TODO err
    var query = ' \
      MATCH (artist1:Artist)-[r:SIMILAR_TO]-(artist2:Artist) \
      WHERE (ID(artist1) = {id1} AND ID(artist2) = {id2}) OR (ID(artist1) = {id2} AND ID(artist2) = {id1}) \
      DELETE r \
    '
    db.query(query, {id1: artist1, id2: artist2}, (err, result) => {
      console.log(err)
      res.status(200).json(result)
    })

  }
})

// TODO change to PUT
app.post('/albums/:id', function (req, res) {
  // TODO currently has no validation, verification etc
  var request = req.body
  var nodeData = {
    id: request.id
  }
  if(request.title) {nodeData.title = request.title}
  if(typeof request.inInbox !== 'undefined') {nodeData.inInbox = request.inInbox}
  sync.fiber(function () {
    try {
      var album = null
      var newMainArtist = null
      var newArtists = null

      // Take relationship data from the request, if present
      if (request.mainArtist) {newMainArtist = request.mainArtist; delete request.mainArtist}
      if (request.artists) {newArtists = request.artists; delete request.artists}

      // Update album if there's some data present
      if(Object.keys(nodeData).length >= 2) {
        sync.await(Album.update(nodeData, sync.defer()))
      }

      // Obtain new album
      var query = ' \
        MATCH (album:Album)-[rel]->(mainArtist:Artist) \
        WHERE ID(album) = {id} AND (TYPE(rel) = "HAS_MAIN_ARTIST") \
        WITH album, mainArtist \
        OPTIONAL MATCH (album)-[rel:HAS_ARTIST*]->(artist:Artist) \
        RETURN album, ID(mainArtist) as mainArtist, collect(ID(artist)) as artists \
      '
      result = sync.await(db.query(query, {id: parseInt(req.params.id)}, sync.defer()))
      if(result.length < 1) {throw 'No album with id ' + req.params.id}
      result = result[0]
      album = result.album // result is [{album:.., mainArtist: int, artists: int[]}]
      if(result.mainArtist) {album.mainArtist = result.mainArtist} // map mainArtist to its id
      if(result.artists) { // map artists to its ids or return []
        album.artists = result.artists
      } else {
        album.artists = []
      }

      // Update and set new mainArtist if present
      if(newMainArtist) {
        // Delete old main artist rel
        sync.await(db.query('MATCH (album:Album)-[r:HAS_MAIN_ARTIST]->(Artist) WHERE ID(album)={id} DELETE r', {id: parseInt(request.id)}, sync.defer()))
        // Add new main artist rel
        sync.await(db.relate(request.id, 'HAS_MAIN_ARTIST', newMainArtist, sync.defer()))
        album.mainArtist = newMainArtist
      }

      // Update and set new artists if present
      if(newArtists && newArtists.length >= 1) {
        // Delete old artists rels
        sync.await(db.query('MATCH (album:Album)-[r:HAS_ARTIST]->(Artist) WHERE ID(album)={id} DELETE r', {id: parseInt(request.id)}, sync.defer()))
        // Add new artists rels
        album.artists = []
        // TODO transaction
        newArtists.forEach(artistId => {
          sync.await(db.relate(request.id, 'HAS_ARTIST', artistId, sync.defer()))
          album.artists.push(artistId)
        })
      }
    } catch (err) {
      console.log(err)
    }
    res.status(200).json(album)
  })
})

//---------------------------------------------------------------------------------
app.listen(8079, function () {
  console.log('Graph Music Library backend listening at localhost:8079!')
})