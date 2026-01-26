const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Rutas de archivos
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
// Permiso SOLO para Hojas de Cálculo (que es lo que fallaba)
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

fs.readFile(CREDENTIALS_PATH, (err, content) => {
  if (err) return console.log('❌ Error cargando credentials.json:', err);
  authorize(JSON.parse(content));
});

function authorize(credentials) {
  const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n=========================================================');
  console.log('🔐 GENERADOR MANUAL DE TOKEN (Google Sheets)');
  console.log('=========================================================');
  console.log('1. Entra a este enlace con la cuenta de PORTALAFILIADO:');
  console.log('\n   ' + authUrl + '\n');
  console.log('2. Autoriza todo (dale "Permitir" a los permisos de Drive/Sheets).');
  console.log('3. Al final, te dará un CÓDIGO o te llevará a una página (quizás con error).');
  console.log('4. COPIA EL CÓDIGO de la URL (lo que está después de "code=")');
  console.log('=========================================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('👉 PEGA AQUÍ EL CÓDIGO Y DALE ENTER: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('❌ Error obteniendo token (invalid_grant): El código venció o es incorrecto. Intenta de nuevo.');
      oAuth2Client.setCredentials(token);
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('\n✅ ¡TOKEN GUARDADO CORRECTAMENTE!');
        console.log('🚀 Ahora ya puedes iniciar node server.js');
      });
    });
  });
}