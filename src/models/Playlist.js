var model = require('seraph-model')

var Playlist = model(db, 'Playlist')
Playlist.schema = {
  name: {type: String}
}
Playlist.useTimestamps()
module.exports = Playlist
