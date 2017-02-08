var rescanState = {
  status: 'done',
  newFiles: [],
  missingFiles: [],
  tracksAdded: [],
  errMsg: null,
  baf: null
}

function checkStopCondition () {
  return rescanState.status === 'stop'
}

function rescan () {
  var recursive = require('recursive-readdir')
  var metadataReader = require('musicmetadata')
  var fs = require('fs')
  var path = require('path')
  var _ = require('lodash')
  var stringSimilarity = require('string-similarity')

  // Needs to be done synchronously because of the neo4j API calls
  sync.fiber(function () {
    try {
      var newData = {
        tracks: [], albums: {}, artists: {}, rels: []
      }
      var albumsDB = {}
      var artistsDB = {
        idMapping: {}, nameMapping: {}
      }

      // Prepare file lists and arrays of entities stored in DB
      var files = sync.await(recursive(global.libraryPath, sync.defer()))
      files = files.map(file => {return file.replace(global.libraryPath, '')})

      var tracksQuery = ' \
        MATCH (t:Track) \
        RETURN collect(distinct t.filePath) \
      '
      var trackPaths = sync.await(db.query(tracksQuery, sync.defer()))
      trackPaths = trackPaths[0].map(file => {return file.replace(global.libraryPath, '')})

      var albumsQuery = ' \
        MATCH (a:Album)-[:HAS_MAIN_ARTIST]-(artist:Artist) \
        RETURN ID(a) as id, a.title as title, ID(artist) as artist \
      '
      sync.await(db.query(albumsQuery, sync.defer())).forEach(e => {
        var albumNode = {
          id: e.id,
          artistId: e.artist
        }
        if (albumsDB[e.title]) {
          albumsDB[e.title].push(albumNode)
        } else {
          albumsDB[e.title] = [albumNode]
        }
      })

      var artistsQuery = ' \
        MATCH (a:Artist) \
        RETURN ID(a) as id, a.name as name \
      '
      sync.await(db.query(artistsQuery, sync.defer())).forEach(e => {
        artistsDB.idMapping[e.id] = {
          name: e.name
        }
        artistsDB.nameMapping[e.name] = {
          id: e.id
        }
      })
      if (checkStopCondition()) { rescanState.status = 'stopped'; return }

      // Get new and missing files from the lists
      var pathsIntersection = _.intersection(files, trackPaths)
      _.remove(files, n => {
        return pathsIntersection.indexOf(n) != -1
      })
      var newFiles = files
      _.remove(trackPaths, n => {
        return pathsIntersection.indexOf(n) != -1
      })
      var missingFiles = trackPaths
      rescanState.newFiles = newFiles
      rescanState.missingFiles = missingFiles
      if (checkStopCondition()) { rescanState.status = 'stopped'; return }


      // Temporarily add new files as tracks, albums, artists and relationships
      // TODO? add checkStopCondition() inside the loop? this might take long
      var trackIdCounter = 0
      var albumIdCounter = 0
      var artistIdCounter = 0
      newFiles.forEach(filePath => {
        // TODO more formats
        if(!['mp3'].includes(filePath.split('.').pop().toLowerCase()) || !filePath) { return }
        var currentFilePath = path.join(global.libraryPath, filePath)

        // Read ID tags from the music files
        var readStream = fs.createReadStream(currentFilePath)
        var metadata = sync.await(metadataReader(readStream, {duration: true}, sync.defer()))
        readStream.close()

        // Create a temporary representation of the data
        var newTrack = {
          tempId: trackIdCounter,
          title: metadata.title || filePath.split(path.sep).reverse()[0].replace(/\.[^\/.]+$/, ''),
          duration: metadata.duration || 0.0,
          filePath: filePath,
          trackNr: metadata.track.no || 0
        }
        newData.tracks.push(newTrack)
        trackIdCounter++;

        // TODO? incorporate albumArtist?
        var artist = metadata.artist[0] || filePath.split(path.sep).reverse()[2]
        var album = metadata.album || filePath.split(path.sep).reverse()[1]

        // Try to connect the track to an album, create it if needed
        var relCreated = false
        // If the track's album already is in DB, connect it
        if (albumsDB[album]) {
          // Two albums can have the same name but different artist, so we check for that too with a similarity method
          albumsDB[album].forEach(albumItem => {
            if (relCreated) return
            if (stringSimilarity.compareTwoStrings(artist, artistsDB.idMapping[albumItem.artistId].name) > 0.8) {
              newData.rels.push({
                from: newTrack.tempId,
                to: albumItem.id,
                type: 'HAS_ALBUM'
              })
              relCreated = true
            }
          })
        }
        // If the track's album is not in DB but is an album already to be added, connect it
        if (!relCreated && newData.albums[album]) {
          newData.albums[album].forEach(albumItem => {
            if (stringSimilarity.compareTwoStrings(artist, newData.artists[albumItem.artistId].name) > 0.8) {
              if (relCreated) return
              newData.rels.push({
                from: newTrack.tempId,
                to: albumItem.tempId,
                type: 'HAS_ALBUM'
              })
              relCreated = true
            }
          })
        }
        // Didn't find appropriate album => add album, artist and the connection
        if (!relCreated) {
          // Get/create artist
          var artistId = null
          if (artistsDB.nameMapping[artist]) {
            artistId = artistsDB.nameMapping[artist].id
          } else if (_.findKey(newData.artists, a => {return a.name === artist})) {
            artistId = _.findKey(newData.artists, a => {return a.name === artist})
          } else {
            newData.artists[artistIdCounter] = {
              name: artist
            }
            artistId = artistIdCounter
            artistIdCounter++;
          }
          // Create temp album
          var albumNode = {
            tempId: albumIdCounter,
            artistId: artistId,
            year: metadata.year || 0
          }
          albumIdCounter++;
          if (newData.albums[album]) {
            newData.albums[album].push(albumNode)
          } else {
            newData.albums[album] = [albumNode]
          }
          // Connect track with album
          newData.rels.push({
            from: newTrack.tempId,
            to: albumNode.tempId,
            type: 'HAS_ALBUM'
          })
          relCreated = true
          // Connect album with artist
          newData.rels.push({
            from: albumNode.tempId,
            to: artistId,
            type: 'HAS_MAIN_ARTIST'
          })
        }
      })
      if (checkStopCondition()) { rescanState.status = 'stopped'; return }

      //TODO temp
      rescanState.baf = newData

      // Save new entities to DB

      // add temp to new ID mapping

      rescanState.status = 'done'
    } catch (err) {
      rescanState.status = 'err'
      console.log(err)
      rescanState.errMsg = err
    }
  })
}

app.put('/rescan', function (req, res) {
  var action = req.body.action

  // Check mandatory params
  if (!action || ['stop', 'run'].indexOf(action) == -1) {
    res.status(400).send('Invalid action parameter.')
    return
  }

  // Parse and set action
  if (action === 'stop') {
    rescanState.status = 'stop'
    res.status(200).send('Rescan stopped.')
    return
  }
  if (action === 'run') {
    // Running & run => already running
    if (rescanState.status === 'running') {
      res.status(102).json(rescanState)
      return
    } else {
      rescanState.status = 'running'
      res.status(200).send('Rescan request was submitted.')
      rescan()
    }
  }
})

app.get('/rescan', function (req, res) {
  res.json(rescanState)
})


app.get('/rescan', function (req, res) {
  //TODO??! make this responsive, scanning may be long, show progress, inform the user, prevent double scanning(adding)
  // Do in batches, might load new files initially, then add them in batches
  var recursive = require('recursive-readdir')
  var mediaTags = require('audio-metadata')
  var fs = require('fs')

  try {
    var oldData = {}
    var newData = {tracks: [], albums: {}, artists: {}, relationships: {}}
    var newDataDb = {tracks: {}, albums: {}, artists: {}}
    sync.fiber(function () {
      //TODO only return needed attributes to save time & bandwidth
      oldData.tracks = sync.await(Track.findAll(sync.defer())).reduce((map, obj) => {
        map[obj.filePath] = {trackId: obj.trackId, id: obj.id}
        return map
      }, {})
      oldData.artists = sync.await(Artist.findAll(sync.defer())).reduce((map, obj) => {
        map[obj.name] = {artistId: obj.artistId, id: obj.id}
        return map
      }, {})

      var files = sync.await(recursive(libraryPath, [], sync.defer()))
      var tx = db.batch()
      Track.db = tx

      //TODO do this in batches for large imports?
      files.forEach(file => {
        //TODO more formats, change the tag reader for a more universal one
        if(!['mp3'].includes(file.split('.').pop().toLowerCase()) || !file) {return}
        if(!(file in oldData.tracks)) {
          var tag = mediaTags.id3v1(fs.readFileSync(file))
          if (!tag) {return}
          //console.log(tag)
          try {
            Track.save({
              trackId: uuid.v4(),
              title: safeString(tag.title),
              trackNr: safeString(tag.track).replace(/(^\d+)(.+$)/i,'$1'),
              filePath: file
            }, (err, track) => {
              newDataDb.tracks[safeString(track.trackId)] = track
              //TODO assuming there are no two albums with the same name during the import
              //TODO year
              newData.albums[safeString(tag.album)] = null
              newData.artists[safeString(tag.artist)] = null
              newData.relationships[safeString(track.trackId)] = newData.relationships[safeString(track.trackId)] || {from: safeString(track.trackId), to: safeString(tag.album), type: 'HAS_ALBUM'}
              newData.relationships[safeString(tag.album)] = newData.relationships[safeString(tag.album)] || {from: safeString(tag.album), to: safeString(tag.artist), type: 'HAS_MAIN_ARTIST'}
            })
          } catch (err) {
            console.log(err)
          }
        }
      })
      Track.db = db
      sync.await(tx.commit(sync.defer()))

      var tx = db.batch()
      Album.db = tx
      Object.keys(newData.albums).forEach(album => {
        Album.save({
          albumId: uuid.v4(),
          title: album
        }, function (err, album) {
          newDataDb.albums[album.title] = album
        })
      })
      Album.db = db
      console.log(sync.await(tx.commit(sync.defer())))

      var tx = db.batch()
      Artist.db = tx
      Object.keys(newData.artists).forEach(artist => {
        Artist.save({
          artistId: uuid.v4(),
          name: artist
        }, function (err, artist) {
          newDataDb.artists[artist.name] = artist
        })
      })
      Artist.db = db
      sync.await(tx.commit(sync.defer()))

      var tx = db.batch()
      Object.keys(newData.relationships).forEach(relationship => {
        var rel = newData.relationships[relationship]
        if(rel.type === 'HAS_MAIN_ARTIST') {
          tx.relate(newDataDb.albums[rel.from].id, 'HAS_MAIN_ARTIST', newDataDb.artists[rel.to].id, {main: true})
        } else {
          tx.relate(newDataDb.tracks[rel.from].id, 'HAS_ALBUM', newDataDb.albums[rel.to].id)
        }
      })
      sync.await(tx.commit(sync.defer()))
    })
  } catch (err) {
    console.log(err)
  }
  res.send('scanned')
})