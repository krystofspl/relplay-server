var model = require('seraph-model')

var Track = model(db, 'Track')
Track.schema = {
  title: {type: String},
  trackNr: {type: Number},
  diskNr: {type: Number},
  lyrics: {type: String},
  comments: {type: String},
  playCount: {type: Number, default: 0},
  filePath: {type: String}
}
Track.useTimestamps()
module.exports = Track
