var model = require('seraph-model')

var Genre = model(db, 'Genre')
Genre.schema = {
  title: {type: String},
  description: {type: String},
  color: {type: String}
}
module.exports = Genre
