const { google } = require('googleapis');
const fs = require('fs');
const bcrypt = require('bcrypt');

// CONFIGURACIÓN
const SPREADSHEET_ID = '1N9grVSOQgG_-XSJBZVs02V5kSEeq23bA7pY7yBfXLPw'; // <--- PON TU ID AQUI
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Cargar credenciales
const credentials = require('./credentials.json');
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Cargar token
const token = fs.readFileSync('token.json');
oAuth2Client.setCredentials(JSON.parse(token));
const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });

async function procesarAltas() {
    console.log('⏳ Leyendo datos...');

    // 1. Leer DNIs de la hoja médica ("Integrado") - Asumiendo DNI en Columna C
    const responseMedica = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Integrado!C2:C', // Ajusta si tu DNI no está en la C
    });
    const dnisMedicos = responseMedica.data.values ? responseMedica.data.values.flat() : [];

    // 2. Leer Usuarios existentes
    const responseUsers = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Usuarios!A2:A',
    });
    const dnisUsuarios = responseUsers.data.values ? responseUsers.data.values.flat() : [];

    // 3. Filtrar quién falta
    // (Buscamos DNIs médicos que NO estén en la lista de usuarios)
    const nuevosUsuarios = dnisMedicos.filter(dni => !dnisUsuarios.includes(dni) && dni);

    if (nuevosUsuarios.length === 0) {
        console.log('✅ Todos los pacientes ya tienen usuario creado.');
        return;
    }

    console.log(`🚀 Se encontraron ${nuevosUsuarios.length} pacientes sin usuario. Creando...`);

    const nuevasFilas = [];

    for (const dni of nuevosUsuarios) {
        // ESTRATEGIA: La clave inicial es el mismo DNI
        const passwordPlano = dni.toString().trim(); 
        const hash = await bcrypt.hash(passwordPlano, 10);
        
        // Estructura: [DNI, PasswordHash, Rol]
        nuevasFilas.push([dni, hash, 'user']);
        console.log(`Prepared: ${dni} (Clave: ${dni})`);
    }

    // 4. Guardar en Excel
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Usuarios!A:C',
        valueInputOption: 'RAW',
        resource: { values: nuevasFilas }
    });

    console.log('✅ ¡Listo! Usuarios creados exitosamente.');
}

procesarAltas();