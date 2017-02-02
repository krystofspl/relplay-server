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

app.post('/genres', genreCreateUpdateRouteHandler)

app.patch('/genres/:id', function (req, res) {
  var request = req.body
  var nodeData = {}
  if (req.params.id) {nodeData.id = parseInt(req.params.id)}
  if (request.title) {nodeData.title = request.title}
  if (request.description) {nodeData.description = request.description}
  if (request.color) {nodeData.color = request.color}
  if (request.parentGenre) {nodeData.parentGenre = request.parentGenre}
  sync.fiber(function () {
    try {
      var genre = null
      var newParentGenre = null

      // Take relationship data from the request, if present
      if (nodeData.parentGenre) {newParentGenre = nodeData.parentGenre; delete nodeData.mainArtist}

      var idPresent = Object.keys(nodeData).includes('id')
      var argsCount = Object.keys(nodeData).length

      // Create new genre if there's no ID present
      if (!idPresent) {
        genre = sync.await(Genre.save(nodeData, sync.defer()))
      }
      // Update genre if there's ID and some data present
      if (idPresent && argsCount >= 2) {
        genre = sync.await(Genre.update(nodeData, sync.defer()))
      }
      // Not modified
      if (idPresent && argsCount == 1) {
        res.status(304).send('Not modified')
        return
      }

      // Obtain new genre along with its parentGenre
      var query = ' \
        MATCH (genre:Genre) \
        WHERE ID(genre) = {id} \
        WITH genre \
        OPTIONAL MATCH (genre)-[rel:HAS_PARENT_GENRE]->(genre2:Genre) \
        RETURN genre, ID(genre2) as parentGenre \
      '
      result = sync.await(db.query(query, {id: parseInt(genre.id)}, sync.defer()))

      result = result[0]
      genre = result.genre // result is [{genre:.., parentGenre: int}]
      if (result.parentGenre) {genre.parentGenre = result.parentGenre}

      // Update and set new parentGenre if present
      if (newParentGenre) {
        // Delete old parent genre rel
        sync.await(db.query('MATCH (genre:Genre)-[r:HAS_PARENT_GENRE]->(genre2:Genre) WHERE ID(genre)={id} DELETE r', {id: parseInt(nodeData.id)}, sync.defer()))
        // Add new parent genre rel
        sync.await(db.relate(genre.id, 'HAS_PARENT_GENRE', newParentGenre, sync.defer()))
        genre.parentGenre = newParentGenre
      }
    } catch (err) {
      console.log(err)
    }
    res.status(200).json(genre)
  })
})
