// Set global vars here
var config = {
  serverAddr: 'http://localhost:8079/',
  db: require('seraph')({
    server: 'http://localhost:7474',
    user: 'neo4j',
    pass: 'password'
  }),
  //'/home/krystof/Code/School/graph_music_library/library/'
  libraryPath: '/mnt/G/Hudba'
}

for (var c in config) global[c] = config[c]
