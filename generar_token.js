const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// 1. DEFINIR LOS PERMISOS (SCOPES) - ¡AQUÍ ESTÁ LA CLAVE PARA PODER ESCRIBIR!
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'token.json';

// 2. CARGAR CREDENCIALES
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error cargando credentials.json:', err);
  authorize(JSON.parse(content));
});

function authorize(credentials) {
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Como no tenemos token, pedimos uno nuevo directamente
  getNewToken(oAuth2Client);
}

function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n================================================================================');
  console.log('🔗  HAZ CLIC EN ESTE ENLACE PARA AUTORIZAR (Usa la cuenta dueña del Excel):');
  console.log('================================================================================\n');
  console.log(authUrl);
  console.log('\n================================================================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('📋  Pega aquí el código que te dio Google y presiona ENTER: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error obteniendo el token:', err);
      
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('\n✅  ¡ÉXITO! Token almacenado en', TOKEN_PATH);
        console.log('Ahora puedes cerrar esto e iniciar tu servidor normal con "node server.js"');
      });
    });
  });
}