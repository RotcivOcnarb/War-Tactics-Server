const dgram = require('dgram');
const server = dgram.createSocket('udp4');

var rooms = [];
var redundancy = 5;
var tokens = {};

server.on('error', (err) => {
  console.log(`server error:\n${err.stack}`);
  server.close();
});

server.on('message', (msg, rinfo) => {
	
	var obj = JSON.parse(msg);
	
	if(obj.path){
		if(tokens[obj.idp]){ //já chegou uma mensagem igual, vê se os dados dela são maiores do que os do q já tem no token
			if(obj.parameters.length > tokens[obj.idp].parameters.length){//o que chegou tava corrompido 
				//e esse novo tem mais dados, executa o código de novo
				tokens[obj.idp] = obj;
				console.log(rinfo.address + " arrived with more data");
				if(callbacks[obj.path]){
					callbacks[obj.path](obj, rinfo);
				}
				else{
					console.log("message path "+obj.path+" not found");
				}
			}
		}
		else{
			tokens[obj.idp] = obj;
			console.log(rinfo.address + " requested " + obj.path);
			if(callbacks[obj.path]){
				callbacks[obj.path](obj, rinfo);
			}
			else{
				console.log("message path "+obj.path+" not found");
			}
		}
		
		if(Object.keys(tokens).length > 1000){
			tokens = {};
			tokens[obj.idp] = obj; //mantem só o ultimo pra nao dar merda
		}
	}
	else{
		console.log("message malformed: ");
		console.log(msg);
	}
});

server.on('listening', () => {
  const address = server.address();
  console.log(`server listening ${address.address}:${address.port}`);
});

var callbacks = {
	"/myIP": function(request, rinfo){
		sendBackData(rinfo.addres, rinfo.port, "/myIP", [rinfo.address]);
	},
	"/rooms" : function(request, rinfo){
		console.log("Rooms requested:");
		rooms.forEach((e) => {
			console.log("/t" + e.id + " | " + e.roomName + " | " + e.players + "/2");
		});
		sendBackData(rinfo.address, rinfo.port, "/rooms", rooms.map(function(e) { return JSON.stringify(e);}));
	},
	"/createRoom": function(request, rinfo){
		var hostIP = rinfo.address;
		var roomName = request.parameters[0];
		var password = request.parameters[1];
		var roomID = generateId5();
		while(getRoom(roomID)){
			roomID = generateId5();
		}
		
		var roomData = {
			"id": roomID,
			"roomName": roomName,
			"hostIP": hostIP,
			"password": password,
			"players": 0,
			"player_data": {}
		};
		rooms.push(roomData);
		
		sendBackData(rinfo.address, rinfo.port, "/createRoom", [JSON.stringify(roomData)]);
		
	},
	"/enterRoom": function(request, rinfo){
		var roomID = request.parameters[0];		
		var room = getRoom(roomID);
		
		if(room.players < 2 && !room.player_data[rinfo.address]){
			room.player_data[rinfo.address] = {
				"IP": rinfo.address,
				"port": rinfo.port,
				"heroes": [],
				"ready": false
			};
			room.players = Object.keys(room.player_data).length;
		}
		
		sendBackData(rinfo.address, rinfo.port, "/enterRoom", ["Success"]);
		
		var oponentIP = getOponentIP(room, rinfo.address);
		if(room.player_data[oponentIP])	//Tem que avisar ao oponente que eu acabei de entrar na sala
			sendBackData(oponentIP, room.player_data[oponentIP].port, "/oponentEnteredRoom", []);
		
	},
	"/exitRoom": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		
		if(!room) return;
		
		if(room.player_data[rinfo.address]){
			room.player_data[rinfo.address] = undefined;
			room.players = Object.keys(room.player_data).length;
			
			var oponentIP = getOponentIP(room, rinfo.address);
			if(oponentIP)
				if(room.player_data[oponentIP])
					sendBackData(oponentIP, room.player_data[oponentIP].port, "/exitRoom", [rinfo.address]);
			
			if(room.players == 0)
				removeRoom(roomID);
		}
	},
	"/finishHeroSelection": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		
		if(room.player_data[rinfo.address]){
			room.player_data[rinfo.address].heroes = [
				request.parameters[1],
				request.parameters[2],
				request.parameters[3],
				request.parameters[4],
				request.parameters[5],
			];
		}
		
		var oponentIP = getOponentIP(room, rinfo.address);
		if(room.player_data[oponentIP])	//Tem que avisar ao oponente (se tiver um) que eu terminei de escolher os heróis
			sendBackData(oponentIP, room.player_data[oponentIP].port, "/oponentSelectedHeroes", room.player_data[rinfo.address].heroes);

	},
	"/requestOponentHeroes": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		
		var player0 = Object.keys(room.player_data)[0];
		var player1 = Object.keys(room.player_data)[1]; //se eu to sozinho, isso dá undefined;
		
		if(!player1){
			return;
		}
		var oponentIP = getOponentIP(room, rinfo.address);
		if(room.player_data[oponentIP].heroes.length == 5){
			//Devolve os heróis q o oponente escolheu;
			sendBackData(rinfo.address, rinfo.port, "/oponentSelectedHeroes", room.player_data[oponentIP].heroes);
			
			if(room.player_data[oponentIP].ready)
				sendBackData(rinfo.address, rinfo.port, "/oponentCheckReady", []);
			
			return;
		}
		else{
			//Devolve q o oponente ainda não escolheu os heróis dele
			sendBackData(rinfo.address, rinfo.port, "/oponentEnteredRoom", []);
		}
		
	},
	"/checkReady": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		
		room.player_data[rinfo.address].ready = true;
		
		sendBackData(rinfo.address, rinfo.port, "/checkReady", []);
		
		var oponentIP = getOponentIP(room, rinfo.address);
		if(room.player_data[oponentIP])
			sendBackData(oponentIP, room.player_data[oponentIP].port, "/oponentCheckReady", []);
	},
	"/uncheckReady": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		
		room.player_data[rinfo.address].ready = false;
		
		sendBackData(rinfo.address, rinfo.port, "/uncheckReady", []);
		
		var oponentIP = getOponentIP(room, rinfo.address);
		if(room.player_data[oponentIP])
			sendBackData(oponentIP, room.player_data[oponentIP].port, "/oponentUncheckReady", []);
	},
	"/gameStart": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		
		//gera um dos dois players aleatóriamente, e esse q vai ser o primeiro turno
		var firstTurnPlayer = Object.keys(room.player_data)[parseInt(Math.random() * 2)];
		sendBackData(rinfo.address, rinfo.port, "/gameStart", [firstTurnPlayer]);
		
		var oponentIP = getOponentIP(room, rinfo.address);
		sendBackData(oponentIP, room.player_data[oponentIP].port, "/gameStart", [firstTurnPlayer]);
	},
	"/turnPass": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		var oponentIP = getOponentIP(room, rinfo.address);
		sendBackData(oponentIP, room.player_data[oponentIP].port, "/oponentTurnPass", []);
		sendBackData(rinfo.address, rinfo.port, "/turnPass", []);
	},
	"/heroesPositions": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		var oponentIP = getOponentIP(room, rinfo.address);
		request.parameters.shift();
		sendBackData(oponentIP, room.player_data[oponentIP].port, "/heroesPositions", request.parameters);
	},
	"/heroMove": function(request, rinfo){
		var roomID = request.parameters[0];
		var room = getRoom(roomID);
		var oponentIP = getOponentIP(room, rinfo.address);
		request.parameters.shift();
		sendBackData(oponentIP, room.player_data[oponentIP].port, "/oponentMoveHero", request.parameters);
	}
	
};

function getOponentIP(room, address){
	var player0 = Object.keys(room.player_data)[0];
	var player1 = Object.keys(room.player_data)[1];
	
	if(!player1) return null;
	if(player0 == address) return player1;
	if(player1 == address) return player0;
	return null;
}

function sendBackData(address, port, path, parameters){
	var obj = {
		"path":  path,
		"parameters": parameters,
		"idp": generateId10()
	};
	var message = Buffer.alloc(JSON.stringify(obj).length, JSON.stringify(obj), "utf8");
	console.log("Sending message " + path + " to " + address);
	var client = dgram.createSocket('udp4');
	for(var i = 0; i < redundancy; i ++){
		client.send(message, 0, message.length, port, address, function(err, bytes) {
			if (err) throw err;	
				console.log("Message sent");
				if(i == 4){
					client.close();
				}
				
		});
	}
}

function getRoom(id){
	for(var i = 0; i < rooms.length; i ++){
		if(rooms[i].id == id){
			return rooms[i];
		}
	}
}

function removeRoom(id){
	for(var i = 0; i < rooms.length; i ++){
		if(rooms[i].id == id){
			rooms[i] = undefined;
		}
	}
	rooms = rooms.filter((e) => { return e != undefined});
}

function generateId10(){
	return generateId5() + generateId5();
}

function generateId5(){
	var letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
	var id = "";
	for(var i = 0; i < 5; i ++){
		id += letters[parseInt(Math.random() * letters.length)];
	}
	return id;
}
server.bind(1337, process.argv[2]);