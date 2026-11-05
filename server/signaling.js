
const http = require("http");
const { Server } = require("socket.io");

let server = null;
let io = null;

function startServer() {
    return new Promise((resolve, reject) => {
        if (server) return resolve(server);

        server = http.createServer();

        io = new Server(server, {
            cors: {
                origin: "*"
            }
        });

        io.on("connection", socket => {
            console.log("CLIENT CONNECTE :", socket.id);

            socket.on("join-room", room => {
                socket.join(room);

                console.log(socket.id, "A REJOINT", room);

                socket.to(room).emit("peer-joined");
            });

            socket.on("signal", data => {
                socket.to(data.room).emit("signal", data.signal);
            });

            socket.on("disconnect", () => {
                console.log("CLIENT DECONNECTE :", socket.id);
            });
        });

        server.once("error", error => {
            server = null;
            io = null;
            reject(error);
        });

        server.listen(3000, "0.0.0.0", () => {
            console.log("CROSSDROP SERVEUR LANCE SUR LE PORT 3000");
            resolve(server);
        });
    });
}

function stopServer() {
    return new Promise(resolve => {
        if (!server) return resolve();

        io.close(() => {
            server = null;
            io = null;
            console.log("SERVEUR ARRETE");
            resolve();
        });
    });
}

module.exports = {
    startServer,
    stopServer
};
