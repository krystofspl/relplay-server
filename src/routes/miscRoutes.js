var Album = require('../models/Album.js')
var Artist = require('../models/Artist.js')
var Track = require('../models/Track.js')

var rescanState = {
  status: 'done',
  newFiles: [],
  missingFiles: [],
  tracksAdded: [],
  errMsg: null
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
      var albumsResult = sync.await(db.query(albumsQuery, sync.defer()))
      for (i = 0; i < albumsResult.length; i++) {
        var e = albumsResult[i]
        var albumNode = {
          id: e.id,
          artistId: e.artist
        }
        if (albumsDB[e.title]) {
          albumsDB[e.title].push(albumNode)
        } else {
          albumsDB[e.title] = [albumNode]
        }
      }

      var artistsQuery = ' \
        MATCH (a:Artist) \
        RETURN ID(a) as id, a.name as name \
      '
      var artistsResult = sync.await(db.query(artistsQuery, sync.defer()))
      for (i = 0; i < artistsResult.length; i++) {
        var e = artistsResult[i]
        artistsDB.idMapping[e.id] = {
          name: e.name
        }
        artistsDB.nameMapping[e.name] = {
          id: e.id
        }
      }
      if (checkStopCondition()) { rescanState.status = 'stopped'; return }

      // Get new and missing files from the lists
      _.remove(files, n => {
        // TODO more formats
        return n.split('.').reverse()[0].toLowerCase() != 'mp3'
      })
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


      // Temporarily create new files as tracks, albums, artists and relationships
      // TODO? add checkStopCondition() inside the loop? this might take long
      var trackIdCounter = 0
      var albumIdCounter = 0
      var artistIdCounter = 0
      for (i = 0; i < newFiles.length; i++) {
        var filePath = newFiles[i]
        var currentFilePath = path.join(global.libraryPath, filePath)

        // Read ID tags from the music files
        // TODO sometimes {"errno":-9,"code":"EBADF","syscall":"read"}
        var readStream = fs.createReadStream(currentFilePath)
        var metadata = sync.await(metadataReader(readStream, {duration: true}, sync.defer()))
        readStream.close()

        // Create a temporary representation of the data
        var newTrack = {
          tempId: 'temp'+trackIdCounter,
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
          for (j = 0; j < albumsDB[album].length; j++) {
            var albumItem = albumsDB[album][j]
            if (relCreated) break;
            if (stringSimilarity.compareTwoStrings(artist, artistsDB.idMapping[albumItem.artistId].name) > 0.8) {
              newData.rels.push({
                from: newTrack.tempId,
                to: albumItem.id,
                type: 'HAS_ALBUM'
              })
              relCreated = true
            }
          }
        }
        // If the track's album is not in DB but is an album already to be added, connect it
        if (!relCreated && newData.albums[album]) {
          for (j = 0; j < newData.albums[album].length; j++) {
            var albumItem = newData.albums[album][j]
            if (stringSimilarity.compareTwoStrings(artist, newData.artists[albumItem.artistId].name) > 0.8) {
              if (relCreated) break;
              newData.rels.push({
                from: newTrack.tempId,
                to: albumItem.tempId,
                type: 'HAS_ALBUM'
              })
              relCreated = true
            }
          }
        }
        // Didn't find appropriate album => add album, artist and the connection
        if (!relCreated) {
          // Get/create artist
          var artistId = null
          var artistTemporary = null
          if (artistsDB.nameMapping[artist]) {
            artistId = artistsDB.nameMapping[artist].id
            artistTemporary = false // connecting with existing DB entity
          } else if (_.findKey(newData.artists, a => {return a.name === artist})) {
            artistId = _.findKey(newData.artists, a => {return a.name === artist})
            artistTemporary = true // connecting with entity to be added to DB
          } else {
            newData.artists['temp'+artistIdCounter] = {
              name: artist
            }
            artistId = 'temp'+artistIdCounter
            artistTemporary = true // connecting with entity to be added to DB
            artistIdCounter++;
          }
          // Create temp album
          var albumNode = {
            tempId: 'temp'+albumIdCounter,
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
            type: 'HAS_MAIN_ARTIST',
            temp: artistTemporary
          })
        }
      }
      if (checkStopCondition()) { rescanState.status = 'stopped'; return }


      // Save new entities to DB
      // TODO there might be a lot of new entities, split the transactions to batches by fixed size
      var newOldIDsMapping = {
        tracks: {},
        albums: {},
        artists: {}
      }
      // Save new artists and get their DB IDs
      var tx = db.batch()
      Artist.db = tx
      for (i = 0; i < Object.keys(newData.artists).length; i++) {
        var artist = Object.values(newData.artists)[i]
        Artist.save({
          name: artist.name
        })
      }
      Artist.db = db
      var savedArtists = _.flattenDeep(sync.await(tx.commit(sync.defer())))
      for (i = 0; i < savedArtists.length; i++) {
        var savedArtist = savedArtists[i]
        var newID = savedArtist.id
        var oldID = _.findKey(newData.artists, a => {return a.name === savedArtist.name})
        if (oldID && newID) newOldIDsMapping.artists[oldID] = newID
      }
      // Save new albums and get their DB IDs
      // TODO (solve if rescan too slow) ideally a transaction would be used, but then the received saved albums could have the same attributes but different ID (for albums with the same title, which might occur). that makes it hard to map the new IDs to the old for the creation of the rels
      var albumTitles = Object.keys(newData.albums)
      for (i = 0; i < albumTitles.length; i++) {
        var albumTitle = albumTitles[i]
        for (j = 0; j < newData.albums[albumTitle].length; j++) {
          var album = newData.albums[albumTitle][j]
          var savedAlbum = sync.await(Album.save({
            title: albumTitle,
            year: album.year
          }, sync.defer()))
          newOldIDsMapping.albums[album.tempId] = savedAlbum.id
        }
      }
      // Save new tracks and get their DB IDs
      // TODO (solve if rescan too slow) change to transaction(s)
      for (i = 0; i < newData.tracks.length; i++) {
        var track = newData.tracks[i]
        var savedTrack = sync.await(Track.save({
          filePath: track.filePath,
          duration: track.duration,
          title: track.title,
          trackNr: track.trackNr
        }, sync.defer()))
        newOldIDsMapping.tracks[track.tempId] = savedTrack.id
        rescanState.tracksAdded.push(savedTrack)
      }
      // Save rels
      var tx = db.batch()
      for (i = 0; i < newData.rels.length; i++) {
        var rel = newData.rels[i]
        var from, to
        if (rel.type === 'HAS_ALBUM') {
          // Tracks are always new, albums can be new or existing
          from = newOldIDsMapping.tracks[rel.from]
          to = newOldIDsMapping.albums[rel.to] || rel.to
        } else if (rel.type === 'HAS_MAIN_ARTIST') {
          // Both albums and artists can be new or existing
          from = newOldIDsMapping.albums[rel.from] || rel.from
          to = newOldIDsMapping.artists[rel.to] || rel.to
        }
        tx.relate(from, rel.type, to)
      }
      sync.await(tx.commit(sync.defer()))

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
