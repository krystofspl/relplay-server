var Album = require('../models/Album.js')
var Artist = require('../models/Artist.js')
var path = require('path')

app.get('/albums', function (req, res) {
  //TODO only include artist IDs, this is redundant
  // now the seraph library doesn't allow it, could rewrite as query
  sync.fiber(() => {
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
  })
})

app.get('/albums/:id', function (req, res) {
  var query = ' \
    MATCH (album:Album)-[:HAS_MAIN_ARTIST]->(mainArtist:Artist) \
    WHERE ID(album) = {id} \
    WITH album, mainArtist \
    OPTIONAL MATCH (album)-[:HAS_ARTIST*]->(artist:Artist) \
    WITH album, artist, mainArtist \
    OPTIONAL MATCH (album)-[:HAS_GENRE*]->(genre:Genre) \
    RETURN album, ID(mainArtist) as mainArtist, collect(DISTINCT ID(artist)) as artists, collect(DISTINCT ID(genre)) as genres \
  '
  db.query(query, {id: parseInt(req.params.id)}, function (err, album) {
    console.log(err)
    res.json(album)
  })
})

app.get('/album-art/:id', function (req, res) {
  db.query('MATCH (t:Track)-[:HAS_ALBUM]->(a:Album) WHERE ID(a) = {id} RETURN t.filePath as path LIMIT 1', {id: parseInt(req.params.id)}, function (err, result) {
    if (result && result.length > 0) {
      res.set('Content-Type', 'image/jpeg')
      // TODO compress? lookup in local dir cache?
      // TODO look for other jpgs
      res.sendFile(path.resolve(path.join(path.dirname(result[0].path), 'folder.jpg')));
    } else {
      res.status(404).send('Not found');
    }
  })
})

app.patch('/albums/:id', function (req, res) {
  var request = req.body
  var nodeData = {
    id: request.id
  }
  if (request.title) {nodeData.title = request.title}
  if (typeof request.inInbox !== 'undefined') {nodeData.inInbox = request.inInbox}
  sync.fiber(function () {
    try {
      var album = null
      var newMainArtist = null
      var newArtists = null
      var newGenres = null
      // Take relationship data from the request, if present
      if (request.mainArtist) {newMainArtist = request.mainArtist; delete request.mainArtist}
      if (request.artists) {newArtists = request.artists; delete request.artists}
      if (request.genres) {newGenres = request.genres; delete request.genres}
      // Update album if there's some data present
      if (Object.keys(nodeData).length >= 2) {
        sync.await(Album.update(nodeData, sync.defer()))
      }

      // Obtain the new album with relevant rels
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
      if (result.length < 1) {throw 'No album with id ' + nodeData.id}
      result = result[0]
      console.log(result)
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
    } catch (err) {
      console.log(err)
    }
    res.status(200).json(album)
  })
})