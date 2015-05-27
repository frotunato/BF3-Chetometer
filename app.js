var http = require('http');
var express = require('express');
var app = express();
var server = http.createServer(app);
var io = require('socket.io')(server);
var async = require('async.js');
var path = require('path');
var compress = require('compression');
var players = [];

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
            players = parsed.map(function (e) {
                return {user:e.persona.personaName, evaluation: '', id: e.persona.personaId};
            })
            callback(players);
        });
    });
};

function checkPlayerCheat (username, callback) {
    return http.get({
        host: 'www.frstats.net',
        path: '/CheatEvaluator.php?Joueur=' + username
    }, function (response) {
        var body = '';
        //console.log('Path:', '/CheatEvaluator.php?Joueur=' + username);
        response.on('data', function (d) {
            body += d;
        });
        response.on('end', function () {
            var splitted = body.split("\n")
            //console.log(body)
            for (var i = 0; i < splitted.length; i++) {
                if (splitted[i].length === 241) {
                    break;
                }
            };
            
            if (splitted[i + 1] === undefined) {
                return callback(null)
            }
            
            var evaluation = splitted[i+1].split('(')[1].split(')')[0];
            evaluation = Number(evaluation.substring(0,evaluation.length-2))
            callback(evaluation);
        });
    });
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
                    console.log(q.length())
                    socket.emit('percent', Math.round(100 - (q.length()*100)/players.length));
                    player.evaluation = evaluation;
                    setTimeout(function() {
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
        function (err, playes) {
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

app
    .set('view engine', 'jade')
    .use(compress())
    .set('views', __dirname)
    .route('/').get(function (req, res) {
        res.render('index.jade');
    });

io.on('connection', function (socket) {
    socket.on('check', function (data) {
        if (data) {
            data = data.replace(":80", "");
            console.log(data);
            var index = data.indexOf('battlelog.battlefield.com/bf3/servers/show/pc/');
            if (index !== -1) {
                index = index + 46
                var serverID = data.substring(index, index + 36);
                var serverName = data.substring(index + 36).replace(/-/g, " ").replace(/\//g, " ");
                getServerCheats(serverID, socket, function (players) {
                    socket.emit('check', {players: players, name: serverName});
                })
            } else {
                socket.emit('invalidURL', 'Invalid URL');
            }
        }
    })
})


var ipaddress = process.env.OPENSHIFT_NODEJS_IP || "127.0.0.1";
var port = process.env.OPENSHIFT_NODEJS_PORT || 8080;

server.listen(port, ipaddress, function () {
    console.log('Server launched at port 4000');
});