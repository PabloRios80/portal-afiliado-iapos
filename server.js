require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// ----------------------------------------------------------------------
// CONFIGURACIÓN DE URL DEL MICROSERVICIO DE ESTUDIOS
// ----------------------------------------------------------------------
const ESTUDIOS_API_URL = process.env.ESTUDIOS_API_URL || 'http://localhost:4000';
console.log(`📡 URL de Microservicio de Estudios configurada: ${ESTUDIOS_API_URL}`);

// ----------------------------------------------------------------------
// CONFIGURACIÓN DE AUTENTICACIÓN GOOGLE
// ----------------------------------------------------------------------
// Intenta leer credentials.json si las variables de entorno no están completas
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Fallback robusto para leer credenciales si no están en .env
if (!CLIENT_ID || !CLIENT_SECRET) {
    try {
        if (fs.existsSync('credentials.json')) {
            const keys = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
            const keyData = keys.web || keys.installed;
            if (keyData) {
                CLIENT_ID = keyData.client_id;
                CLIENT_SECRET = keyData.client_secret;
                console.log("🔑 Credenciales cargadas desde credentials.json");
            }
        }
    } catch (e) {
        console.warn("⚠️ No se encontraron credenciales en .env ni en JSON.");
    }
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
// ==========================================
// AUTO-RENOVACIÓN DE TOKENS (MAGIA) ✨
// ==========================================
oauth2Client.on('tokens', (tokens) => {
    console.log("🔄 Google ha renovado el token automáticamente.");
    
    if (tokens.refresh_token) {
        // Si viene un nuevo refresh token, lo guardamos
        console.log("✨ ¡Tenemos nuevo Refresh Token!");
    }
    
    // Leemos el token actual para no perder el refresh_token si Google no lo manda esta vez
    try {
        const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        // Mezclamos el token viejo con el nuevo (así el refresh_token sobrevive)
        const newToken = { ...currentToken, ...tokens };
        saveTokens(newToken);
    } catch (e) {
        saveTokens(tokens);
    }
});
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_iapos_2025';

// 🚀 INICIALIZACIÓN DE GEMINI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); 

// ======================================================================
// GESTIÓN DE TOKENS (Lectura y Escritura)
// ======================================================================

function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Autoriza esta app visitando esta URL:', authUrl);
    // (Lógica de consola simplificada para servidor)
}

async function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
            oauth2Client.setCredentials(tokens);
            console.log('Tokens cargados con éxito.');
            return true;
        }
    } catch (err) {
        console.error('Error cargando tokens:', err);
    }
    console.log('⚠️ No se encontraron tokens válidos. Se requiere autenticación manual.');
    return false;
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Tokens guardados en token.json.');
}

// ======================================================================
// RUTAS DE AUTENTICACIÓN (LOGIN / REGISTRO)
// ======================================================================

// 1. REGISTRO
app.post('/api/auth/registro', async (req, res) => {
    const { dni, email, password } = req.body;
    
    // Aquí deberíamos verificar primero si existe en "Integrado", pero por ahora registramos directo
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    // Verificar si ya existe en Usuarios
    // (Omitido por brevedad, asumiendo que el frontend maneja errores básicos)

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Usuarios!A:D',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[dni, email, hash, 'user']] }
        });
        res.json({ message: 'Cuenta creada con éxito.' });
    } catch (error) {
        console.error('Error registro:', error);
        res.status(500).json({ error: 'Error al guardar usuario.' });
    }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { dni, password } = req.body;
        console.log(`Intentando login para DNI: ${dni}`);

        const sheetName = 'Usuarios'; 
        const query = encodeURIComponent(`select * where A = '${dni}'`); 
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        const response = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (!dataJson.table || dataJson.table.rows.length === 0) {
            return res.status(400).json({ error: 'DNI no encontrado.' });
        }

        const row = dataJson.table.rows[0];
        const hashGuardado = row.c[1]?.v; 
        let rolLeido = row.c[2]?.v; 
        const rolUsuario = rolLeido ? String(rolLeido).toLowerCase().trim() : 'user';

        if (!hashGuardado) return res.status(400).json({ error: 'Usuario sin contraseña.' });

        const coincide = await bcrypt.compare(password, hashGuardado);

        if (coincide) {
            console.log(`Login exitoso: ${dni} es rol: ${rolUsuario}`);
            res.json({ 
                success: true, 
                token: 'token_simulado_123', 
                usuario: { dni: dni, rol: rolUsuario }
            });
        } else {
            res.status(400).json({ error: 'Contraseña incorrecta' });
        }
    } catch (error) {
        console.error('Error Login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ======================================================================
// RUTA: BUSCAR DATOS (INTEGRADO + INFORMES IA)
// ======================================================================
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const { dniBuscado, usuarioSolicitante } = req.body;
        console.log(`🔎 Buscando datos para DNI: ${dniBuscado}`);

        if (!usuarioSolicitante) return res.status(400).json({ error: 'Falta usuario solicitante' });
        
        // Seguridad: Usuario normal solo ve su propio DNI
        if (usuarioSolicitante.rol !== 'admin' && String(usuarioSolicitante.dni) !== String(dniBuscado)) {
            return res.status(403).json({ error: 'Acceso denegado.' });
        }

        const accessToken = (await oauth2Client.getAccessToken()).token;
        
        // --- BÚSQUEDA PARALELA ---
        // 1. Integrado (Datos Médicos)
        const queryMedica = encodeURIComponent(`select * where C = '${dniBuscado}'`);
        const urlMedica = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado&tq=${queryMedica}`;
        
        // 2. Informes IA (Reportes guardados - HOJA NUEVA)
        const queryInforme = encodeURIComponent(`select C where A = '${dniBuscado}'`);
        const urlInforme = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Informes IA&tq=${queryInforme}`;

        const [resMedica, resInforme] = await Promise.all([
            axios.get(urlMedica, { headers: { Authorization: `Bearer ${accessToken}` } }),
            axios.get(urlInforme, { headers: { Authorization: `Bearer ${accessToken}` } })
        ]);

        // Procesar Integrado
        const txtMedica = resMedica.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const jsonMedica = JSON.parse(txtMedica);
        const rows = jsonMedica.table.rows;

        // 🚨 SI NO ESTÁ EN INTEGRADO, NO EXISTE EL PACIENTE
        if (rows.length === 0) {
            console.log("❌ DNI no encontrado en hoja Integrado.");
            return res.status(404).json({ 
                error: 'No existe cierre del Día Preventivo, consulte con el programa.' 
            });
        }

        // Procesar Informe IA
        const txtInforme = resInforme.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const jsonInforme = JSON.parse(txtInforme);
        
        let reporteGuardado = null;
        if (jsonInforme.table.rows.length > 0 && jsonInforme.table.rows[0].c[0]) {
            reporteGuardado = jsonInforme.table.rows[0].c[0].v;
        }

        // Armar respuesta combinada
        const reports = rows.map(row => {
            const rowData = {};
            jsonMedica.table.cols.forEach((col, index) => {
                if (col.label) {
                    rowData[col.label] = row.c[index] ? row.c[index].v : '';
                }
            });
            // Inyectamos el reporte encontrado
            rowData['REPORTE_MEDICO'] = reporteGuardado; 
            return rowData;
        });

        console.log(`✅ Paciente encontrado. Reporte IA previo: ${reporteGuardado ? 'SÍ' : 'NO'}`);
        res.json({ reports });

    } catch (error) {
        console.error('🔥 Error buscando datos:', error);
        res.status(500).json({ error: 'Error interno al procesar datos.' });
    }
});

// ======================================================================
// RUTA: GUARDAR REPORTE (NUEVA LÓGICA EN 'Informes IA')
// ======================================================================


app.post('/api/guardar-reporte', async (req, res) => {
    try {
        const { dni, nombre, reporteTexto } = req.body;
        
        if (!dni || !reporteTexto) {
            console.error("❌ Faltan datos en la petición de guardado.");
            return res.status(400).json({ error: 'Faltan datos.' });
        }

        console.log(`📝 Procesando guardado para DNI: ${dni}...`);
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        // ⚠️ HOJA DESTINO: Informes IA
        const sheetName = 'Informes IA'; 

        // 1. LEER COLUMNA A (DNI) DE LA HOJA DE INFORMES
        let responseDNI;
        try {
            responseDNI = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${sheetName}'!A:A`, 
            });
        } catch (error) {
            console.error(`❌ Error al leer la hoja '${sheetName}'. ¿Existe?`);
            throw error;
        }

        const rows = responseDNI.data.values || [];
        let rowIndex = -1;

        // 2. BUSCAR SI YA EXISTE
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] && String(rows[i][0]).trim() === String(dni).trim()) {
                rowIndex = i + 1; // Excel base 1
                break;
            }
        }

        if (rowIndex !== -1) {
            // ACTUALIZAR (Columna C)
            console.log(`🔄 Actualizando fila ${rowIndex}...`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${sheetName}'!C${rowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [[reporteTexto]] }
            });
        } else {
            // CREAR NUEVO (Append al final: DNI, NOMBRE, REPORTE)
            console.log(`➕ Creando nueva fila...`);
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${sheetName}'!A:C`,
                valueInputOption: 'RAW',
                resource: { values: [[dni, nombre || 'Paciente', reporteTexto]] }
            });
        }

        console.log("✅ Guardado exitoso.");
        res.json({ success: true, message: 'Reporte guardado.' });

    } catch (error) {
        console.error('🔥 Error fatal al guardar en Excel:', error);
        res.status(500).json({ error: 'Error interno al escribir en Excel: ' + error.message });
    }
});

// ======================================================================
// GENERACIÓN DE TEXTO CON IA (PROMPT Y RUTA)
// ======================================================================

function construirPrompt(datosPersona) {
    const keyProfesional = Object.keys(datosPersona).find(key => key && key.trim().toLowerCase() === 'profesional');
    const nombreProfesional = (keyProfesional && datosPersona[keyProfesional]) ? datosPersona[keyProfesional] : "un profesional médico de IAPOS";
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

app.post('/api/analizar-informe', async (req, res) => {
    if (!req.body || !req.body.persona) return res.status(400).json({ error: 'Faltan datos.' });
    
    console.log(`Enviando análisis a Gemini...`);
    const prompt = construirPrompt(req.body.persona);

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash", // Usamos un modelo estándar estable
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const resumenAI = response.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo generar el resumen.";
        res.json({ resumen: resumenAI.trim() });
    } catch (error) {
        console.error('🚨 ERROR CRÍTICO DE GEMINI:', error.message);
        res.status(500).json({ error: 'Fallo al generar el resumen con IA.' });
    }
});

// ======================================================================
// INYECCIÓN DE VARIABLES AL FRONTEND
// ======================================================================
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

// --- RUTA OAUTH (CALLBACK) ---
app.get('/oauth2callback', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);
        res.send('Autenticación exitosa. Tokens guardados.');
    } catch (err) {
        console.error('Error tokens:', err);
        res.status(500).send('Error de autenticación.');
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