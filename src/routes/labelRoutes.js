var Label = require('../models/Label.js')

app.get('/labels', function (req, res) {
  sync.fiber(function () {
    try {
      var title = req.query.title
      if (title) {
        var query = 'MATCH (l:Label) WHERE l.title={title} RETURN l'
        var result = sync.await(db.query(query, {title: title}, sync.defer()))
        if (result.length) {
          res.json(result[0])
          return
        } else {
          res.status(404).send('Label with specified title not found.')
          return
        }
      } else {
        var result = sync.await(Label.findAll(sync.defer()))
        if (result.length) {
          res.json(result)
          return
        } else {
          res.status(200).send('No labels found.')
        }
      }
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.get('/labels/:id', function (req, res) {
  sync.fiber(function () {
    try {
      var id = parseInt(req.params.id)
      if (isNaN(id) || !sync.await(Label.exists(id, sync.defer()))) {
        res.status(404).send('Label with specified ID doesn\'t exist')
        return
      }
      var query = ' \
        MATCH (label:Label) \
        WHERE ID(label) = {labelId} \
        WITH (label) \
        OPTIONAL MATCH (label)-[:HAS_PARENT_LABEL]->(parentLabel:Label) \
        RETURN label, parentLabel \
      '
      var result = sync.await(db.query(query, {labelId: id}, sync.defer()))
      result = result[0] // result is [{genre:.., parentGenre: int}]
      var label = result.label

      // Move the rels inside the genre JSON
      label.parentLabel = result.parentLabel
      res.json(sync.await(Label.read(parseInt(req.params.id), sync.defer())))
    } catch (err) {
      console.log(err)
    }
  })
})

app.post('/labels', function (req, res) {
  sync.fiber(function () {
    try {
      var requestBody = req.body
      var newLabels = []
      var addedLabels = []
      if (requestBody.length) {
        newLabels = requestBody
      } else {
        newLabels.push(requestBody)
      }
      for (let i = 0; i < newLabels.length; i++) {
        var request = newLabels[i]
        var nodeData = {}
        // TODO if exists, return code
        if (request.title) {nodeData.title = request.title}
        if (request.description) {nodeData.description = request.description}
        if (!nodeData.title) {
          continue
          /* res.status(400).send('Title must be provided')
          return */
        }
        var label = sync.await(Label.save(nodeData, sync.defer()))
        if (label) {
          addedLabels.push(label)
        }
      }
      if (addedLabels.length) {
        res.json(addedLabels)
      } else {
        throw {msg: 'An error when saving the data has occured.'}
      }
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.patch('/labels/:id', function (req, res) {
  sync.fiber(function () {
    try {
      var id = parseInt(req.params.id)
      if (isNaN(id) || !sync.await(Label.exists(id, sync.defer()))) {
        res.status(404).send('Label with specified ID doesn\'t exist')
        return
      }
      var nodeData = {
        id: id
      }
      var request = req.body
      if (request.title) {nodeData.title = request.title}
      if (request.description) {nodeData.description = request.description}

      // Update label if there's ID and some data present
      var argsCount = Object.keys(nodeData).length
      var label
      if (argsCount >= 2) {
        label = sync.await(Label.update(nodeData, sync.defer()))
      }
      if (label) {
        res.json(label)
      } else {
        throw {msg: 'An error when saving the data has occured.'}
      }
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})

app.delete('/labels/:id', function (req, res) {
  sync.fiber(function () {
    try {
      var id = parseInt(req.params.id)
      if (isNaN(id) || !sync.await(Label.exists(id, sync.defer()))) {
        res.status(404).send('Label with specified ID doesn\'t exist')
        return
      }
      var query = ' \
      MATCH (label:Label) \
      WHERE ID(label) = {id} \
      WITH label \
      OPTIONAL MATCH (label)-[r]-() \
      DELETE r, label \
      '
      sync.await(db.query(query, {id: id}, sync.defer()))
      res.status(200).end()
    } catch (err) {
      console.log(err)
      res.status(500).json(err)
    }
  })
})