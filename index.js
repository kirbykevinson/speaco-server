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
		
		this.eventHandlers = {
			"join": this.onJoin,
			"message": this.onMessage,
			"delete-message": this.onDeleteMessage,
			"add-attachment": this.onAddAttachment,
			"fetch-attachment": this.onFetchAttachment
		};
		
		this.limits = {
			eventSize: 6 * 2 ** 20,
			nicknameLength: 32,
			messageLength: 1024,
			attachmentSize: 5 * 2 ** 20
		};
	}
	
	run() {
		this.socket = new ws.Server({
			host: this.host,
			port: this.port,
			
			maxPayload: this.limits.eventSize
		});
		
		this.socket.on("listening", () => {
			console.log(`Server started on ${this.host}:${this.port}`);
		});
		
		this.socket.on("connection", (client) => {
			client.chat = {
				authorized: false,
				currentMessageId: 0
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
			
			client.on("message", (message) => {
				let event = null;
				
				try {
					event = JSON.parse(message);
				} catch (error) {
					this.error(client, "malformed client-sent event");
					
					return;
				}
				
				if (!event || typeof event != "object") {
					this.error(client, "client-sent event is not an object");
					
					return;
				}
				
				if (!("type" in event)) {
					this.error(client, "client-sent event without a type");
					
					return;
				}
				
				if (!this.eventHandlers.hasOwnProperty(event.type)) {
					this.error(client, "illegal client-sent event type");
					
					return;
				}
				
				this.eventHandlers[event.type].call(this, client, event);
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
	
	onJoin(client, event) {
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
		if (event.nickname.length > this.limits.nicknameLength) {
			this.error(client, "this nickname is too long");
			
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
	}
	onDeleteMessage(client, event) {
		if (!client.chat.authorized) {
			this.error(client, "not authorized");
			
			return;
		}
		
		if (typeof event.id != "number") {
			this.error(client, "client-sent message id isn't a number");
			
			return;
		}
		
		this.deleteMessage(client, event.id);
	}
	onMessage(client, event) {
		if (!client.chat.authorized) {
			this.error(client, "not authorized");
			
			return;
		}
		
		if (typeof event.text != "string") {
			this.error(client, "client-sent message text isn't a string");
			
			return;
		}
		if (event.text.length > this.limits.messageLength) {
			this.error(client, "client-sent message text is too long");
			
			return;
		}
		
		if (event.attachment) {
			if (typeof event.attachment != "string") {
				this.error(client, "client-sent message attachment isn't a string");
				
				return;
			}
			
			if (!this.attachments.has(event.attachment)) {
				this.error(client, "client-sent message attachment doesn't extst");
				
				return;
			}
		}
		
		this.sendMessage(client, event.text, event.attachment);
	}
	onAddAttachment(client, event) {
		if (!client.chat.authorized) {
			this.error(client, "not authorized");
			
			return;
		}
		
		if (typeof event.data != "string") {
			this.error(client, "client-sent attachment data isn't a string");
			
			return;
		}
		if (event.data.length > this.limits.attachmentSize) {
			this.error(client, "client-sent attachment data is too long");
			
			return;
		}
		
		const id = this.generateAttachmentId();
		
		this.attachments.set(id, event.data);
		
		this.sendEvent(client, "attachment-added", {
			id: id
		});
	}
	onFetchAttachment(client, event) {
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
	}
	
	sendMessage(sender, text, attachment) {
		const message = {
			sender: null,
			id: null,
			text: text,
			attachment: attachment,
			timestamp: (new Date()).toISOString()
		};
		
		if (sender) {
			message.sender = sender.chat.nickname;
			message.id = sender.chat.currentMessageId++;
		}
		
		for (const [_, chatter] of this.chatters) {
			this.sendEvent(chatter, "message", message);
		}
		
		this.log.push(message);
		
		if (this.log.length > 100) {
			this.log.shift();
		}
	}
	deleteMessage(sender, id) {
		this.log = this.log.filter((message) => {
			if (message.sender == sender.chat.nickname && message.id == id) {
				return false;
			}
			
			return true;
		});
		
		for (const [_, chatter] of this.chatters) {
			this.sendEvent(chatter, "message-deleted", {
				sender: sender.chat.nickname,
				id: id
			});
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
