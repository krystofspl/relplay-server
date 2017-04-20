var Artist = require('../models/Artist.js')

app.get('/artists', function (req, res) {
  Artist.findAll(function (err, artists) {
    res.json(artists)
  })
})

app.get('/artists/:id', function (req, res) {
  sync.fiber(function () {
    try {
      if (isNaN(parseInt(req.params.id)) || !sync.await(Artist.exists(parseInt(req.params.id), sync.defer()))) {
        res.status(404).send('Artist with specified ID doesn\'t exist')
        return
      }
      res.json(sync.await(Artist.read(parseInt(req.params.id), sync.defer())))
    } catch (err) {
      console.log(err)
    }
  })
})

app.post('/artists', function (req, res) {
  try {
    var nodeData = {}
    var request = req.body
    if (request.name) {nodeData.name = request.name}
    Artist.save(nodeData, function (err, result) {
      if (err) throw err
      if (result) {
        res.json(result)
      }
    })
  } catch (err) {
    console.log(err)
    res.status(500).end()
  }
})