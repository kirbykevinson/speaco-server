const
	ws = require("ws"),
	fs = require("fs");

class Chat {
	constructor(host = "localhost", port = "6942") {
		this.host = host;
		this.port = port;
		
		this.socket = null;
		
		this.clients = [];
		this.chatters = new Map();
		
		this.chatterData = new Map();
		this.history = [];
		this.attachments = new Map();
		
		this.eventHandlers = {
			"join": this.onJoin,
			"message": this.onMessage,
			"edit-message": this.onEditMessage,
			"delete-message": this.onDeleteMessage,
			"add-attachment": this.onAddAttachment,
			"fetch-attachment": this.onFetchAttachment
		};
		
		this.limits = {
			eventSize: 6 * 2 ** 20,
			nicknameLength: 32,
			historySize: 128,
			messageLength: 1024,
			attachmentSize: 5 * 2 ** 20
		};
	}
	
	run() {
		this.readBackup();
		
		process.on("SIGINT", () => {
			this.stop();
			
			process.exit(0);
		});
		
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
	stop() {
		this.sendMessage(null, "The server shut down");
		
		this.writeBackup();
		
		for (const client of this.clients) {
			this.sendEvent(client, "bye", {})
			
			client.terminate();
		}
	}
	
	readBackup() {
		let fileContents = "";
		
		try {
			fileContents = fs.readFileSync("speaco-backup.json");
		} catch (_) {}
		
		if (!fileContents) {
			return;
		}
		
		const backup = JSON.parse(fileContents);
		
		this.chatterData = new Map(Object.entries(backup["chatter-data"]));
		this.history = backup["history"];
		this.attachments = new Map(Object.entries(backup["attachments"]));
	}
	writeBackup() {
		const backup = {
			"chatter-data": Object.fromEntries(this.chatterData),
			"history": this.history,
			"attachments": Object.fromEntries(this.attachments)
		};
		
		try {
			fs.writeFileSync("speaco-backup.json", JSON.stringify(backup));
		} catch (_) {}
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
		
		this.authorizeClient(client, event.nickname);
	}
	onMessage(client, event) {
		if (!client.chat.authorized) {
			this.error(client, "not authorized");
			
			return;
		}
		
		if (!this.checkMessageEvent(client, event)) {
			return;
		}
		
		this.sendMessage(client, event.text, event.attachment);
	}
	onEditMessage(client, event) {
		if (!client.chat.authorized) {
			this.error(client, "not authorized");
			
			return;
		}
		
		if (!this.checkMessageEvent(client, event)) {
			return;
		}
		
		if (typeof event.id != "number") {
			this.error(client, "client-sent message id isn't a number");
			
			return;
		}
		
		this.editMessage(client, event.id, event.text, event.attachment);
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
	onAddAttachment(client, event) {
		if (!client.chat.authorized) {
			this.error(client, "not authorized");
			
			return;
		}
		
		if (event.name && typeof event.name != "string") {
			this.error(client, "client-sent attachment name isn't a string");
			
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
		
		this.addAttachment(client, event.name, event.data);
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
		
		this.fetchAttachment(client, event.id);
	}
	
	checkMessageEvent(client, event) {
		if (typeof event.text != "string") {
			this.error(client, "client-sent message text isn't a string");
			
			return false;
		}
		if (event.text.length > this.limits.messageLength) {
			this.error(client, "client-sent message text is too long");
			
			return false;
		}
		
		if (event.attachment) {
			if (typeof event.attachment != "string") {
				this.error(client, "client-sent message attachment isn't a string");
				
				return false;
			}
			
			if (!this.attachments.has(event.attachment)) {
				this.error(client, "client-sent message attachment doesn't extst");
				
				return false;
			}
		}
		
		return true;
	}
	
	authorizeClient(client, nickname) {
		if (!this.chatterData.has(nickname)) {
			this.chatterData.set(nickname, {
				currentMessageId: 0
			});
		}
		
		client.chat.authorized = true;
		client.chat.nickname = nickname;
		client.chat.data = this.chatterData.get(nickname);
		
		this.chatters.set(nickname, client);
		
		this.sendEvent(client, "welcome", {});
		
		this.sendEvent(client, "messages", {
			messages: this.history
		});
		
		this.sendMessage(null, `${nickname} joined the party`);
	}
	
	sendMessage(sender, text, attachment) {
		const message = {
			sender: null,
			id: null,
			
			text: text,
			attachment: attachment,
			
			timestamp: (new Date()).toISOString(),
			edited: false
		};
		
		if (sender) {
			message.sender = sender.chat.nickname;
			message.id = sender.chat.data.currentMessageId++;
		}
		
		this.history.push(message);
		
		if (this.history.length > this.limits.historySize) {
			const firstMessageAttachmentId = this.history[0].attachment;
			
			if (firstMessageAttachmentId) {
				this.attachments.get(firstMessageAttachmentId).data = null;
			}
			
			this.history.shift();
		}
		
		for (const [_, chatter] of this.chatters) {
			this.sendEvent(chatter, "message", message);
		}
	}
	
	editMessage(sender, id, text, attachment) {
		const message = this.findMessage(sender.chat.nickname, id);
		
		if (!message) {
			return;
		}
		
		message.text = text;
		message.attachment = attachment;
		
		message.edited = true;
		
		this.notifyMessageUpdate(message);
	}
	deleteMessage(sender, id) {
		this.history = this.history.filter((message) => {
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
	
	findMessage(senderNickname, id) {
		for (const message of this.history) {
			if (message.sender == senderNickname && message.id == id) {
				return message;
			}
		}
		
		return null;
	}
	notifyMessageUpdate(message) {
		for (const [_, chatter] of this.chatters) {
			this.sendEvent(chatter, "message-updated", message);
		}
	}
	
	addAttachment(client, name, data) {
		const id = this.generateAttachmentId();
		
		this.attachments.set(id, {
			name: name,
			data: data
		});
		
		if (client) {
			this.sendEvent(client, "attachment-added", {
				id: id
			});
		}
	}
	fetchAttachment(client, id) {
		this.sendEvent(client, "attachment-fetched",
			this.attachments.get(id)
		);
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
