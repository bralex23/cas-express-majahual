/**
 * CAS Express — Backup automático de Firestore
 * Usa Firebase Admin SDK (bypasa reglas de seguridad)
 * Uso: node backup.js
 * Guarda los backups en la carpeta: CAS EXPRESS SISTEMA/backups/
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ── Clave de cuenta de servicio ────────────────────────────────────────────
const SERVICE_ACCOUNT = require('./serviceAccountKey.json');

// ── Carpeta donde se guardan los backups ───────────────────────────────────
const BACKUP_DIR = path.join(__dirname, 'backups');

// ──────────────────────────────────────────────────────────────────────────

async function backup() {
  const inicio = Date.now();
  const fecha  = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  console.log(`\n🔄 CAS Express — Backup iniciado: ${fecha}`);

  // Crear carpeta de backups si no existe
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`📁 Carpeta creada: backups/`);
  }

  // Inicializar Firebase Admin
  admin.initializeApp({
    credential: admin.credential.cert(SERVICE_ACCOUNT),
  });

  const db = admin.firestore();

  const datos = {
    generado_en: new Date().toISOString(),
    proyecto:    SERVICE_ACCOUNT.project_id,
    colecciones: {},
  };

  // ── Leer clientes ──────────────────────────────────────────────────────
  console.log('📋 Leyendo clientes...');
  const clientesSnap = await db.collection('clientes').get();
  datos.colecciones.clientes = clientesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`   → ${datos.colecciones.clientes.length} clientes`);

  // ── Leer usuarios ──────────────────────────────────────────────────────
  console.log('👤 Leyendo usuarios...');
  const usuariosSnap = await db.collection('usuarios').get();
  datos.colecciones.usuarios = usuariosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`   → ${datos.colecciones.usuarios.length} usuarios`);

  // ── Leer rutas ─────────────────────────────────────────────────────────
  console.log('🗺️  Leyendo rutas...');
  const rutasSnap = await db.collection('rutas').get();
  datos.colecciones.rutas = rutasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`   → ${datos.colecciones.rutas.length} rutas`);

  // ── Leer préstamos + pagos (collectionGroup: 2 queries en vez de N+1) ──
  console.log('💰 Leyendo préstamos y pagos...');
  const [prestamosSnap, todosLosPagosSnap] = await Promise.all([
    db.collection('prestamos').get(),
    db.collectionGroup('pagos').get(),
  ]);

  // Agrupar pagos por ID del préstamo padre
  const pagosPorPrestamo = {};
  for (const pago of todosLosPagosSnap.docs) {
    const prestamoId = pago.ref.parent.parent.id;
    if (!pagosPorPrestamo[prestamoId]) pagosPorPrestamo[prestamoId] = [];
    pagosPorPrestamo[prestamoId].push({ id: pago.id, ...pago.data() });
  }

  const prestamos = prestamosSnap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    pagos: pagosPorPrestamo[d.id] || [],
  }));

  datos.colecciones.prestamos = prestamos;
  const totalPagos = prestamos.reduce((s, p) => s + p.pagos.length, 0);
  console.log(`   → ${prestamos.length} préstamos, ${totalPagos} pagos`);

  // ── Guardar archivo JSON ───────────────────────────────────────────────
  const archivo   = path.join(BACKUP_DIR, `backup_${fecha}.json`);
  const contenido = JSON.stringify(datos, null, 2);
  fs.writeFileSync(archivo, contenido, 'utf-8');

  const kb       = (Buffer.byteLength(contenido) / 1024).toFixed(1);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log(`\n✅ Backup completado en ${segundos}s`);
  console.log(`📦 Archivo: backups/backup_${fecha}.json (${kb} KB)`);

  // ── Limpiar backups viejos (mantener últimos 30) ───────────────────────
  const archivos = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort();

  if (archivos.length > 30) {
    const aEliminar = archivos.slice(0, archivos.length - 30);
    aEliminar.forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log(`🗑️  Backup antiguo eliminado: ${f}`);
    });
  }

  console.log(`📁 Backups guardados: ${Math.min(archivos.length, 30)}/30\n`);
  process.exit(0);
}

backup().catch(err => {
  console.error('\n❌ Error en el backup:', err.message);
  process.exit(1);
});
