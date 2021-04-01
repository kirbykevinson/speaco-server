const ws = require("ws");

class Chat {
	constructor(host, port) {
		this.host = host || "localhost";
		this.port = port || "6942";
		
		this.socket = null;
		
		this.clients = [];
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
			this.clients.push(client);
			
			client.on("close", () => {
				this.clients.splice(this.clients.indexOf(client), 1);
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
