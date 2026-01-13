require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// ----------------------------------------------------------------------
// CONFIGURACIÓN DE URL DEL MICROSERVICIO DE ESTUDIOS (CRÍTICO)
// ----------------------------------------------------------------------
const ESTUDIOS_API_URL = process.env.ESTUDIOS_API_URL || 'http://localhost:4000';
console.log(`📡 URL de Microservicio de Estudios configurada: ${ESTUDIOS_API_URL}`);
// ----------------------------------------------------------------------

// --- CONFIGURACIÓN DE AUTENTICACIÓN ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

// 🚀 INICIALIZACIÓN DE GEMINI (RESTAURADO)
const ai = new GoogleGenAI({}); 

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

// --- RUTAS DE AUTENTICACIÓN ---
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

// ----------------------------------------------------------------------
// FUNCIONES AUXILIARES (RESTAURADAS Y BLINDADAS)
// ----------------------------------------------------------------------

function parseGoogleQueryDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const match = dateString.match(/date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
    if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        const day = parseInt(match[3]);
        return new Date(Date.UTC(year, month, day));
    }
    try {
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        return null;
    }
}

function procesarYObtenerUltimo(rows, cols) {
    if (!rows || rows.length === 0) {
        return { reportePrincipal: null, historialFechas: [], reports: [] };
    }

    const headers = cols.map(col => col.label || col.id);
    
    const registrosCompletos = rows.map(row => {
        const registro = {};
        row.c.forEach((cell, index) => {
            const header = headers[index];
            registro[header] = cell?.f || cell?.v || '';
            if (header === "FECHAX" && cell?.v) {
                registro.rawDate = parseGoogleQueryDate(cell.v);
            }
        });
        return registro;
    });

    // PARCHE DE SEGURIDAD: Si no hay fechas válidas por error en el Excel, 
    // simplemente usamos el orden de la tabla.
    const tieneFechas = registrosCompletos.some(r => r.rawDate);
    let sortedRecords;

    if (tieneFechas) {
        sortedRecords = registrosCompletos
            .filter(r => r.rawDate)
            .sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
    } else {
        // Si rompiste la columna FECHAX, invertimos para que el último sea el primero
        sortedRecords = [...registrosCompletos].reverse();
    }

    const reportePrincipal = sortedRecords[0] || null;

    const historialFechas = sortedRecords.map((record, index) => ({
        dni: record["DNI"] || record["C"],
        fecha: record["FECHAX"] || "Sin fecha",
        fechaRaw: record.rawDate ? record.rawDate.toISOString().split('T')[0] : '',
        isLatest: index === 0,
    }));
    
    return { 
        reportePrincipal, 
        historialFechas,
        reports: sortedRecords 
    };
}

// --- RUTA DE BÚSQUEDA ---
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const dniBuscado = req.body.dni.trim();
        const sheetName = 'Integrado'; 
        const query = encodeURIComponent(`select * where C = '${dniBuscado}'`); 
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        console.log(`Consultando API de Query para DNI: ${dniBuscado}...`);
        const response = await axios.get(queryUrl);
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (dataJson.errors || !dataJson.table || dataJson.table.rows.length === 0) {
            return res.status(404).json({ message: 'No se encontraron datos.' });
        }

        const { reportePrincipal, historialFechas, reports } = procesarYObtenerUltimo(dataJson.table.rows, dataJson.table.cols);

        if (!reportePrincipal) {
            return res.status(404).json({ message: 'No se pudo procesar el informe.' });
        }

        res.json({ 
            persona: reportePrincipal, 
            historialFechas: historialFechas, 
            reports: reports 
        });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// --- RUTA: BÚSQUEDA POR FECHA ---
app.post('/api/buscar-datos-por-fecha', async (req, res) => {
    try {
        const { dni, fechaRaw } = req.body;
        if (!dni || !fechaRaw) return res.status(400).json({ error: 'Faltan datos.' });
        
        const [year, month, day] = fechaRaw.split('-').map(Number);
        const gvizDate = `date(${year}, ${month - 1}, ${day})`;
        const query = encodeURIComponent(`select * where C = '${dni}' and G = ${gvizDate} limit 1`);
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado&tq=${query}`;

        const response = await axios.get(queryUrl);
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (dataJson.errors || !dataJson.table || dataJson.table.rows.length === 0) {
            return res.status(404).json({ message: 'No se encontró registro histórico.' });
        }

        const headers = dataJson.table.cols.map(col => col.label || col.id);
        const personaData = dataJson.table.rows[0].c; 
        const persona = {};
        headers.forEach((header, index) => {
            persona[header] = personaData[index]?.f || personaData[index]?.v || ''; 
        });

        res.json({ persona });
    } catch (error) {
        res.status(500).json({ error: 'Error al consultar histórico.' });
    }
});

// --- PROMPT DE LUJO (RESTAURADO TAL CUAL) ---
function construirPrompt(datosPersona) {
    // 1. BÚSQUEDA INTELIGENTE DEL PROFESIONAL
    // Buscamos cualquier columna que se parezca a "profesional" (ignora mayúsculas y espacios)
    const keyProfesional = Object.keys(datosPersona).find(key => 
        key && key.trim().toLowerCase() === 'profesional'
    );

    // Obtenemos el valor. Si está vacío, ponemos un texto genérico amable.
    const nombreProfesional = (keyProfesional && datosPersona[keyProfesional]) 
        ? datosPersona[keyProfesional] 
        : "un profesional médico de IAPOS";

    // --- DEBUG: ESTO SALDRÁ EN TU CONSOLA NEGRA PARA CONTROL ---
    console.log("🔍 Claves leídas del Excel:", Object.keys(datosPersona)); // ¿Dice 'Profesional' o dice 'A', 'B'...?
    console.log("👨‍⚕️ Profesional detectado:", nombreProfesional);
    // -----------------------------------------------------------
    const fechaInforme = datosPersona["FECHAX"] || "la fecha de tu último chequeo";
    const datosJson = JSON.stringify(datosPersona, null, 2);
    const camposDeRiesgo = ["Dislipemias", "Diabetes", "Presión Arterial", "IMC", "Alimentación saludable", "Actividad física", "Tabaco", "Estratificación riesgo CV", "Audición", "Agudeza visual"];

    const encabezadoDinamico = `
        ---
        **ESTE ES UN INFORME PROFESIONAL**
        
        Este análisis fue realizado exclusivamente para usted por el Profesional **${nombreProfesional}**, médico preventivista del programa **Día Preventivo de IAPOS**, en base a los estudios, preguntas y resultados que surgen de su participación en este programa el día **${fechaInforme}**.
        
        ---
    `;

    return `
        Eres un Asistente de Salud de IAPOS, tu tono debe ser amable, profesional, positivo, empático y 100% enfocado en la **prevención**.
        Tu tarea es generar un informe de devolución para el afiliado, basado en los datos de su último chequeo.
        
        ### Instrucciones de Estilo y Formato:
        1. **Usa Markdown:** Emplea negritas, listas y saltos de línea.
        2. **Usa Emojis:** 🔴 Riesgo, 🟡 Vigilancia, 🟢 Positivo.
        3. **Formato:** Empieza directamente con el saludo.
        
        ### Estructura del Informe Requerido:
        1. **Encabezado Específico:**
            ${encabezadoDinamico}
        2. **Saludo y Resumen Positivo Inicial.**
        3. **Sección de Atención y Prevención (Clave):**
            * Identifica riesgos en: ${camposDeRiesgo.join(', ')}.
        4. **Llamado a la Acción Estandarizado (Obligatorio al final):**
            ---
            **Próximo Paso: Conexión con Nuestros Profesionales**
            Tu salud es nuestra prioridad...
        
        **INFORME DE SALUD A ANALIZAR (Datos Brutos):**
        ${datosJson}
    `;
}

// --- RUTA PARA EL ANÁLISIS DE IA (RESTAURADA) ---
app.post('/api/analizar-informe', async (req, res) => {
    if (!req.body) return res.status(400).json({ error: 'Faltan datos.' });
    
    const prompt = construirPrompt(req.body);
    console.log(`Enviando análisis a Gemini...`);

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-09-2025", // He actualizado al modelo soportado por el entorno para que no de 404
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const resumenAI = response.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo generar el resumen.";
        res.json({ resumen: resumenAI.trim() });
    } catch (error) {
        console.error('🚨 ERROR CRÍTICO DE GEMINI:', error.message);
        res.status(500).json({ error: 'Fallo al generar el resumen personalizado con IA.' });
    }
});

// --- RUTA DE INYECCIÓN ---
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    try {
        let htmlContent = fs.readFileSync(filePath, 'utf8');
        const injectionScript = `
        <script>
            window.ESTUDIOS_API_URL = '${ESTUDIOS_API_URL}';
            console.log('API de Estudios configurada en:', window.ESTUDIOS_API_URL);
        </script>
        `;
        htmlContent = htmlContent.replace('</head>', `${injectionScript}</head>`);
        res.send(htmlContent);
    } catch (error) {
        res.status(500).send("Error al cargar la aplicación.");
    }
});

app.use(express.static(path.join(__dirname, 'public')));

async function startServer() {
    await loadTokens(); 
    app.listen(PORT, () => {
        console.log(`Servidor del Portal de Afiliados escuchando en http://localhost:${PORT}`);
    });
}

startServer();