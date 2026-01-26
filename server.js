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

app.post('/api/buscar-datos', async (req, res) => {
    try {
        const { dniBuscado } = req.body;
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        // 1. Datos médicos (Hoja Integrado)
        const resMed = await axios.get(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado&tq=${encodeURIComponent(`select * where C = '${dniBuscado}'`)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const jsonMed = JSON.parse(resMed.data.replace(/.*setResponse\((.*)\);/s, '$1'));

        if (!jsonMed.table?.rows.length) return res.status(404).json({ error: 'No hay datos' });

        // 2. Informes IA (API Oficial)
        const resInformes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Informes IA'!A:C" 
        });

        const filasInformes = resInformes.data.values || [];
        
        // Buscamos ignorando la comilla '
        const filaEncontrada = filasInformes.find(fila => {
            const dniExcel = fila[0]?.toString().replace("'", "").trim();
            return dniExcel == dniBuscado.toString().trim();
        });

        const reporte = filaEncontrada ? filaEncontrada[2] : null;

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

// --- Guardar Reporte ---
app.post('/api/guardar-reporte', async (req, res) => {
    console.log("💾 Intentando guardar reporte...");
    try {
        const { dni, nombre, reporteTexto } = req.body;
        if (!dni || !reporteTexto) return res.status(400).json({ error: 'Faltan datos' });

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        const resDNI = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Informes IA'!A:A` });
        const rows = resDNI.data.values || [];
        
        const rowIndex = rows.findIndex(r => {
            const dniExcel = r[0]?.toString().replace("'", "").trim();
            return dniExcel == dni.toString().trim();
        });

        if (rowIndex !== -1) {
            console.log(`🔄 Actualizando reporte existente para DNI ${dni}`);
            await sheets.spreadsheets.values.update({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!C${rowIndex + 1}`, 
                valueInputOption: 'RAW', 
                resource: { values: [[reporteTexto]] } 
            });
        } else {
            console.log(`✨ Creando nuevo reporte para DNI ${dni}`);
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
        res.status(500).json({ error: 'Error Excel: ' + e.message }); 
    }
});

// ======================================================================
// 🧠 RUTA IA: TONO "MÉDICO MODERNO" + ICONOS + FORMATO VISUAL
// ======================================================================

function construirPrompt(datosPersona) {
    const datosJson = JSON.stringify(datosPersona, null, 2);
    const nombreMedico = datosPersona['Profesional'] || 'Equipo Médico IAPOS';
    
    // Extraemos solo el nombre de pila para el saludo (ej: "Melani")
    // Suponemos formato "Aguiar Melani Solange", tomamos el segundo elemento
    let partesNombre = datosPersona['apellido y nombre'].split(' ');
    let nombrePila = partesNombre.length > 1 ? partesNombre[1] : partesNombre[0];

    return `Actúa como el Dr./Dra. ${nombreMedico}, del equipo de salud de IAPOS.
    Genera un informe médico visual y fácil de leer para el paciente.

    INSTRUCCIONES DE DISEÑO Y TONO:
    1.  **Encabezado:** Mantenlo formal (Fecha, Profesional, Paciente, DNI, Edad).
    2.  **Saludo:** "Hola ${nombrePila}", cálido pero profesional.
    3.  **Cuerpo Visual:**
        * Usa **ICONOS** (emojis) al inicio de cada punto (ej: 🫀 para corazón, 🦷 para dientes, 💉 para vacunas, 🥗 para hábitos).
        * Usa **SEMÁFOROS** claros:
            * 🟢 (Verde/Excelente): Para valores normales.
            * 🟡 (Amarillo/Alerta): Para advertencias leves.
            * 🔴 (Rojo/Acción): Para riesgos o estudios faltantes importantes.
    4.  **Estilo de Escritura:** Directo y moderno. No uses lenguaje legal ("Me dirijo a usted en mi carácter de..."). Habla claro: "Tus valores están bien", "Necesitamos ver esto".
    5.  **Cierre:** "Saludos cordiales, Dr./Dra. ${nombreMedico}". **NO** pongas número de matrícula.

    CONTENIDO MÉDICO:
    * Felicita los hábitos saludables.
    * Explica claramente por qué es importante hacerse el PAP/HPV o ir al odontólogo si falta, pero sin tono de regaño.

    DATOS A PROCESAR:
    ${datosJson}`;
}

function limpiarRespuesta(texto) {
    let limpio = texto.replace(/```[\s\S]*?```/g, "");
    limpio = limpio.replace(/DATOS DEL PACIENTE/gi, "");
    limpio = limpio.replace(/REPORTE TÉCNICO/gi, "");
    return limpio.trim();
}

app.post('/api/analizar-informe', async (req, res) => {
    if (!req.body.persona) return res.status(400).json({ error: 'Faltan datos' });
    console.log(`🧠 Generando informe moderno...`);

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

// ======================================================================
// 🔐 RUTA CAMBIAR CONTRASEÑA (NUEVO)
// ======================================================================
app.post('/api/auth/cambiar-password', async (req, res) => {
    console.log("🔐 Intentando cambiar contraseña...");
    try {
        const { dni, nuevaClave } = req.body;
        
        if (!dni || !nuevaClave) {
            return res.status(400).json({ error: 'Faltan datos' });
        }

        // 1. Encriptamos la nueva clave para que sea segura
        const hash = await bcrypt.hash(nuevaClave, 10);

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        // 2. Buscamos al usuario en la hoja "Usuarios"
        // NOTA: Asumimos que la hoja se llama "Usuarios" y la Columna A es el DNI
        const resUsuarios = await sheets.spreadsheets.values.get({ 
            spreadsheetId: SPREADSHEET_ID, 
            range: `'Usuarios'!A:A` 
        });
        
        const rows = resUsuarios.data.values || [];
        // Buscamos la fila del DNI (ignorando comillas si las hubiera)
        const rowIndex = rows.findIndex(r => r[0]?.toString().replace("'", "").trim() == dni.toString().trim());

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Usuario no encontrado en la base de datos.' });
        }

        // 3. Guardamos la NUEVA clave encriptada en la Columna B (que es la 2da columna)
        // rowIndex + 1 porque Excel empieza en fila 1, no 0
        await sheets.spreadsheets.values.update({ 
            spreadsheetId: SPREADSHEET_ID, 
            range: `'Usuarios'!B${rowIndex + 1}`, 
            valueInputOption: 'RAW', 
            resource: { values: [[hash]] } 
        });

        console.log(`✅ Contraseña actualizada para DNI ${dni}`);
        res.json({ success: true });

    } catch (e) { 
        console.error("❌ ERROR AL CAMBIAR CLAVE:", e.message);
        res.status(500).json({ error: 'Error al actualizar: ' + e.message }); 
    }
});

// START
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
async function start() { await loadTokens(); app.listen(PORT, () => console.log(`🚀 Servidor listo: http://localhost:${PORT}`)); }
start();