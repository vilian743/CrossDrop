
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
    },
    maxHttpBufferSize: 1e6,
    pingTimeout: 20000,
    pingInterval: 25000
});

// =====================================
// GESTION DES SESSIONS
// =====================================

const rooms = new Map();

// Limitation des événements par connexion
function allowEvent(socket, name, max, windowMs) {
    const now = Date.now();

    let limit = socket.data.rateLimits.get(name);

    if (!limit || now - limit.start >= windowMs) {
        limit = {
            start: now,
            count: 0
        };

        socket.data.rateLimits.set(name, limit);
    }

    limit.count++;

    return limit.count <= max;
}

// Retirer proprement un utilisateur de sa session
function leaveCurrentRoom(socket) {
    const room = socket.data.room;

    if (!room) return;

    const users = rooms.get(room);

    socket.leave(room);

    if (users) {
        users.delete(socket.id);

        socket.to(room).emit("peer-left");

        if (users.size === 0) {
            rooms.delete(room);
        }
    }

    socket.data.room = null;
}

// =====================================
// CONNEXIONS
// =====================================

io.on("connection", socket => {
    console.log("Connexion :", socket.id);

    socket.data.room = null;
    socket.data.rateLimits = new Map();

    // =====================================
    // REJOINDRE UNE SESSION
    // =====================================

    socket.on("join-room", room => {

        // Maximum 10 tentatives par minute
        if (!allowEvent(socket, "join-room", 10, 60000)) {
            socket.emit(
                "room-error",
                "Trop de tentatives. Réessaie dans une minute."
            );
            return;
        }

        if (typeof room !== "string") return;

        room = room.trim().toUpperCase();

        if (!/^[A-Z0-9-]{6,12}$/.test(room)) {
            socket.emit("room-error", "Code invalide");
            return;
        }

        // Déjà présent dans cette session
        if (socket.data.room === room) return;

        // Quitter l'ancienne session proprement
        if (socket.data.room) {
            leaveCurrentRoom(socket);
        }

        let users = rooms.get(room);

        if (!users) {
            users = new Set();
            rooms.set(room, users);
        }

        // Maximum 2 utilisateurs par session
        if (users.size >= 2) {
            socket.emit(
                "room-error",
                "Session déjà complète"
            );

            if (users.size === 0) {
                rooms.delete(room);
            }

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

    // =====================================
    // SIGNALISATION WEBRTC
    // =====================================

    socket.on("signal", data => {

        // Maximum 120 messages en 10 secondes
        if (!allowEvent(socket, "signal", 120, 10000)) {
            console.warn(
                "Signalisation limitée pour :",
                socket.id
            );
            return;
        }

        const room = socket.data.room;

        if (!room || !data || typeof data !== "object") {
            return;
        }

        if (data.room !== room) return;

        if (
            !data.signal ||
            typeof data.signal !== "object"
        ) {
            return;
        }

        const users = rooms.get(room);

        if (!users || !users.has(socket.id)) return;

        socket.to(room).emit("signal", data.signal);
    });

    // =====================================
    // DECONNEXION
    // =====================================

    socket.on("disconnect", () => {

        leaveCurrentRoom(socket);

        console.log("Déconnexion :", socket.id);
    });
});

// =====================================
// DEMARRAGE DU SERVEUR
// =====================================

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        "CrossDrop Cloud Server démarré sur le port",
        PORT
    );
});
