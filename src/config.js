var path = require('path')
// Set global vars here
var config = {
  serverAddr: 'http://localhost:8079/',
  db: require('seraph')({
    server: 'http://localhost:7474',
    user: 'neo4j',
    pass: 'password'
  }),
  libraryPath: '/mnt/G/Hudba/',
  appRoot: path.resolve(path.join(__dirname, '..'))
}

for (var c in config) global[c] = config[c]
