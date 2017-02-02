var model = require('seraph-model')

var Genre = model(db, 'Genre')
Genre.schema = {
  title: {type: String, required: true},
  description: {type: String},
  color: {type: String}
}
module.exports = Genre
