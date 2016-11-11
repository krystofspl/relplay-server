var model = require('seraph-model')

var Artist = model(db, 'artist')
Artist.schema = {
  name: {type: String, required: true},
  sortName: {type: String},
  bio: {type: String}
}
module.exports = Artist
