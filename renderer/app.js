const io = require("socket.io-client");
const Peer = require("simple-peer");
const { ipcRenderer } = require("electron");
const crypto = require("crypto");

(async () => {
    // =====================================
    // CONFIGURATION
    // =====================================

    const serverUrl = "https://crossdrop-server.onrender.com";
    const socket = io(serverUrl);

    console.log("SERVEUR CROSSDROP :", serverUrl);

    let peer = null;
    let currentRoom = null;
    let serverOnline = false;
    let incomingFile = null;

    const CHUNK_SIZE = 16 * 1024;
    const MAX_BUFFER_SIZE = 1024 * 1024;

    function formatBytes(bytes) {
        if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + " Ko";
        }

        return (bytes / (1024 * 1024)).toFixed(2) + " Mo";
    }

    function updateProgress(label, transferred, total) {
        const percent = total > 0
            ? Math.min(100, Math.floor((transferred / total) * 100))
            : 100;

        transferProgress.hidden = false;
        progressLabel.textContent = label;
        progressPercent.textContent = percent + " %";
        progressBar.style.width = percent + "%";

        progressDetails.textContent =
            formatBytes(transferred) + " / " + formatBytes(total);
    }

    // =====================================
    // ELEMENTS HTML
    // =====================================

    const sendBtn = document.getElementById("sendBtn");
    const joinBtn = document.getElementById("joinBtn");
    const roomCode = document.getElementById("roomCode");
    const roomDisplay = document.getElementById("roomDisplay");
    const status = document.getElementById("status");
    const fileInput = document.getElementById("fileInput");
    const sendFileBtn = document.getElementById("sendFileBtn");

    const transferProgress = document.getElementById("transferProgress");
    const progressLabel = document.getElementById("progressLabel");
    const progressPercent = document.getElementById("progressPercent");
    const progressBar = document.getElementById("progressBar");
    const progressDetails = document.getElementById("progressDetails");

    // =====================================
    // CONNEXION SERVEUR
    // =====================================

    socket.on("connect", () => {
        serverOnline = true;
        console.log("CONNECTE AU SERVEUR");
        status.textContent = "🟢 Serveur en ligne";
    });

    socket.on("disconnect", () => {
        serverOnline = false;
        console.log("SERVEUR DECONNECTE");
        status.textContent = "🔴 Serveur hors ligne";

        if (peer) {
            peer.destroy();
            peer = null;
        }
    });

    socket.on("connect_error", (err) => {
        serverOnline = false;
        console.error("ERREUR SERVEUR :", err);
        status.textContent = "🔴 Serveur inaccessible";
    });

    // =====================================
    // CREATION PEER WEBRTC
    // =====================================

    function createPeer(initiator) {
        if (peer) {
            peer.destroy();
            peer = null;
        }

        console.log(
            "CREATION PEER :",
            initiator ? "INITIATOR" : "RECEIVER"
        );

        const newPeer = new Peer({
            initiator,
            trickle: true,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun.cloudflare.com:3478" }
                ]
            }
        });

        peer = newPeer;
        setupPeer(newPeer);
    }

    // =====================================
    // CONFIGURATION PEER
    // =====================================

    function setupPeer(currentPeer) {
        currentPeer.on("signal", (data) => {
            if (currentPeer !== peer || !currentRoom) return;

            console.log("SIGNAL GENERE");

            socket.emit("signal", {
                room: currentRoom,
                signal: data
            });
        });

        currentPeer.on("connect", () => {
            if (currentPeer !== peer) return;

            console.log("WEBRTC CONNECTE");

            roomDisplay.textContent =
                "✅ Connexion établie ! Code : " + currentRoom;
        });
                // =====================================
        // RECEPTION DES DONNEES
        // =====================================

        currentPeer.on("data", async (data) => {
            if (currentPeer !== peer) return;

            try {
                let text;

                if (typeof data === "string") {
                    text = data;
                } else {
                    text = new TextDecoder().decode(data);
                }

                const message = JSON.parse(text);

                // DEBUT DU FICHIER
                if (message.type === "file-start") {
                    incomingFile = {
                        name: message.name,
                        size: message.size,
                        chunks: [],
                        received: 0
                    };

                    console.log("RECEPTION :", message.name);

                    updateProgress(
                        "📥 Réception : " + message.name,
                        0,
                        message.size
                    );

                    roomDisplay.textContent =
                        "📥 Réception : " + message.name;
                }

                // MORCEAU DU FICHIER
                else if (message.type === "file-chunk") {
                    if (!incomingFile) return;

                    const binary = atob(message.content);
                    const bytes = new Uint8Array(binary.length);

                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }

                    incomingFile.chunks.push(bytes);
                    incomingFile.received += bytes.length;

                    updateProgress(
                        "📥 Réception : " + incomingFile.name,
                        incomingFile.received,
                        incomingFile.size
                    );

                    console.log(
                        "PROGRESSION :",
                        incomingFile.received,
                        "/",
                        incomingFile.size
                    );
                }

                // FIN DU FICHIER
                else if (message.type === "file-end") {
                    if (!incomingFile) return;

                    const blob = new Blob(incomingFile.chunks);
                    const url = URL.createObjectURL(blob);

                    const a = document.createElement("a");
                    a.href = url;
                    a.download = incomingFile.name;

                    document.body.appendChild(a);
                    a.click();
                    a.remove();

                    setTimeout(() => {
                        URL.revokeObjectURL(url);
                    }, 5000);

                    console.log(
                        "FICHIER RECU :",
                        incomingFile.name
                    );

                    updateProgress(
                        "✅ Réception terminée !",
                        incomingFile.size,
                        incomingFile.size
                    );

                    roomDisplay.textContent =
                        "✅ Fichier reçu : " + incomingFile.name;

                    incomingFile = null;
                }

            } catch (err) {
                console.error("ERREUR RECEPTION :", err);
            }
        });

        currentPeer.on("error", (err) => {
            console.error("PEER ERROR :", err);

            roomDisplay.textContent =
                "❌ Erreur de connexion WebRTC";
        });

        currentPeer.on("close", () => {
            console.log("PEER FERME");

            if (currentPeer !== peer) return;

            peer = null;

            roomDisplay.textContent =
                "⚠️ Connexion fermée";
        });
    }

    // =====================================
    // CREER UNE SESSION
    // =====================================

    sendBtn.addEventListener("click", () => {
        if (!serverOnline) {
            roomDisplay.textContent =
                "❌ Serveur hors ligne";
            return;
        }

        if (peer) {
            peer.destroy();
            peer = null;
        }

        currentRoom = crypto.randomBytes(6)
            .toString("hex")
            .toUpperCase();

        incomingFile = null;

        roomDisplay.textContent =
            "✅ Session créée ! Code : " + currentRoom;

        console.log("SESSION CREEE :", currentRoom);

        socket.emit("join-room", currentRoom);
    });

    // =====================================
    // REJOINDRE UNE SESSION
    // =====================================

    joinBtn.addEventListener("click", () => {
        if (!serverOnline) {
            roomDisplay.textContent =
                "❌ Serveur hors ligne";
            return;
        }

        const code = roomCode.value.trim().toUpperCase();

        if (!code) {
            alert("Entre un code de session");
            return;
        }

        if (peer) {
            peer.destroy();
            peer = null;
        }

        currentRoom = code;
        incomingFile = null;

        console.log("REJOINT LA SESSION :", currentRoom);

        roomDisplay.textContent =
            "⏳ Connexion à la session : " + currentRoom;

        socket.emit("join-room", currentRoom);

        createPeer(false);
    });

    // =====================================
    // UN UTILISATEUR REJOINT LA SESSION
    // =====================================

    socket.on("peer-joined", () => {
        console.log("PEER JOINED");

        if (peer) return;

        createPeer(true);
    });
        // =====================================
    // SIGNAL WEBRTC
    // =====================================

    socket.on("signal", (signal) => {
        console.log("SIGNAL RECU");

        if (!peer) {
            console.log("PEER NON DISPONIBLE");
            return;
        }

        try {
            peer.signal(signal);
            console.log("SIGNAL APPLIQUE");
        } catch (err) {
            console.error("ERREUR SIGNAL :", err);
        }
    });

    // =====================================
    // GESTION DU BUFFER
    // =====================================

    async function waitForBuffer(currentPeer) {
        while (
            currentPeer === peer &&
            currentPeer.connected &&
            currentPeer._channel &&
            currentPeer._channel.bufferedAmount > MAX_BUFFER_SIZE
        ) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (
            currentPeer !== peer ||
            !currentPeer.connected
        ) {
            throw new Error("Connexion interrompue");
        }
    }

    // =====================================
    // ENVOYER UN FICHIER
    // =====================================

    sendFileBtn.addEventListener("click", async () => {
        if (!peer || !peer.connected) {
            alert("Connexion WebRTC non établie");
            return;
        }

        const file = fileInput.files[0];

        if (!file) {
            alert("Sélectionne un fichier avant de l'envoyer");
            return;
        }

        const currentPeer = peer;

        try {
            console.log("DEBUT ENVOI :", file.name);

            // AFFICHER LE DEBUT DE LA PROGRESSION
            updateProgress(
                "📤 Envoi : " + file.name,
                0,
                file.size
            );

            // INFORMATIONS DU FICHIER
            await waitForBuffer(currentPeer);

            currentPeer.send(JSON.stringify({
                type: "file-start",
                name: file.name,
                size: file.size
            }));

            // ENVOI PAR MORCEAUX
            for (
                let offset = 0;
                offset < file.size;
                offset += CHUNK_SIZE
            ) {
                const chunk = file.slice(
                    offset,
                    offset + CHUNK_SIZE
                );

                const buffer = await chunk.arrayBuffer();
                const bytes = new Uint8Array(buffer);

                let binary = "";

                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }

                const base64 = btoa(binary);

                await waitForBuffer(currentPeer);

                currentPeer.send(JSON.stringify({
                    type: "file-chunk",
                    content: base64
                }));

                // MISE A JOUR DE LA PROGRESSION
                updateProgress(
                    "📤 Envoi : " + file.name,
                    Math.min(offset + bytes.length, file.size),
                    file.size
                );
            }
                        // FIN DU FICHIER
            await waitForBuffer(currentPeer);

            currentPeer.send(JSON.stringify({
                type: "file-end"
            }));

            console.log("FICHIER ENVOYE :", file.name);

            // CONFIRMATION DE FIN D'ENVOI
            updateProgress(
                "✅ Envoi terminé !",
                file.size,
                file.size
            );

            alert("✅ Fichier envoyé !");

        } catch (err) {
            console.error("ERREUR ENVOI :", err);

            alert("❌ Erreur pendant l'envoi du fichier");
        }
    });

})();