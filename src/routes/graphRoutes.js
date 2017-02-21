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