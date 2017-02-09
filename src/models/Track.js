var model = require('seraph-model')

var Track = model(db, 'Track')
Track.schema = {
  title: {type: String, required: true},
  trackNr: {type: Number},
  diskNr: {type: Number},
  lyrics: {type: String},
  comments: {type: String},
  playCount: {type: Number, default: 0},
  filePath: {type: String, required: true}
}
Track.useTimestamps()
module.exports = Track
