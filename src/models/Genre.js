var model = require('seraph-model')

var Genre = model(db, 'genre')
Genre.schema = {
  name: {type: String, required: true},
  otherNames: {type: Array},
  description: {type: String},
  color: {type: String, required: true}
}
module.exports = Genre
