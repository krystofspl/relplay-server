var Album = require('../models/Album.js')
var Artist = require('../models/Artist.js')
var path = require('path')
var fs = require('fs')
var gm = require('gm')

app.get('/albums', function (req, res) {
  //TODO only include artist IDs, this is redundant
  // now the seraph library doesn't allow it, could rewrite as query
  sync.fiber(() => {
    try {
      Album.compose(Artist, 'mainArtist', 'HAS_MAIN_ARTIST')
      Album.compose(Artist, 'artists', 'HAS_ARTIST', {many: true})
      // TODO compose Genre throws cypher null pointer, bug on seraph-model's side?

      var albums = sync.await(Album.findAll(sync.defer()))
      // Map entities to respective IDs
      albums.forEach(album => {if (album.mainArtist) album.mainArtist = album.mainArtist.id})
      albums.forEach(album => {
        if (album.artists) {
          album.artists = album.artists.map(artist => artist.id)
        } else {
          album.artists = []
        }
      })
      // Get genres
      albums.forEach(album => {
        var genresQuery = 'MATCH (album:Album)-[:HAS_GENRE]->(genre:Genre) WHERE ID(album) = {albumId} return genre'
        var genres = sync.await(db.query(genresQuery, {albumId: album.id}, sync.defer()))
        if (genres) {
          album.genres = genres.map(genre => genre.id)
        } else {
          album.genres = []
        }
      })
      res.json(albums)
    } catch (err) {
      console.log(err)
    }
  })
})

app.get('/albums/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Album.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Album with specified ID doesn\'t exist')
        return
      }
      var query = ' \
        MATCH (album:Album)-[:HAS_MAIN_ARTIST]->(mainArtist:Artist) \
        WHERE ID(album) = {id} \
        WITH album, mainArtist \
        OPTIONAL MATCH (album)-[:HAS_ARTIST*]->(artist:Artist) \
        WITH album, artist, mainArtist \
        OPTIONAL MATCH (album)-[:HAS_GENRE*]->(genre:Genre) \
        RETURN album, ID(mainArtist) as mainArtist, collect(DISTINCT ID(artist)) as artists, collect(DISTINCT ID(genre)) as genres \
      '
      res.json(sync.await(db.query(query, {id: parseInt(req.params.id)}, sync.defer())))
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })

})

app.get('/album-arts/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Album.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Album with specified ID doesn\'t exist')
        return
      }

      // TODO more formats/files?
      var albumArtFileName = req.params.id + '.jpg'
      var albumArtPath = path.join(path.join(global.appRoot, 'album-arts'), albumArtFileName)

      if (fs.existsSync(albumArtPath)) {
        res.set('Content-Type', 'image/jpeg')
        res.sendFile(albumArtPath)
        return
      } else {
        db.query('MATCH (t:Track)-[:HAS_ALBUM]->(a:Album) WHERE ID(a) = {id} RETURN t.filePath as path LIMIT 1', {id: parseInt(req.params.id)}, function (err, result) {
          if (result && result.length > 0) {
            var expectedImgPath = path.join(global.libraryPath, path.join(path.dirname(result[0].path), 'folder.jpg'))
            if (fs.existsSync(expectedImgPath)) {
              gm(expectedImgPath)
              .resize(300, 300)
              .write(albumArtPath, err => {
                if (err) {
                  throw err
                } else {
                  res.set('Content-Type', 'image/jpeg')
                  res.sendFile(albumArtPath)
                  return
                }
              })
            } else {
              res.status(404).send('Album art could not be found')
              return
            }
          } else {
            res.status(404).send('Album with specified ID doesn\'t exist')
            return
          }
        })
      }
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.patch('/albums/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Album.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Album with specified ID doesn\'t exist')
        return
      }
      var nodeData = {
        id: parseInt(req.params.id)
      }
      var album = null
      var newMainArtist = null
      var newArtists = null
      var newGenres = null

      var request = req.body
      // Take attributes data from the request
      if (request.title) {nodeData.title = request.title}
      if (typeof request.inInbox !== 'undefined') {nodeData.inInbox = request.inInbox}
      // TODO more data will be here
      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      if (request.mainArtist) {newMainArtist = request.mainArtist; delete request.mainArtist}
      if (request.artists) {newArtists = request.artists; delete request.artists}
      if (request.genres) {newGenres = request.genres; delete request.genres}
      // Update album if there's some data present
      var argsCount = Object.keys(nodeData).length
      if (argsCount >= 2) {
        sync.await(Album.update(nodeData, sync.defer()))
      }/* else {
        res.status(422).send('No parameters supplied')
        return
      }*/

      // Obtain the new album with relevant rels embedded
      var query = ' \
        MATCH (album:Album)-[rel]->(mainArtist:Artist) \
        WHERE ID(album) = {id} AND (TYPE(rel) = "HAS_MAIN_ARTIST") \
        WITH album, mainArtist \
        OPTIONAL MATCH (album)-[:HAS_ARTIST*]->(artist:Artist) \
        WITH album, artist, mainArtist \
        OPTIONAL MATCH (album)-[:HAS_GENRE*]->(genre:Genre) \
        RETURN album, ID(mainArtist) as mainArtist, collect(DISTINCT ID(artist)) as artists, collect(DISTINCT ID(genre)) as genres \
      '
      result = sync.await(db.query(query, {id: parseInt(nodeData.id)}, sync.defer()))
      if (result.length < 1) {
        throw 'ERR: No album with id ' + nodeData.id
      }
      result = result[0]

      album = result.album // result is [{album:.., mainArtist: int, artists: int[], genres: int[]}]
      if (result.mainArtist) {album.mainArtist = result.mainArtist}
      if (result.artists) {
        album.artists = result.artists
      } else {
        album.artists = []
      }
      if (result.genres) {
        album.genres = result.genres
      } else {
        album.genres = []
      }

      // Update related entities if requested
      var tx = db.batch()
      // Update and set new mainArtist if present
      if (newMainArtist) {
        // Delete old main artist rel
        tx.query('MATCH (album:Album)-[r:HAS_MAIN_ARTIST]->(Artist) WHERE ID(album)={id} DELETE r', {id: parseInt(nodeData.id)})
        // Add new main artist rel
        tx.relate(nodeData.id, 'HAS_MAIN_ARTIST', newMainArtist)
        album.mainArtist = newMainArtist
      }
      // Update and set new artists if present
      if (newArtists) {
        // Delete old artists rels
        tx.query('MATCH (album:Album)-[r:HAS_ARTIST]->(Artist) WHERE ID(album)={id} DELETE r', {id: parseInt(nodeData.id)})
        // Add new artists rels
        album.artists = []
        newArtists.forEach(artistId => {
          tx.relate(nodeData.id, 'HAS_ARTIST', artistId)
          album.artists.push(artistId)
        })
      }
      // Update and set new genres if present
      if (newGenres) {
        // Delete old genre rels
        tx.query('MATCH (album:Album)-[r:HAS_GENRE]->(Genre) WHERE ID(album)={id} DELETE r', {id: parseInt(nodeData.id)})
        // Add new genre rels
        album.genres = []
        newGenres.forEach(genreId => {
          tx.relate(nodeData.id, 'HAS_GENRE', genreId)
          album.genres.push(genreId)
        })
      }
      sync.await(tx.commit(sync.defer()))

      res.json(album)
      return
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})