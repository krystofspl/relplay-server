var model = require('seraph-model')

var Track = model(db, 'track')
Track.schema = {
  title: {type: String, required: true},
  trackNr: {type: Number, min: 0},
  diskNr: {type: Number, min: 0},
  lyrics: {type: String},
  comments: {type: String},
  playCount: {type: Number, min: 0},
  filePath: {type: String, required: true}
}
module.exports = Track
