
// Album similarity

app.get('/relationships/album-similarity', function (req, res) {
  try {
    var query = ' \
      MATCH (a:Album)-[r:SIMILAR_TO]-(b:Album) \
      RETURN r \
    '
    db.query(query, {}, (err, result) => {
      if (err) {throw err}
      res.json(result)
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})

app.post('/relationships/album-similarity', function (req, res) {
  try {
    var request = req.body
    if (isNaN(parseInt(request.start)) || isNaN(parseInt(request.end))) {
      res.status(422).send('Album IDs "start" and "end" must be specified.')
      return
    }
    var start = parseInt(request.start)
    var end = parseInt(request.end)
    db.relate(start, 'SIMILAR_TO', end, {created: Date.now()}, (err, result) => {
      if (err) throw err
      res.status(201).json(result)
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})

app.delete('/relationships/album-similarity/:start/:end', function (req, res) {
  try {
    var request = req.body
    if (isNaN(parseInt(req.params.start)) || isNaN(parseInt(req.params.end))) {
      res.status(422).send('Album IDs "start" and "end" must be specified.')
      return
    }
    var start = parseInt(req.params.start)
    var end = parseInt(req.params.end)
    var query = ' \
      MATCH (start:Album)-[r:SIMILAR_TO]-(end:Album) \
      WHERE (ID(start) = {start} AND ID(end) = {end}) \
      DELETE r \
    '
    db.query(query, {start: start, end: end}, (err, result) => {
      if (err) throw err
      res.status(200).end()
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})


// Artist similarity

app.get('/relationships/artist-similarity', function (req, res) {
  try {
    var query = ' \
      MATCH (a:Artist)-[r:SIMILAR_TO]-(b:Artist) \
      RETURN r \
    '
    db.query(query, {}, (err, result) => {
      if (err) {throw err}
      res.json(result)
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})

app.post('/relationships/artist-similarity', function (req, res) {
  try {
    var request = req.body
    if (isNaN(parseInt(request.start)) || isNaN(parseInt(request.end))) {
      res.status(422).send('Artist IDs "start" and "end" must be specified.')
      return
    }
    var start = parseInt(request.start)
    var end = parseInt(request.end)
    db.relate(start, 'SIMILAR_TO', end, {created: Date.now()}, (err, result) => {
      if (err) throw err
      res.status(201).json(result)
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})

app.delete('/relationships/artist-similarity/:start/:end', function (req, res) {
  try {
    var request = req.body
    if (isNaN(parseInt(req.params.start)) || isNaN(parseInt(req.params.end))) {
      res.status(422).send('Artist IDs "start" and "end" must be specified.')
      return
    }
    var start = parseInt(req.params.start)
    var end = parseInt(req.params.end)
    var query = ' \
      MATCH (start:Artist)-[r:SIMILAR_TO]-(end:Artist) \
      WHERE (ID(start) = {start} AND ID(end) = {end}) \
      DELETE r \
    '
    db.query(query, {start: start, end: end}, (err, result) => {
      if (err) throw err
      res.status(200).end()
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})

app.post('/relationships/labels-parent/:start/:end', function (req, res) {
  try {
    var request = req.body
    if (isNaN(parseInt(req.params.start)) || isNaN(parseInt(req.params.end))) {
      res.status(422).send('Label IDs "start" and "end" must be specified.')
      return
    }
    var start = parseInt(req.params.start)
    var end = parseInt(req.params.end)
    db.relate(start, 'HAS_PARENT_LABEL', end, {created: Date.now()}, (err, result) => {
      if (err) throw err
      res.status(201).json(result)
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})

app.delete('/relationships/labels-parent/:start/:end', function (req, res) {
  try {
    var request = req.body
    if (isNaN(parseInt(req.params.start)) || isNaN(parseInt(req.params.end))) {
      res.status(422).send('Label IDs "start" and "end" must be specified.')
      return
    }
    var start = parseInt(req.params.start)
    var end = parseInt(req.params.end)
    var query = ' \
      MATCH (start:Label)-[r:HAS_PARENT_LABEL]-(end:Label) \
      WHERE (ID(start) = {start} AND ID(end) = {end}) \
      DELETE r \
    '
    db.query(query, {start: start, end: end}, (err, result) => {
      if (err) throw err
      res.status(200).end()
    })
  } catch (err) {
    console.log(err)
    res.status(500).json(err)
  }
})