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
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

// 🚀 INICIALIZACIÓN DE GEMINI (RESTAURADO)
const ai = new GoogleGenAI({}); 

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// CLAVE SECRETA PARA LOS TOKENS (En producción esto va en .env, por ahora ponlo aquí)
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_iapos_2025';

function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    
    console.log('\n\n=============================================================');
    console.log('⚠️  ATENCIÓN: NECESITAS AUTORIZAR LA APP  ⚠️');
    console.log('=============================================================');
    console.log('Copia y pega este enlace en tu navegador:');
    console.log('\n' + authUrl + '\n');
    console.log('=============================================================');
    console.log('Luego, pega el código que te de Google aquí abajo:');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Ingresa el código aquí: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error while trying to retrieve access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token almacenado en', TOKEN_PATH);
                callback(oAuth2Client);
            });
        });
    });
}

// --- MIDDLEWARE DE AUTENTICACIÓN (EL GUARDIA) ---
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    // El formato suele ser: "Bearer TU_TOKEN_AQUI"
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado.' });
        }
        // Si el token es válido, guardamos los datos del usuario en la petición
        req.user = user; 
        next();
    });
}

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

// --- FUNCIONES DE GESTIÓN DE USUARIOS (Hoja 'Usuarios') ---

async function buscarUsuarioPorDNI(dni) {
    const sheetName = 'Usuarios';
    // Nota: Usamos la misma lógica de query que ya tienes
    const query = encodeURIComponent(`select * where A = '${dni}'`);
    const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${sheetName}&tq=${query}`;

    try {
        const response = await axios.get(queryUrl);
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (!dataJson.table || dataJson.table.rows.length === 0) return null;

        const row = dataJson.table.rows[0].c;
        return {
            dni: row[0]?.v,       // Columna A
            email: row[1]?.v,     // Columna B
            password: row[2]?.v,  // Columna C (Hash)
            rol: row[3]?.v        // Columna D (admin/user)
        };
    } catch (error) {
        console.error('Error buscando usuario:', error);
        return null;
    }
}

// Para guardar un usuario nuevo, necesitamos escribir en el Sheet.
// IMPORTANTE: La API de 'gviz' (Query) es SOLO LECTURA. 
// Para escribir (registrar pass), necesitamos usar la API 'sheets' de googleapis que ya tienes configurada.
async function registrarUsuarioEnSheet(dni, email, passwordHash) {
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    // Primero chequeamos si ya existe para no duplicar (aunque lo haremos en el endpoint también)
    const request = {
        spreadsheetId: SPREADSHEET_ID,
        range: 'Usuarios!A:D',
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [[dni, email, passwordHash, 'user']] // Por defecto rol 'user'
        }
    };

    try {
        await sheets.spreadsheets.values.append(request);
        console.log(`Usuario ${dni} registrado en hoja Usuarios.`);
        return true;
    } catch (error) {
        console.error('Error al guardar en Sheet:', error);
        return false;
    }
}
// --- RUTAS DE SEGURIDAD (REGISTRO Y LOGIN) ---

// 1. REGISTRO (Crear Contraseña por primera vez)
app.post('/api/auth/registro', async (req, res) => {
    const { dni, email, password } = req.body;
    
    // Validar que el DNI exista en el padrón (Hoja Integrado)
    // (Opcional: aquí podrías verificar si el afiliado realmente existe antes de dejarlo crear cuenta)

    const usuarioExistente = await buscarUsuarioPorDNI(dni);
    if (usuarioExistente) {
        return res.status(400).json({ error: 'Este DNI ya tiene una cuenta creada.' });
    }

    // Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Guardar en Google Sheets
    const exito = await registrarUsuarioEnSheet(dni, email, hash);
    
    if (exito) {
        res.json({ message: 'Cuenta creada con éxito. Ahora puedes iniciar sesión.' });
    } else {
        res.status(500).json({ error: 'Error al guardar el usuario.' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    try {
        const { dni, password } = req.body;
        console.log(`Intentando login para DNI: ${dni}`);

        // 1. Configuración para buscar en Google Sheets
        const sheetName = 'Usuarios'; 
        // Asumiendo DNI en Columna A
        const query = encodeURIComponent(`select * where A = '${dni}'`); 
        
        // Obtener credenciales frescas
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        // Hacemos la petición a Google
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // Limpieza de datos (Google devuelve texto basura al principio)
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        // Si la tabla está vacía, el usuario no existe
        if (!dataJson.table || dataJson.table.rows.length === 0) {
            return res.status(400).json({ error: 'DNI no encontrado o formato incorrecto en Excel' });
        }

        // 2. Extraer datos del usuario (Columna A=0, B=1, C=2)
        const row = dataJson.table.rows[0];
        const hashGuardado = row.c[1]?.v; // Columna B (Password Encriptado)
        
        // CORRECCIÓN CLAVE: Leemos la Columna C (Rol) y la limpiamos
        let rolLeido = row.c[2]?.v; // Columna C
        
        // Normalizamos: Si es nulo es 'user', convertimos a minúsculas y quitamos espacios
        const rolUsuario = rolLeido ? String(rolLeido).toLowerCase().trim() : 'user';

        if (!hashGuardado) {
            return res.status(400).json({ error: 'Usuario sin contraseña configurada' });
        }

        // 3. Comparar contraseña escrita vs la del Excel (bcrypt)
        const coincide = await bcrypt.compare(password, hashGuardado);

        if (coincide) {
            // ¡ÉXITO!
            console.log(`Login exitoso: ${dni} es rol: ${rolUsuario}`);
            
            res.json({ 
                success: true, 
                message: 'Login correcto',
                token: 'token_simulado_123', // Token temporal
                usuario: { 
                    dni: dni, 
                    rol: rolUsuario // <--- ¡AQUÍ ESTÁ LA MAGIA! Enviamos el rol limpio
                }
            });
        } else {
            res.status(400).json({ error: 'Contraseña incorrecta' });
        }

    } catch (error) {
        console.error('Error en el servidor:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
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
app.post('/api/buscar-datos', async (req, res) => {
    try {
        // 1. 🕵️‍♂️ DIAGNÓSTICO: Ver qué nos envía el Frontend
        console.log("------------------------------------------------");
        console.log("📥 Petición recibida en /api/buscar-datos");
        console.log("📦 Datos del cuerpo (body):", req.body);
        
        const { dniBuscado, usuarioSolicitante } = req.body;

        // 2. 🛡️ SEGURIDAD: Validar que sepamos quién pregunta
        if (!usuarioSolicitante) {
            console.error("❌ ERROR CRÍTICO: 'usuarioSolicitante' es undefined.");
            return res.status(400).json({ error: 'Error de seguridad: No se identificó al usuario solicitante.' });
        }

        console.log(`👤 Solicita: ${usuarioSolicitante.rol} (DNI: ${usuarioSolicitante.dni})`);
        console.log(`🔎 Busca a: ${dniBuscado}`);

        // 3. 🔐 PERMISOS: El candado lógico
        // Normalizamos el rol a minúsculas por si acaso
        const rolUsuario = String(usuarioSolicitante.rol).toLowerCase();

        if (rolUsuario !== 'admin') {
            // Si NO es admin, solo puede ver sus propios datos
            // Convertimos ambos a texto para evitar errores de número vs texto
            if (String(usuarioSolicitante.dni) !== String(dniBuscado)) {
                console.warn("⛔ Acceso prohibido: Usuario intentó ver otro DNI");
                return res.status(403).json({ error: 'Acceso denegado: No tienes permiso para ver este informe.' });
            }
        }

        // 4. 🚀 BÚSQUEDA EN GOOGLE SHEETS (Si pasó la seguridad)
        const sheetName = 'Integrado';
        const query = encodeURIComponent(`select * where C = '${dniBuscado}'`);
        
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        // Procesar datos (igual que siempre)...
        const rows = dataJson.table.rows;
        const reports = rows.map(row => {
            const rowData = {};
            dataJson.table.cols.forEach((col, index) => {
                if (col.label) {
                    rowData[col.label] = row.c[index] ? row.c[index].v : '';
                }
            });
            return rowData;
        });

        console.log(`✅ Resultados encontrados: ${reports.length}`);
        res.json({ reports });

    } catch (error) {
        console.error('🔥 Error fatal en el servidor:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud.' });
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

// ==========================================
// RUTA PARA GUARDAR EL REPORTE EN EXCEL 💾
// ==========================================
app.post('/api/guardar-reporte', async (req, res) => {
    try {
        const { dni, reporteTexto } = req.body;
        
        if (!dni || !reporteTexto) {
            return res.status(400).json({ error: 'Faltan datos.' });
        }

        console.log(`📝 Guardando reporte para DNI: ${dni}...`);

        // 1. Conectamos con la API de Sheets
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        const sheetName = 'Integrado'; // Tu hoja de datos

        // 2. BUSCAR LA FILA DEL PACIENTE (Leemos la Columna C que tiene los DNIs)
        // Ojo: Ajusta el rango si tus DNIs no están en la Columna C.
        const responseDNI = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!C:C`, // Asumimos que DNI está en Columna C
        });

        const rows = responseDNI.data.values;
        let rowIndex = -1;

        // Buscamos en qué fila está el DNI (sumamos 1 porque el array empieza en 0 pero Excel en 1)
        if (rows && rows.length) {
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] && String(rows[i][0]).trim() === String(dni).trim()) {
                    rowIndex = i + 1; 
                    break;
                }
            }
        }

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Paciente no encontrado en el Excel.' });
        }

        // 3. BUSCAR LA COLUMNA "REPORTE_MEDICO" (Leemos los encabezados de la fila 1)
        const responseHeaders = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!1:1`, // Leemos toda la fila 1
        });
        
        const headers = responseHeaders.data.values[0];
        const colIndex = headers.indexOf('REPORTE_MEDICO');

        if (colIndex === -1) {
            return res.status(500).json({ error: 'No se encontró la columna REPORTE_MEDICO en la fila 1.' });
        }

        // Convertimos índice número a letra (ej: 25 -> Z)
        const getColumnLetter = (colIndex) => {
            let temp, letter = '';
            while (colIndex >= 0) {
                temp = (colIndex) % 26;
                letter = String.fromCharCode(temp + 65) + letter;
                colIndex = (colIndex - temp - 1) / 26;
                // Ajuste simple para columnas simples (A-Z)
                if(colIndex < 0) break;
            }
            return letter;
        };
        
        const colLetter = getColumnLetter(colIndex);
        const cellAddress = `${sheetName}!${colLetter}${rowIndex}`;

        console.log(`📍 Guardando en celda: ${cellAddress}`);

        // 4. ESCRIBIR EL DATO
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: cellAddress,
            valueInputOption: 'RAW',
            resource: {
                values: [[reporteTexto]]
            }
        });

        res.json({ success: true, message: 'Reporte guardado correctamente.' });

    } catch (error) {
        console.error('Error al guardar en Excel:', error);
        res.status(500).json({ error: 'Error interno al escribir en Excel.' });
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