const ws = require("ws");

class Chat {
	constructor(host, port) {
		this.host = host || "localhost";
		this.port = port || "6942";
		
		this.socket = null;
		
		this.clients = [];
		this.chatters = new Map();
	}
	
	run() {
		this.socket = new ws.Server({
			host: this.host,
			port: this.port
		});
		
		this.socket.on("listening", () => {
			console.log(`Server started on ${this.host}:${this.port}`);
		});
		
		this.socket.on("connection", (client) => {
			client.chat = {
				authorized: false
			};
			
			this.clients.push(client);
			
			client.on("close", () => {
				this.clients.splice(this.clients.indexOf(client), 1);
				
				if (client.chat.authorized) {
					this.chatters.delete(client.chat.nickname);
				}
			});
			client.on("error", (error) => {
				this.error(client, error.message);
			});
			
			client.on("message", (data) => {
				let parsedEvent = null;
				
				try {
					parsedEvent = JSON.parse(data);
				} catch (error) {
					this.error(client, "malformed client-sent event");
					
					return;
				}
				
				if (!parsedEvent || typeof parsedEvent != "object") {
					this.error("client, client-sent event is not an object");
					
					return;
				}
				
				if (!("type" in parsedEvent)) {
					this.error(client, "client-sent event without a type");
					
					return;
				}
				
				this.recieveEvent(client, parsedEvent);
			});
		});
	}
	
	error(client, message) {
		this.sendEvent(client, "error", {
			message: message
		});
		
		client.terminate();
	}
	
	sendEvent(client, type, data) {
		if (!data || typeof data != "object") {
			throw new TypeError("event must be an object");
		}
		
		data.type = type;
		
		client.send(JSON.stringify(data));
	}
	recieveEvent(client, event) {
		switch(event.type) {
		case "join":
			if (client.chat.authorized) {
				this.error(client, "already authorized");
				
				return;
			}
			
			if (!event.nickname || typeof event.nickname != "string") {
				this.error(client, "illegal nickname");
				
				return;
			}
			
			if (this.chatters.has(event.nickname)) {
				this.error(client, "this nickname is already used");
				
				return;
			}
			
			this.chatters.set(event.nickname, client);
			
			client.chat.authorized = true;
			client.chat.nickname = event.nickname;
			
			break;
		case "message":
			if (!client.chat.authorized) {
				this.error(client, "not authorized");
				
				return;
			}
			
			if (typeof event.text != "string") {
				this.error(client, "client-sent message text isn't a string");
				
				return;
			}
			
			for (const [_, chatter] of this.chatters) {
				this.sendEvent(chatter, "message", {
					sender: client.chat.nickname,
					text: event.text
				});
			}
			
			break;
		default:
			this.error(client, "illegal client-sent event type");
			
			break;
		}
	}
}

const chat = new Chat(
	process.argv[2],
	process.argv[3]
);

chat.run();
