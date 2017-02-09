var model = require('seraph-model')

var Album = model(db, 'Album')
Album.schema = {
  title: {type: String},
  year: {type: Number, min: 1000, max: 5000},
  comments: {type: String},
  inInbox: {type: Boolean, default: true}
}
Album.useTimestamps()
module.exports = Album
