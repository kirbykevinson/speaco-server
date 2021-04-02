const ws = require("ws");

class Chat {
	constructor(host, port) {
		this.host = host || "localhost";
		this.port = port || "6942";
		
		this.socket = null;
		
		this.clients = [];
		this.chatters = new Map();
		
		this.log = [];
		this.attachments = new Map();
	}
	
	run() {
		this.socket = new ws.Server({
			host: this.host,
			port: this.port,
			
			maxPayload: Math.pow(2, 20)
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
					
					this.sendMessage(null, `${client.chat.nickname} left`);
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
					this.error(client, "client-sent event is not an object");
					
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
			
			if (
				!event.nickname ||
				typeof event.nickname != "string" ||
				event.nickname.includes("\n")
			) {
				this.error(client, "illegal nickname");
				
				return;
			}
			
			if (this.chatters.has(event.nickname)) {
				this.error(client, "this nickname is already used");
				
				return;
			}
			
			client.chat.authorized = true;
			client.chat.nickname = event.nickname;
			
			this.chatters.set(event.nickname, client);
			
			this.sendEvent(client, "welcome", {});
			
			for (const message of this.log) {
				this.sendEvent(client, "message", message);
			}
			
			this.sendMessage(null, `${event.nickname} joined the party`);
			
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
			
			this.sendMessage(client.chat.nickname, event.text);
			
			break;
		case "add-attachment":
			if (!client.chat.authorized) {
				this.error(client, "not authorized");
				
				return;
			}
			
			if (typeof event.data != "string") {
				this.error(client, "client-sent attachment data isn't a string");
				
				return;
			}
			
			const id = this.generateAttachmentId();
			
			this.attachments.set(id, event.data);
			
			this.sendEvent(client, "attachment-added", {
				id: id
			});
			
			break;
		case "fetch-attachment":
			if (!client.chat.authorized) {
				this.error(client, "not authorized");
				
				return;
			}
			
			if (typeof event.id != "string") {
				this.error(client, "client-sent attachment id isn't a string");
				
				return;
			}
			
			if (!this.attachments.has(event.id)) {
				this.error(client, "this attachment doesn't exist");
				
				return;
			}
			
			this.sendEvent(client, "attachment-fetched", {
				data: this.attachments.get(event.id)
			});
			
			break;
		default:
			this.error(client, "illegal client-sent event type");
			
			break;
		}
	}
	
	sendMessage(sender, text) {
		const message = {
			sender: sender,
			text: text,
			timestamp: (new Date()).toISOString()
		};
		
		for (const [_, chatter] of this.chatters) {
			this.sendEvent(chatter, "message", message);
		}
		
		this.log.push(message);
		
		if (this.log.length > 100) {
			this.log.shift();
		}
	}
	
	generateAttachmentId() {
		let id = null;
		
		do {
			id = "";
			
			for (let i = 0; i < 10; i++) {
				id += Math.floor(
					1 + Math.random() * 0x10000
				).toString(16).slice(1);
			}
		} while (this.attachments.has(id));
		
		return id;
	}
}

const chat = new Chat(
	process.argv[2],
	process.argv[3]
);

chat.run();
