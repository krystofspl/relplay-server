var model = require('seraph-model')

var Album = model(db, 'album')
Album.schema = {
  title: {type: String, required: true},
  year: {type: Number, min: 1000, max: 5000},
  comments: {type: String},
  playCount: {type: Number, min: 0},
  mainArtist: {type: Number, required: true},
  artworkPath: {type: String},
  dateAdded: {type: Date}
}
module.exports = Album
