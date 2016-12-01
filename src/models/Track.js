var model = require('seraph-model')

var Track = model(db, 'Track')
Track.schema = {
  trackId: {type: String, required: true},
  title: {type: String, required: true},
  trackNr: {type: Number, min: 0},
  diskNr: {type: Number, min: 0},
  lyrics: {type: String},
  comments: {type: String},
  playCount: {type: Number, min: 0, default: 0},
  filePath: {type: String, required: true}
}
Track.useTimestamps()
module.exports = Track
