var _ = require('lodash')

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

app.get('/graphs/albums-albums-graph', (req, res) => {
  // Query for (album)<-[similarity]-(album)
  var query = '\
    MATCH (album:Album) \
    WITH album \
    OPTIONAL MATCH (album)-[:SIMILAR_TO]->(album2:Album) \
    RETURN ID(album) as album, collect(ID(album2)) as rels \
    '
  db.query(query, {}, (err, result) => {
    console.log(err)
    res.json(result)
  })
})

app.get('/graphs/artists-artists-graph', (req, res) => {
  // Query for (artist)<-[similarity]-(artist)
  var query = '\
    MATCH (artist:Artist) \
    WITH artist \
    OPTIONAL MATCH (artist)-[:SIMILAR_TO]->(artist2:Artist) \
    RETURN ID(artist) as artist, collect(ID(artist2)) as rels \
    '
  db.query(query, {}, (err, result) => {
    console.log(err)
    res.json(result)
  })
})

app.get('/graphs/genres-albums-graph', (req, res) => {
  // Query for (genre)<-[HAS_GENRE]<-(album)
  var query = '\
    MATCH (genre:Genre) \
    WITH genre \
    OPTIONAL MATCH (genre)<-[:HAS_GENRE]-(album:Album) \
    WITH genre, album \
    OPTIONAL MATCH (genre)<-[:HAS_PARENT_GENRE]-(parentGenre:Genre) \
    RETURN ID(genre) as genre, collect(ID(album)) as rels, ID(parentGenre) as parentGenre \
  '
  db.query(query, {}, (err, result) => {
    console.log(err)
    res.json(result)
  })
})

app.get('/graphs/labels-graph', (req, res) => {
  // Query for (label)<-[HAS_LABEL]<-(...)
  var query = '\
    MATCH (label)-[r:HAS_PARENT_LABEL]->(parentLabel:Label) \
    RETURN ID(label) as from, ID(parentLabel) as to  \
  '
  db.query(query, (err, result) => {
    console.log(err)
    res.json(result)
  })
})

app.get('/graphs/multi-graph', (req, res) => {
  // Query for all rels between artist, album, label, genre
  sync.fiber(function () {
    try {
      var query = '\
        MATCH (m)-[r:SIMILAR_TO|HAS_LABEL|HAS_GENRE|HAS_PARENT_LABEL|HAS_PARENT_GENRE]->(n) \
        RETURN TYPE(r) as relType, last(LABELS(m)) as fromType, last(LABELS(n)) as toType, ID(m) as from, ID(n) as to \
      '
      var graphData = sync.await(db.query(query, sync.defer()))
      var albumIds = _.concat(_.filter(graphData, o => { return o.fromType === 'Album' }).map(o => o.from), _.filter(graphData, o => { return o.toType === 'Album' }).map(o => o.to))
      var artistIds = _.concat(_.filter(graphData, o => { return o.fromType === 'Artist' }).map(o => o.from), _.filter(graphData, o => { return o.toType === 'Artist' }).map(o => o.to))
      var query = '\
        MATCH (album:Album)-[r:HAS_MAIN_ARTIST|HAS_ARTIST]-(artist:Artist) \
        WHERE ID(album) IN {albumIds} AND ID(artist) IN {artistIds} \
        RETURN TYPE(r) as relType, last(LABELS(album)) as fromType, last(LABELS(artist)) as toType, ID(album) as from, ID(artist) as to \
      '
      var graphData2 = sync.await(db.query(query, {albumIds: albumIds, artistIds: artistIds}, sync.defer()))
      var graphData = _.concat(graphData, graphData2)
      res.json(graphData)
    } catch (err) {
      console.log(err)
    }
  })
})