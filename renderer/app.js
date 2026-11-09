
const io = require("socket.io-client");
const Peer = require("simple-peer");
const { ipcRenderer } = require("electron");
const crypto = require("crypto");
const JSZip = require("jszip");

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

    let selectedFiles = [];
    let selectedFolder = false;
    let transferInProgress = false;

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
    const folderInput = document.getElementById("folderInput");
    const fileArea = document.getElementById("fileArea");
    const sendFileBtn = document.getElementById("sendFileBtn");

    const transferProgress = document.getElementById("transferProgress");
    const progressLabel = document.getElementById("progressLabel");
    const progressPercent = document.getElementById("progressPercent");
    const progressBar = document.getElementById("progressBar");
    const progressDetails = document.getElementById("progressDetails");

    if (
        !sendBtn || !joinBtn || !roomCode || !roomDisplay ||
        !status || !fileInput || !folderInput || !fileArea ||
        !sendFileBtn || !transferProgress || !progressLabel ||
        !progressPercent || !progressBar || !progressDetails
    ) {
        console.error("Un ou plusieurs éléments HTML sont introuvables.");
        return;
    }

    // =====================================
    // ZONE DE SELECTION INVISIBLE
    // =====================================

    const pickerOverlay = document.createElement("button");
    pickerOverlay.type = "button";
    pickerOverlay.className = "file-picker-overlay";
    pickerOverlay.setAttribute(
        "aria-label",
        "Choisir des fichiers ou un dossier"
    );
    

    fileArea.appendChild(pickerOverlay);

    const fileInfo = document.createElement("p");
    fileInfo.className = "file-selection-info";
    fileInfo.textContent = "Aucun fichier sélectionné";

    fileArea.appendChild(fileInfo);
    let selectionModal = null;
let selectionEscapeHandler = null;

function closeSelectionModal() {
    if (selectionModal) {
        selectionModal.remove();
        selectionModal = null;
    }

    if (selectionEscapeHandler) {
        document.removeEventListener("keydown", selectionEscapeHandler);
        selectionEscapeHandler = null;
    }
}

function openSelectionModal() {
    closeSelectionModal();

    const modal = document.createElement("div");
    modal.className = "selection-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "selection-modal-card";

    const title = document.createElement("h2");
    title.textContent = "Que souhaites-tu sélectionner ?";

    const description = document.createElement("p");
    description.textContent = "Choisis ce que tu veux envoyer avec CrossDrop.";

    const options = document.createElement("div");
    options.className = "selection-modal-options";

    function createOption(icon, name, detail, action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "selection-option";

        const iconElement = document.createElement("span");
        iconElement.className = "selection-option-icon";
        iconElement.textContent = icon;

        const textContainer = document.createElement("span");

        const optionTitle = document.createElement("span");
        optionTitle.className = "selection-option-title";
        optionTitle.textContent = name;

        const optionDescription = document.createElement("span");
        optionDescription.className = "selection-option-description";
        optionDescription.textContent = detail;

        textContainer.append(optionTitle, optionDescription);
        button.append(iconElement, textContainer);

        button.addEventListener("click", () => {
            closeSelectionModal();
            action();
        });

        return button;
    }

    options.append(
        createOption("📄", "Des fichiers", "Sélectionner un ou plusieurs fichiers", () => fileInput.click()),
        createOption("📁", "Un dossier", "Envoyer un dossier complet", () => folderInput.click())
    );

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "selection-modal-cancel";
    cancelButton.textContent = "Annuler";
    cancelButton.addEventListener("click", closeSelectionModal);

    card.append(title, description, options, cancelButton);
    modal.appendChild(card);

    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeSelectionModal();
    });

    selectionEscapeHandler = (event) => {
        if (event.key === "Escape") closeSelectionModal();
    };

    document.addEventListener("keydown", selectionEscapeHandler);

    document.body.appendChild(modal);
    selectionModal = modal;
}

    pickerOverlay.addEventListener("click", () => {
    if (transferInProgress) return;
    openSelectionModal();
    });

    // =====================================
    // SELECTION DES FICHIERS
    // =====================================

    function displaySelectedFiles(files, isFolder) {
        selectedFiles = Array.from(files);
        selectedFolder = isFolder;

        if (selectedFiles.length === 0) {
            fileInfo.textContent = "Aucun fichier sélectionné";
            return;
        }

        const totalSize = selectedFiles.reduce(
            (total, file) => total + file.size,
            0
        );

        fileInfo.textContent =
            selectedFiles.length + " fichier(s) sélectionné(s) • " +
            formatBytes(totalSize) +
            (isFolder ? " • Dossier à compresser en ZIP" : "");
    }

    fileInput.addEventListener("change", () => {
        displaySelectedFiles(fileInput.files, false);
        folderInput.value = "";
    });

    folderInput.addEventListener("change", () => {
        displaySelectedFiles(folderInput.files, true);
        fileInput.value = "";
    });

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

        // RECEPTION DES DONNEES

        currentPeer.on("data", async (data) => {
            if (currentPeer !== peer) return;

            try {
                const text = typeof data === "string"
                    ? data
                    : new TextDecoder().decode(data);

                const message = JSON.parse(text);

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
                }

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
            roomDisplay.textContent = "❌ Serveur hors ligne";
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

        socket.emit("join-room", currentRoom);
    });

    // =====================================
    // REJOINDRE UNE SESSION
    // =====================================

    joinBtn.addEventListener("click", () => {
        if (!serverOnline) {
            roomDisplay.textContent = "❌ Serveur hors ligne";
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
        if (!peer) return;

        try {
            peer.signal(signal);
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

    async function sendOneFile(file, currentPeer) {
        console.log("DEBUT ENVOI :", file.name);

        updateProgress(
            "📤 Envoi : " + file.name,
            0,
            file.size
        );

        await waitForBuffer(currentPeer);

        currentPeer.send(JSON.stringify({
            type: "file-start",
            name: file.name,
            size: file.size
        }));

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

            updateProgress(
                "📤 Envoi : " + file.name,
                Math.min(offset + bytes.length, file.size),
                file.size
            );
        }

        await waitForBuffer(currentPeer);

        currentPeer.send(JSON.stringify({
            type: "file-end"
        }));

        console.log("FICHIER ENVOYE :", file.name);
    }

    // =====================================
    // COMPRESSER UN DOSSIER EN ZIP
    // =====================================

    async function createFolderZip(files) {
        const zip = new JSZip();

        let folderName = "Dossier_CrossDrop";

        if (files[0].webkitRelativePath) {
            folderName =
                files[0].webkitRelativePath.split("/")[0] ||
                folderName;
        }

        for (const file of files) {
            let relativePath = file.webkitRelativePath;

            if (relativePath) {
                const parts = relativePath.split("/");
                parts.shift();
                relativePath = parts.join("/");
            } else {
                relativePath = file.name;
            }

            if (!relativePath) {
                relativePath = file.name;
            }

            zip.file(relativePath, file);
        }

        const zipBlob = await zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: {
                level: 3
            }
        }, (metadata) => {
            updateProgress(
                "📦 Compression du dossier...",
                Math.floor(metadata.percent),
                100
            );
        });

        return new File(
            [zipBlob],
            folderName + ".zip",
            { type: "application/zip" }
        );
    }

    // =====================================
    // ENVOYER LA SELECTION
    // =====================================

    sendFileBtn.addEventListener("click", async () => {
        if (transferInProgress) return;

        if (!peer || !peer.connected) {
            alert("Connexion WebRTC non établie");
            return;
        }

        if (selectedFiles.length === 0) {
            alert("Sélectionne des fichiers ou un dossier avant l'envoi.");
            return;
        }

        const currentPeer = peer;

        transferInProgress = true;
        sendFileBtn.disabled = true;
        sendFileBtn.textContent = "Envoi en cours...";

        try {
            let filesToSend = [];

            if (selectedFolder) {
                const zipFile = await createFolderZip(selectedFiles);
                filesToSend.push(zipFile);
            } else {
                filesToSend = [...selectedFiles];
            }

            for (const file of filesToSend) {
                await sendOneFile(file, currentPeer);
            }

            const totalSize = filesToSend.reduce(
                (total, file) => total + file.size,
                0
            );

            updateProgress(
                "✅ Envoi terminé !",
                totalSize,
                totalSize
            );

            roomDisplay.textContent =
                "✅ Envoi terminé : " + filesToSend.length + " fichier(s)";

            alert("✅ Envoi terminé !");

            selectedFiles = [];
            selectedFolder = false;
            fileInput.value = "";
            folderInput.value = "";
            fileInfo.textContent = "Aucun fichier sélectionné";

        } catch (err) {
            console.error("ERREUR ENVOI :", err);

            alert(
                "❌ Erreur pendant l'envoi : " +
                (err.message || "Erreur inconnue")
            );

        } finally {
            transferInProgress = false;
            sendFileBtn.disabled = false;
            sendFileBtn.textContent = "Envoyer le fichier";
        }
    });

})();
