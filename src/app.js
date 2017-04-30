require('./config')
require('./helpers/appHelpers')

var express = require('express')
var fs = require('fs')
var path = require('path')
bodyParser = require('body-parser')
sync = require('synchronize')
var corser = require('corser')

app = express()

app.use(bodyParser.json())

// Setup CORS
// TODO inspect functionality
app.use(corser.create({
    methods: corser.simpleMethods.concat(["PUT", "PATCH", "DELETE"]),
    requestHeaders: corser.simpleRequestHeaders.concat(["X-Requested-With"])
}))
app.all('*', function(request, response, next) {
    response.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Authorization, Access-Control-Allow-Origin, Accept, Origin');
    response.header('Access-Control-Allow-Methods', 'POST, GET, DELETE');
    response.header('Access-Control-Allow-Origin', '*');
    next();
})

process.on('uncaughtException', (err) => {
  fs.writeSync(1, `Caught exception: ${JSON.stringify(err)}`);
});


//--------------------------------------------------------------------------------- ROUTES

// ENTITY ROUTES

require('./routes/artistRoutes.js')
require('./routes/albumRoutes.js')
require('./routes/trackRoutes.js')
require('./routes/genreRoutes.js')
require('./routes/labelRoutes.js')
require('./routes/playlistRoutes.js')
require('./routes/relationshipRoutes.js')
require('./routes/graphRoutes.js')
require('./routes/miscRoutes.js')


//---------------------------------------------------------------------------------

app.listen(8079, function () {
  console.log('Graph Music Library backend listening at ' + global.serverAddr + '!')
})