var Genre = require('../models/Genre.js')

app.get('/genres', function (req, res) {
  sync.fiber(() => {
    var genres = sync.await(Genre.findAll(sync.defer()))
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

//app.post('/genres', genreCreateUpdateRouteHandler)

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
      var newParentGenre = null

      var request = req.body
      // Take attributes data from the request
      if (request.title) {nodeData.title = request.title}
      if (request.description) {nodeData.description = request.description}
      if (request.color) {nodeData.color = request.color}
      // TODO add validation with response if failed
      // Take relationship data from the request, if present
      if (request.parentGenre) {newParentGenre = request.parentGenre; delete request.parentGenre}

      // Create new genre if there's no ID present
      /* if (!idPresent) {
        genre = sync.await(Genre.save(nodeData, sync.defer()))
      }
      var idPresent = Object.keys(nodeData).includes('id')
      */
      // Update genre if there's ID and some data present
      var argsCount = Object.keys(nodeData).length
      if (idPresent && argsCount >= 2) {
        sync.await(Genre.update(nodeData, sync.defer()))
      } else {
        res.status(422).send('No parameters supplied')
        return
      }

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
        res.status(500)
        return
      }
      result = result[0]

      genre = result.genre // result is [{genre:.., parentGenre: int}]
      if (result.parentGenre) {genre.parentGenre = result.parentGenre}

      // Update related entities if requested
      var tx = db.batch()
      // Update and set new parentGenre if present
      if (newParentGenre) {
        // Delete old parent genre rel
        tx.query('MATCH (genre:Genre)-[r:HAS_PARENT_GENRE]->(genre2:Genre) WHERE ID(genre)={id} DELETE r', {id: parseInt(nodeData.id)})
        // Add new parent genre rel
        tx.relate(genre.id, 'HAS_PARENT_GENRE', newParentGenre)
        genre.parentGenre = newParentGenre
      }
      sync.await(tx.commit(sync.defer()))
    } catch (err) {
      console.log(err)
    }

    res.json(genre)
  })
})
