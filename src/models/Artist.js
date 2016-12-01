var model = require('seraph-model')

var Artist = model(db, 'Artist')
Artist.schema = {
  artistId: {type: String, required: true},
  name: {type: String, required: true},
  sortName: {type: String},
  bio: {type: String}
}
Artist.useTimestamps()
Artist.setUniqueKey('name', true)
module.exports = Artist
