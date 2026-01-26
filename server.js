require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs'); 

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// ----------------------------------------------------------------------
// 🔑 CLAVE API (La que funciona)
// ----------------------------------------------------------------------
const GENAI_API_KEY = process.env.GEMINI_API_KEY; 

if (!GENAI_API_KEY) {
    console.error("❌ ERROR: No hay GEMINI_API_KEY en el archivo .env");
}

// ----------------------------------------------------------------------
// CONFIGURACIÓN EXCEL
// ----------------------------------------------------------------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';

if (fs.existsSync('credentials.json')) {
    try {
        const keys = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
        const keyData = keys.web || keys.installed;
        if (keyData) {
            CLIENT_ID = keyData.client_id;
            CLIENT_SECRET = keyData.client_secret;
        }
    } catch (e) { console.error("Error credenciales", e); }
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')));
            return true;
        }
    } catch (err) {}
    console.log('⚠️ Falta Auth Excel. Ve a /auth');
    return false;
}
function saveTokens(tokens) { fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens)); }
oauth2Client.on('tokens', (tokens) => {
    if (fs.existsSync(TOKEN_PATH)) saveTokens({ ...JSON.parse(fs.readFileSync(TOKEN_PATH)), ...tokens });
    else saveTokens(tokens);
});

app.get('/auth', (req, res) => res.redirect(oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES })));
app.get('/oauth2callback', async (req, res) => {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    saveTokens(tokens);
    res.send('<h1>Conectado</h1>');
});

// --- Rutas Login y Datos ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { dni, password } = req.body;
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Usuarios&tq=${encodeURIComponent(`select * where A = '${dni}'`)}`;
        const response = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const dataJson = JSON.parse(response.data.replace(/.*setResponse\((.*)\);/s, '$1'));
        if (!dataJson.table?.rows.length) return res.status(400).json({ error: 'Usuario no encontrado' });
        const row = dataJson.table.rows[0];
        if (await bcrypt.compare(password, row.c[1]?.v)) res.json({ success: true, usuario: { dni, rol: row.c[2]?.v || 'user' } });
        else res.status(400).json({ error: 'Contraseña incorrecta' });
    } catch (e) { res.status(500).json({ error: 'Error Login' }); }
});

app.post('/api/buscar-datos', async (req, res) => {
    try {
        const { dniBuscado } = req.body;
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const [resMed, resInf] = await Promise.all([
            axios.get(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado&tq=${encodeURIComponent(`select * where C = '${dniBuscado}'`)}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
            axios.get(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Informes IA&tq=${encodeURIComponent(`select C where A = '${dniBuscado}'`)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
        ]);
        const jsonMed = JSON.parse(resMed.data.replace(/.*setResponse\((.*)\);/s, '$1'));
        if (!jsonMed.table?.rows.length) return res.status(404).json({ error: 'No hay datos' });
        const jsonInf = JSON.parse(resInf.data.replace(/.*setResponse\((.*)\);/s, '$1'));
        const reporte = (jsonInf.table.rows.length > 0) ? jsonInf.table.rows[0].c[0]?.v : null;
        const reports = jsonMed.table.rows.map(row => {
            const d = {}; jsonMed.table.cols.forEach((c, i) => { if(c.label) d[c.label] = row.c[i]?.v || ''; });
            d['REPORTE_MEDICO'] = reporte; return d;
        });
        res.json({ reports });
    } catch (e) { res.status(500).json({ error: 'Error Datos' }); }
});

// ======================================================================
// 💾 RUTA GUARDAR: AHORA CON DIAGNÓSTICO DETALLADO
// ======================================================================
app.post('/api/guardar-reporte', async (req, res) => {
    console.log("💾 Intentando guardar reporte...");
    try {
        const { dni, nombre, reporteTexto } = req.body;
        
        // Verificación básica
        if (!dni || !reporteTexto) {
            console.error("❌ Faltan datos: DNI o Reporte vacíos");
            return res.status(400).json({ error: 'Faltan datos para guardar' });
        }

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        // 1. Buscamos si el DNI ya tiene reporte
        // Asegúrate que la hoja se llame EXACTAMENTE 'Informes IA'
        const resDNI = await sheets.spreadsheets.values.get({ 
            spreadsheetId: SPREADSHEET_ID, 
            range: `'Informes IA'!A:A` 
        });
        
        const rows = resDNI.data.values || [];
        const rowIndex = rows.findIndex(r => r[0] == dni);

        if (rowIndex !== -1) {
            // ACTUALIZAR
            console.log(`📝 Actualizando reporte para DNI ${dni} en fila ${rowIndex + 1}`);
            await sheets.spreadsheets.values.update({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!C${rowIndex + 1}`, 
                valueInputOption: 'RAW', 
                resource: { values: [[reporteTexto]] } 
            });
        } else {
            // CREAR NUEVO
            console.log(`✨ Creando nuevo reporte para DNI ${dni}`);
            await sheets.spreadsheets.values.append({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!A:C`, 
                valueInputOption: 'RAW', 
                resource: { values: [[dni, nombre, reporteTexto]] } 
            });
        }
        
        res.json({ success: true });

    } catch (e) { 
        // 👇 ESTO TE MOSTRARÁ EL ERROR REAL EN LA TERMINAL 👇
        console.error("❌ ERROR CRÍTICO AL GUARDAR:", e.message);
        if (e.response) {
            console.error("🔍 Detalle del error de Google:", JSON.stringify(e.response.data, null, 2));
        }
        res.status(500).json({ error: 'Error al guardar en Excel: ' + e.message }); 
    }
});

// ======================================================================
// 🧠 RUTA IA: CON PROMPT "CÁLIDO Y CERCANO" 💖
// ======================================================================
function construirPrompt(datosPersona) {
    const datosJson = JSON.stringify(datosPersona, null, 2);
    // Nuevo prompt con "alma"
    return `Actúa como un Asistente de Salud personal de IAPOS, muy cercano, empático y profesional.
    Tu objetivo es motivar al paciente.
    
    INSTRUCCIONES DE TONO:
    1. 🟢 Lo bueno: ¡Felicita con entusiasmo! Usa frases como "¡Excelente trabajo!", "¡Sigue así!", "Esto es una gran noticia".
    2. 🟡/🔴 Los riesgos: Sé amable pero firme. No regañes, sino explica con preocupación genuina por qué es importante cuidarse. Usa frases como "Aquí debemos prestar atención", "Me gustaría que revisemos esto juntos", "Por tu bienestar, es importante...".
    3. General: Háblale de "tú" o "vos" (respetuoso pero cercano). Que sienta que un médico amigo le habla.

    FORMATO DEL REPORTE (Mantén esta estructura técnica pero con el tono nuevo):
    - Usa Markdown.
    - Usa emojis para guiar la lectura.
    - DATOS DEL PACIENTE: ${datosJson}`;
}

app.post('/api/analizar-informe', async (req, res) => {
    if (!req.body.persona) return res.status(400).json({ error: 'Faltan datos' });
    console.log(`🧠 Generando informe con cariño...`);

    try {
        const genAI = new GoogleGenerativeAI(GENAI_API_KEY);
        // Usamos el modelo que ya sabemos que funciona
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const prompt = construirPrompt(req.body.persona);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ resumen: text.trim() });

    } catch (error) {
        console.error('🚨 ERROR IA:', error.message);
        res.status(500).json({ error: 'Error IA: ' + error.message });
    }
});

// START
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
async function start() { await loadTokens(); app.listen(PORT, () => console.log(`🚀 Servidor listo: http://localhost:${PORT}`)); }
start();