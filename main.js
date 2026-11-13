
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const dgram = require("dgram");
const { startServer, stopServer } = require("./server/signaling");


const DISCOVERY_PORT = 41234;
const SERVER_PORT = 3000;
const DISCOVERY_TIMEOUT = 3000;

let discovery = null;
let announceInterval = null;
let isHost = false;
let serverUrl = null;
let shuttingDown = false;

function startDiscovery() {
    return new Promise((resolve, reject) => {
        discovery = dgram.createSocket({
            type: "udp4",
            reuseAddr: true
        });

        discovery.on("error", reject);

        discovery.bind(DISCOVERY_PORT, "0.0.0.0", () => {
            discovery.setBroadcast(true);
            console.log("RECHERCHE DES SERVEURS CROSSDROP...");
            resolve();
        });
    });
}

function announceServer() {
    if (!discovery || !isHost) return;

    const message = Buffer.from("CROSSDROP_SERVER");

    discovery.send(
        message,
        DISCOVERY_PORT,
        "255.255.255.255",
        error => {
            if (error) {
                console.error("Erreur annonce :", error);
            }
        }
    );
}

function findServer(timeoutMs) {
    return new Promise(resolve => {
        let finished = false;

        const finish = result => {
            if (finished) return;
            finished = true;

            clearTimeout(timeout);
            discovery.removeListener("message", onMessage);

            resolve(result);
        };

        const onMessage = (message, info) => {
            if (message.toString() !== "CROSSDROP_SERVER") return;

            console.log("SERVEUR CROSSDROP DETECTE :", info.address);

            finish(`http://${info.address}:${SERVER_PORT}`);
        };

        const timeout = setTimeout(() => {
            finish(null);
        }, timeoutMs);

        discovery.on("message", onMessage);
    });
}

async function initializeNetwork() {
    await startDiscovery();

    // On cherche d'abord un serveur déjà présent sur le réseau.
    const existingServer = await findServer(DISCOVERY_TIMEOUT);

    if (existingServer) {
        isHost = false;
        serverUrl = existingServer;

        console.log("CROSSDROP : MODE CLIENT");
        console.log("SERVEUR TROUVE :", serverUrl);

        return serverUrl;
    }

    // Aucun serveur trouvé : cet ordinateur devient l'hôte.
    console.log("AUCUN SERVEUR TROUVE. DEMARRAGE DU SERVEUR...");

    await startServer();

    isHost = true;
    serverUrl = `http://127.0.0.1:${SERVER_PORT}`;

    console.log("CROSSDROP : MODE SERVEUR");
    console.log("SERVEUR LOCAL :", serverUrl);

    announceServer();

    announceInterval = setInterval(announceServer, 2000);

    return serverUrl;
}

ipcMain.handle("get-server-url", async () => {
    if (serverUrl) return serverUrl;

    return initializeNetwork();
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 700,
        minHeight: 550,
        title: "CrossDrop",
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.webContents.on("did-fail-load", (event, code, description) => {
        console.error("Erreur de chargement :", code, description);
    });

    win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// =====================================
// MISES A JOUR AUTOMATIQUES
// =====================================

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdates() {
    // Pas de recherche de mise à jour pendant le développement
    if (!app.isPackaged) return;

    autoUpdater.on("checking-for-update", () => {
        console.log("Recherche de mises à jour...");
    });

    autoUpdater.on("update-available", async (info) => {
        const result = await dialog.showMessageBox({
            type: "info",
            title: "Mise à jour disponible",
            message: `Une nouvelle version de CrossDrop (${info.version}) est disponible.`,
            detail: "Souhaites-tu la télécharger maintenant ?",
            buttons: ["Télécharger", "Plus tard"],
            defaultId: 0,
            cancelId: 1
        });

        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    });

    autoUpdater.on("update-not-available", () => {
        console.log("CrossDrop est déjà à jour.");
    });

    autoUpdater.on("update-downloaded", async (info) => {
        const result = await dialog.showMessageBox({
            type: "info",
            title: "Mise à jour prête",
            message: `CrossDrop ${info.version} est prêt à être installé.`,
            detail: "L'application va redémarrer pour installer la mise à jour.",
            buttons: ["Installer maintenant", "Plus tard"],
            defaultId: 0,
            cancelId: 1
        });

        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });

    autoUpdater.on("error", (error) => {
        console.error("Erreur de mise à jour :", error);
    });

    autoUpdater.checkForUpdates().catch((error) => {
        console.error("Impossible de vérifier les mises à jour :", error);
    });
}

app.whenReady().then(() => {
    createWindow();
    setupAutoUpdates();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on("before-quit", event => {
    if (shuttingDown) return;

    event.preventDefault();
    shuttingDown = true;

    clearInterval(announceInterval);

    const finishQuit = () => {
        if (discovery) {
            try {
                discovery.close();
            } catch (error) {
                console.error(error);
            }
        }

        app.quit();
    };

    stopServer().finally(finishQuit);
});
