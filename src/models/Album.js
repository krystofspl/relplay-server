var model = require('seraph-model')

var Album = model(db, 'Album')
Album.schema = {
  title: {type: String},
  year: {type: Number},
  comments: {type: String},
  inInbox: {type: Boolean, default: true}
}
Album.useTimestamps()
module.exports = Album
