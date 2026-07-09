/**
 * Actualizar nombre y rol de un usuario en Firestore
 * Uso: node scripts/actualizar-perfil.js
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const readline = require('readline');

// Configuracion Firebase (cas-express-majahual)
const firebaseConfig = {
  apiKey:            'AIzaSyD4bX7xerVyT7EfYWHtJpWSPLROWmLtbJ0',
  authDomain:        'cas-express-majahual.firebaseapp.com',
  projectId:         'cas-express-majahual',
  storageBucket:     'cas-express-majahual.firebasestorage.app',
  messagingSenderId: '505462096714',
  appId:             '1:505462096714:web:cca9e1af3839e1f05f77b3',
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n====================================');
  console.log('  Actualizar Perfil de Usuario');
  console.log('====================================\n');

  const email    = await ask('Email del usuario a actualizar: ');
  const password = await ask('Contraseña de ESE usuario: ');
  const nombre   = await ask('Nuevo nombre (ej: Brayan Avila): ');

  console.log('\nConectando...');

  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password.trim());
    const uid  = cred.user.uid;

    await updateDoc(doc(db, 'perfiles', uid), {
      nombre: nombre.trim(),
    });

    console.log(`\n✅ Perfil actualizado correctamente!`);
    console.log(`   UID:    ${uid}`);
    console.log(`   Nombre: ${nombre.trim()}`);
    console.log('\nReinicia la app para ver el cambio.\n');
  } catch (e) {
    console.error('\n❌ Error:', e.message, '\n');
  }

  rl.close();
  process.exit(0);
}

main();
