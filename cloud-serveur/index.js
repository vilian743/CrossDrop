
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain"
    });
    res.end("CrossDrop signaling server is running");
});

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// Suivi des utilisateurs dans chaque session
const rooms = new Map();

io.on("connection", socket => {
    console.log("Connexion :", socket.id);

    socket.on("join-room", room => {
        if (typeof room !== "string") return;

        room = room.trim().toUpperCase();

        if (!/^[A-Z0-9-]{6,12}$/.test(room)) {
            socket.emit("room-error", "Code invalide");
            return;
        }

        // Un utilisateur ne rejoint qu'une session
        if (socket.data.room) {
            socket.leave(socket.data.room);
        }

        let users = rooms.get(room);

        if (!users) {
            users = new Set();
            rooms.set(room, users);
        }

        if (users.has(socket.id)) return;

        if (users.size >= 2) {
            socket.emit("room-error", "Session déjà complète");
            return;
        }

        users.add(socket.id);
        socket.data.room = room;
        socket.join(room);

        console.log(socket.id, "a rejoint", room);

        if (users.size === 2) {
            socket.to(room).emit("peer-joined");
        }
    });

    socket.on("signal", data => {
        const room = socket.data.room;

        if (!room || !data || data.room !== room) return;

        socket.to(room).emit("signal", data.signal);
    });

    socket.on("disconnect", () => {
        const room = socket.data.room;

        if (room && rooms.has(room)) {
            const users = rooms.get(room);

            users.delete(socket.id);

            socket.to(room).emit("peer-left");

            if (users.size === 0) {
                rooms.delete(room);
            }
        }

        console.log("Déconnexion :", socket.id);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("CrossDrop Cloud Server démarré sur le port", PORT);
});
