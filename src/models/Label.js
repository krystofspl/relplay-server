var model = require('seraph-model')

var Label = model(db, 'Label')
Label.schema = {
  title: {type: String},
  description: {type: String}
}
Label.useTimestamps()
// Label.setUniqueKey('title', true)
module.exports = Label
