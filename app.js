var http = require('http');
var express = require('express');
var app = express();
var server = http.createServer(app);
var io = require('socket.io')(server);
var async = require('async');
var path = require('path');
var compress = require('compression');

function compare(a,b) {
  if (a.evaluation < b.evaluation)
    return 1;
  if (a.evaluation > b.evaluation)
    return -1;
  return 0;
}

function getPlayers (serverID, callback) {
    console.log(serverID)
    
    return http.get({
        host: 'battlelog.battlefield.com',
        path: '/bf3/servers/getPlayersOnServer/pc/' + serverID + '/'
    }, function (response) {
        var body = '';
        response.on('data', function (d) {
            body += d;
        });
        response.on('end', function() {
            var parsed = JSON.parse(body).players;
            var players = parsed.map(function (e) {
                return {user:e.persona.personaName, evaluation: '', id: e.persona.personaId};
            })
            callback(players);
        });
    });
};

function checkPlayerCheat (username, callback) {
    http.get({
        host: 'www.frstats.net',
        path: '/CheatEvaluator.php?Joueur=' + username
    }, function (response) {
        console.log(response.statusCode);
        var body = '';
        //console.log('Path:', '/CheatEvaluator.php?Joueur=' + username);
        response.on('data', function (d) {
            body += d;
        });
        response.on('ECONNRESET', function () {
            console.log('ECONNRESET');
        })
        response.on('error', function (mgs) {
            console.log('msg', 'error')
        })
        response.on('end', function () {
            var splitted = body.split("\n")
            for (var i = 0; i < splitted.length; i++) {
                if (splitted[i].length === 241) {
                    break;
                }
            }
            
            if (splitted[i + 1] === undefined) {
                return callback(null)
            }
            
            var evaluation = splitted[i+1].split('(')[1].split(')')[0];
            evaluation = Number(evaluation.substring(0,evaluation.length - 2));
            callback(evaluation);
        });
    }).on('error', function (err) {
        console.log('error!!!', err, username);
        if (err.code === 'ETIMEDOUT') {
            checkPlayerCheat(username, function (evaluation) {
                callback(evaluation);
                console.log('gotta ETIMEDOUT, retried')
            })
        } else {
            callback(null);
        }
        //callback(null)
    })
};

function getServerCheats (server, socket, cb) {
    async.waterfall(
        [function (cb) {
            getPlayers(server, function (players) {
                cb(null, players, socket);
            });
        },
        function (players, socket, cb) {
            var q = async.queue(function (player, callback) {
                checkPlayerCheat(player.user, function (evaluation) {
                    player.evaluation = evaluation;
                    setTimeout(function() {
                    //console.log(100 - (q.length()*100)/players.length)
                    
                        socket.emit('percent', Math.round(100 - (q.length()*100)/players.length));
                        //console.log('waited 30ms before releasing');
                        callback();
                    }, 30)
                });
            }, 12);
            q.push(players)
            q.drain = function () {
                cb(null, players);
            }
        }], 
        function (err, players) {
            players = players.sort(compare);
            for (var i = 0; i < players.length; i++) {
                if (players[i].evaluation === null) {
                    //console.log(i, players[i].user + ' (' + '?%), Probably changed his username'); 
                } else {
                    //console.log(i + 1, players[i].user + ' (' + players[i].evaluation + '%)');  
                }
            };
            cb(players);
        }
    );
};

function getServerNameAndID (url) {
    var splitted = url.split('-');
    var serverName = splitted.slice(5).join(' ').replace(/\//g, " ");
    splitted[0] = splitted[0].substring(splitted[0].lastIndexOf('/') + 1);
    splitted[4] = splitted[4].substring(0, splitted[4].indexOf('/'));
    var serverID = splitted.slice(0, 5).join('-');
    return {id: serverID, name: serverName};
};

app
    .set('view engine', 'jade')
    .use(compress())
    .set('views', __dirname)
    .route('/').get(function (req, res) {
        res.render('index.jade');
    });

io.on('connection', function (socket) {
    socket.on('check', function (data) {
        console.log(data)
        if (data && data.indexOf('battlelog.battlefield.com') !== -1) {
            var serverInfo = getServerNameAndID(data);
            getServerCheats(serverInfo.id, socket, function (players) {
                socket.emit('check', {players: players, name: serverInfo.name});
            })
        } else {
            socket.emit('invalidURL', 'Invalid URL ' + data);
        }
    })
})


var ipaddress = process.env.OPENSHIFT_NODEJS_IP || "127.0.0.1";
var port = process.env.OPENSHIFT_NODEJS_PORT || 8080;

server.listen(port, ipaddress, function () {
    console.log('Server launched at port 4000');
});