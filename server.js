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
// 🔑 CLAVE API
// ----------------------------------------------------------------------
const GENAI_API_KEY = process.env.GEMINI_API_KEY; 
if (!GENAI_API_KEY) console.error("❌ ERROR: Falta GEMINI_API_KEY en .env");

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

// ----------------------------------------------------------------------
// 🔍 BUSCAR DATOS (CORREGIDO PARA LEER BIEN LOS INFORMES)
// ----------------------------------------------------------------------
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const { dniBuscado } = req.body;
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        // 1. Traemos los datos médicos (Hoja Integrado) usando Axios (Gviz) como siempre
        const resMed = await axios.get(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado&tq=${encodeURIComponent(`select * where C = '${dniBuscado}'`)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const jsonMed = JSON.parse(resMed.data.replace(/.*setResponse\((.*)\);/s, '$1'));

        if (!jsonMed.table?.rows.length) return res.status(404).json({ error: 'No hay datos' });

        // 2. Traemos TODOS los informes IA usando la API Oficial (Más seguro que Gviz para buscar con comillas)
        // Esto soluciona que no encuentre el informe si tiene la comilla '
        const resInformes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Informes IA'!A:C" // Leemos columnas A (DNI), B (Nombre), C (Reporte)
        });

        const filasInformes = resInformes.data.values || [];
        
        // Buscamos el DNI manualmente ignorando la comilla '
        // fila[0] es el DNI, fila[2] es el Reporte
        const filaEncontrada = filasInformes.find(fila => {
            const dniExcel = fila[0]?.toString().replace("'", "").trim(); // Quitamos la comilla para comparar
            return dniExcel == dniBuscado.toString().trim();
        });

        const reporte = filaEncontrada ? filaEncontrada[2] : null;

        // Combinamos todo
        const reports = jsonMed.table.rows.map(row => {
            const d = {}; jsonMed.table.cols.forEach((c, i) => { if(c.label) d[c.label] = row.c[i]?.v || ''; });
            d['REPORTE_MEDICO'] = reporte; 
            return d;
        });

        res.json({ reports });
    } catch (e) { 
        console.error("Error al buscar datos:", e);
        res.status(500).json({ error: 'Error Datos' }); 
    }
});

// ----------------------------------------------------------------------
// 💾 GUARDAR REPORTE (CORREGIDO PARA EVITAR DUPLICADOS)
// ----------------------------------------------------------------------
app.post('/api/guardar-reporte', async (req, res) => {
    console.log("💾 Intentando guardar reporte...");
    try {
        const { dni, nombre, reporteTexto } = req.body;
        if (!dni || !reporteTexto) return res.status(400).json({ error: 'Faltan datos' });

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        // 1. Leemos la columna de DNIs
        const resDNI = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Informes IA'!A:A` });
        const rows = resDNI.data.values || [];
        
        // 2. Buscamos si ya existe (IGNORANDO LA COMILLA)
        const rowIndex = rows.findIndex(r => {
            const dniExcel = r[0]?.toString().replace("'", "").trim();
            return dniExcel == dni.toString().trim();
        });

        if (rowIndex !== -1) {
            // ACTUALIZAR (Sobrescribe la fila existente)
            console.log(`🔄 Actualizando reporte existente para DNI ${dni}`);
            await sheets.spreadsheets.values.update({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!C${rowIndex + 1}`, 
                valueInputOption: 'RAW', 
                resource: { values: [[reporteTexto]] } 
            });
        } else {
            // CREAR NUEVO (Solo si no existe)
            console.log(`✨ Creando nuevo reporte para DNI ${dni}`);
            // Guardamos con la comilla ' para mantener el formato texto
            await sheets.spreadsheets.values.append({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!A:C`, 
                valueInputOption: 'RAW', 
                resource: { values: [[`'${dni}`, nombre, reporteTexto]] } 
            });
        }
        res.json({ success: true });
    } catch (e) { 
        console.error("❌ ERROR AL GUARDAR:", e.message);
        if(e.response && e.response.status === 403) {
            console.error("🚨 PISTA: ¡Falta habilitar Google Sheets API en el proyecto!");
        }
        res.status(500).json({ error: 'Error Excel: ' + e.message }); 
    }
});

// ======================================================================
// 🧠 RUTA IA: PROFESIONAL + LIMPIEZA
// ======================================================================
function construirPrompt(datosPersona) {
    const datosJson = JSON.stringify(datosPersona, null, 2);
    const nombreMedico = datosPersona['Profesional'] || 'Equipo Médico IAPOS';

    return `Actúa como el Dr./Dra. ${nombreMedico}, del equipo de salud de IAPOS.
    Escribe un informe de devolución clínica para el paciente ${datosPersona['apellido y nombre']}.

    INSTRUCCIONES:
    1. Tono médico, empático pero profesional y sobrio.
    2. Menciona fortalezas (Verde) y riesgos (Rojo/Amarillo) con claridad.
    3. NO incluyas JSON ni datos técnicos.
    
    DATOS: ${datosJson}`;
}

function limpiarRespuesta(texto) {
    // 1. Borrar bloques de código
    let limpio = texto.replace(/```[\s\S]*?```/g, "");
    // 2. Borrar encabezados técnicos
    limpio = limpio.replace(/DATOS DEL PACIENTE/gi, "");
    limpio = limpio.replace(/REPORTE TÉCNICO/gi, "");
    // 3. Limpieza final
    return limpio.trim();
}

app.post('/api/analizar-informe', async (req, res) => {
    if (!req.body.persona) return res.status(400).json({ error: 'Faltan datos' });
    console.log(`🧠 Generando informe...`);

    try {
        const genAI = new GoogleGenerativeAI(GENAI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const prompt = construirPrompt(req.body.persona);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        let cleanText = limpiarRespuesta(response.text());
        res.json({ resumen: cleanText });

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