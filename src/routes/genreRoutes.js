var Genre = require('../models/Genre.js')

app.get('/genres', function (req, res) {
  sync.fiber(() => {
    // Get genres
    var genres = sync.await(Genre.findAll(sync.defer()))

    // Embed parentGenres
    genres.forEach(genre => {
      var parentGenresQuery = 'MATCH (genre:Genre)-[:HAS_PARENT_GENRE]->(parentGenre:Genre) WHERE ID(genre) = {genreId} return parentGenre'
      var parentGenres = sync.await(db.query(parentGenresQuery, {genreId: genre.id}, sync.defer()))
      if (parentGenres.length){
        genre.parentGenre = parentGenres[0].id
      } else {
        genre.parentGenre = null
      }
    })
    res.json(genres)
  })
})

app.get('/genres/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Genre.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Genre with specified ID doesn\'t exist')
        return
      }
      var query = ' \
        MATCH (genre:Genre) \
        WHERE ID(genre) = {genreId} \
        WITH (genre) \
        OPTIONAL MATCH (genre)-[:HAS_PARENT_GENRE]->(parentGenre:Genre) \
        RETURN genre, parentGenre \
      '
      var result = sync.await(db.query(query, {genreId: parseInt(req.params.id)}, sync.defer()))
      result = result[0] // result is [{genre:.., parentGenre: int}]
      var genre = result.genre

      // Move the rels inside the genre JSON
      genre.parentGenre = result.parentGenre
      res.json(genre)
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.delete('/genres/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Genre.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Genre with specified ID doesn\'t exist')
        return
      }

      var query = ' \
      MATCH (genre:Genre) \
      WHERE ID(genre) = {id} \
      WITH genre \
      OPTIONAL MATCH (genre)-[r]-() \
      DELETE r, genre \
      '
      sync.await(db.query(query, {id: parseInt(req.params.id)}, sync.defer()))
      res.status(200).end()
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.post('/genres', function (req, res) {
  sync.fiber(function () {
    try {
      var nodeData = {}
      var genre = null
      var newParentGenre = null

      var request = req.body
      // Take attributes data from the request
      if (request.title) {nodeData.title = request.title}
      if (request.description) {nodeData.description = request.description}
      if (request.color) {nodeData.color = request.color}
      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      if (request.parentGenre) {newParentGenre = request.parentGenre; delete request.parentGenre}

      // Create genre
      genre = sync.await(Genre.save(nodeData, sync.defer()))

      // Obtain new genre along with relevant rels embedded
      var query = ' \
        MATCH (genre:Genre) \
        WHERE ID(genre) = {id} \
        RETURN genre \
      '
      result = sync.await(db.query(query, {id: parseInt(genre.id)}, sync.defer()))
      if (result.length < 1) {
        throw 'ERR: No genre with id ' + genre.id
      }
      genre = result[0]

      // Create rels if requested
      if (newParentGenre) {
        sync.await(db.relate(genre.id, 'HAS_PARENT_GENRE', newParentGenre, sync.defer()))
        genre.parentGenre = newParentGenre
      }

      res.status(201).location(global.serverAddr + 'genres/' + genre.id).json(genre)
      return
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.patch('/genres/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Genre.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Genre with specified ID doesn\'t exist')
        return
      }
      var nodeData = {
        id: parseInt(req.params.id)
      }
      var genre = null
      var newParentGenre = 'nothing'

      var request = req.body
      // Take attributes data from the request
      if (request.title) {nodeData.title = request.title}
      if (request.description) {nodeData.description = request.description}
      if (request.color) {nodeData.color = request.color}
      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      if ('parentGenre' in request) {newParentGenre = request.parentGenre; delete request.parentGenre}

      // Update genre if there's ID and some data present
      var argsCount = Object.keys(nodeData).length
      if (argsCount >= 2) {
        sync.await(Genre.update(nodeData, sync.defer()))
      }/* else {
        res.status(422).send('No parameters supplied')
        return
      }*/

      // Obtain new genre along with relevant rels embedded
      var query = ' \
        MATCH (genre:Genre) \
        WHERE ID(genre) = {id} \
        WITH genre \
        OPTIONAL MATCH (genre)-[rel:HAS_PARENT_GENRE]->(genre2:Genre) \
        RETURN genre, ID(genre2) as parentGenre \
      '
      result = sync.await(db.query(query, {id: parseInt(nodeData.id)}, sync.defer()))
      if (result.length < 1) {
        throw 'ERR: No genre with id ' + nodeData.id
      }
      result = result[0]

      genre = result.genre // result is [{genre:.., parentGenre: int}]
      genre.parentGenre = result.parentGenre

      // Update related entities if requested
      var tx = db.batch()
      // Update and set new parentGenre if present
      if (newParentGenre !== 'nothing') {
        // Delete old parent genre rel
        tx.query('MATCH (genre:Genre)-[r:HAS_PARENT_GENRE]->(genre2:Genre) WHERE ID(genre)={id} DELETE r', {id: parseInt(nodeData.id)})
        // Add new parent genre rel; if null, just delete
        if (newParentGenre) { // is not null or undefined
          tx.relate(genre.id, 'HAS_PARENT_GENRE', newParentGenre)
        }
        genre.parentGenre = newParentGenre
      }
      sync.await(tx.commit(sync.defer()))

      res.json(genre)
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})
