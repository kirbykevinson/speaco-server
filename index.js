const ws = require("ws");

class Chat {
	constructor(host, port) {
		this.host = host || "localhost";
		this.port = port || "6942";
		
		this.socket = null;
	}
	
	run() {
		this.socket = new ws.Server({
			host: this.host,
			port: this.port
		});
		
		this.socket.on("listening", () => {
			console.log(`Server started on ${this.host}:${this.port}`);
		});
	}
}

const chat = new Chat(
	process.argv[2],
	process.argv[3]
);

chat.run();
