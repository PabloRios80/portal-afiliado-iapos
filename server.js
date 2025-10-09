require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001; // Usamos un puerto diferente para no chocar con el otro proyecto

// --- CONFIGURACIÓN DE AUTENTICACIÓN (IDÉNTICA A TU OTRA APP) ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback'; // Ojo al puerto 3001

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
app.use(express.static(path.join(__dirname, 'public')));

// --- FUNCIONES PARA MANEJAR EL TOKEN (IDÉNTICAS A TU OTRA APP) ---
async function loadTokens() {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        oauth2Client.setCredentials(tokens);
        console.log('Tokens cargados con éxito.');
        return true;
    } catch (err) {
        console.log('No se encontraron tokens. Se requiere autenticación.');
        return false;
    }
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Tokens guardados en token.json.');
}

async function getAuthenticatedClient() {
    const areTokensLoaded = await loadTokens();
    if (!areTokensLoaded) {
        throw new Error('Tokens no cargados. Por favor, autentícate primero en /auth.');
    }
    return oauth2Client;
}

// --- RUTAS DE AUTENTICACIÓN (IDÉNTICAS A TU OTRA APP) ---
app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);
        res.send('Autenticación exitosa. Ahora puedes cerrar esta pestaña.');
    } catch (err) {
        console.error('Error al obtener tokens:', err);
        res.status(500).send('Error de autenticación.');
    }
});

// --- RUTA PRINCIPAL PARA BUSCAR POR DNI (LA NUEVA LÓGICA) ---
app.get('/api/informe/:dni', async (req, res) => {
    try {
        const authClient = await getAuthenticatedClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        const dniBuscado = req.params.dni.trim();
        const range = 'Integrado!A:DM'; // Ajusta el nombre de la hoja si es diferente

        console.log(`Buscando DNI: ${dniBuscado}...`);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'La hoja de cálculo está vacía.' });
        }

        const headers = rows[0];
        const dataRows = rows.slice(1);
        const dniColumnIndex = headers.findIndex(header => header.toLowerCase() === 'dni');

        if (dniColumnIndex === -1) {
            return res.status(500).json({ error: 'No se encontró la columna "DNI".' });
        }

        // Buscamos la ÚLTIMA aparición del DNI, asumiendo que es la más reciente
        let personaData = null;
        for (let i = dataRows.length - 1; i >= 0; i--) {
            const row = dataRows[i];
            if (row[dniColumnIndex] && row[dniColumnIndex].trim() === dniBuscado) {
                personaData = row;
                break; // Encontramos la última y salimos del bucle
            }
        }
        
        if (!personaData) {
            return res.status(404).json({ message: 'No se encontraron datos para el DNI proporcionado.' });
        }

        const persona = {};
        headers.forEach((header, index) => {
            persona[header] = personaData[index] || ''; // Asignamos '' si el valor está vacío
        });
        
        // Por ahora, solo devolvemos los datos. Más adelante llamaremos a la IA.
        res.json({ persona });

    } catch (error) {
        console.error('Error al buscar el DNI:', error.message);
        // Si el error es por falta de token, lo indicamos
        if (error.message.includes('Tokens no cargados')) {
            return res.status(401).json({ error: 'No autenticado. Por favor, genera el token.' });
        }
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// --- Iniciar el servidor ---
async function startServer() {
    await loadTokens();
    app.listen(PORT, () => {
        console.log(`Servidor del Portal de Afiliados escuchando en http://localhost:${PORT}`);
        console.log('Si es la primera vez, visita http://localhost:3001/auth para autenticarte.');
    });
}

startServer();