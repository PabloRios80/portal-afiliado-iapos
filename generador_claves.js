const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n--- GENERADOR DE CONTRASEÑAS SEGURAS ---');
rl.question('Escribe la contraseña que quieres usar (ej: admin2026): ', (password) => {
    
    bcrypt.hash(password, 10, function(err, hash) {
        if (err) return console.error(err);
        
        console.log('\n✅ OK, esta es tu contraseña encriptada:');
        console.log('📋 Copia esto y pégalo en la COLUMNA B del Excel:');
        console.log('---------------------------------------------------');
        console.log(hash);
        console.log('---------------------------------------------------\n');
        
        rl.close();
    });
});