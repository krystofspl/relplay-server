
// TODO change to URI
app.post('/relationships/album-similarity/add', function (req, res) {
  var edge = req.body.edge
  var album1 = parseInt(edge.from)
  var album2 = parseInt(edge.to)
  if (album1 && album2) {
    db.relate(album1, 'SIMILAR_TO', album2, (err, result) => {
      // TODO err
      console.log(err)
      res.status(200).json(result)
    })
  }
})

// TODO change to DELETE+URI
app.post('/relationships/album-similarity/delete', function (req, res) {
  var edge = req.body.edge
  var album1 = parseInt(edge.from)
  var album2 = parseInt(edge.to)
  if (album1 && album2) {
    // TODO err
    var query = ' \
      MATCH (album1:Album)-[r:SIMILAR_TO]-(album2:Album) \
      WHERE (ID(album1) = {id1} AND ID(album2) = {id2}) OR (ID(album1) = {id2} AND ID(album2) = {id1}) \
      DELETE r \
    '
    db.query(query, {id1: album1, id2: album2}, (err, result) => {
      console.log(err)
      res.status(200).json(result)
    })
  }
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