// backend/scripts/cleanup-orphans.js
// Script pour nettoyer les données orphelines avant d'activer les contraintes FK
require('dotenv').config();
const { sequelize } = require('../src/config/database');
async function cleanupOrphans() {
try {
console.log('🔌 Connexion à PostgreSQL...');
await sequelize.authenticate();
console.log('✅ Connecté!\n');
// 1️⃣ Compter les runs orphelins
console.log('🔍 Recherche de runs orphelins...');
const [countResult] = await sequelize.query(`
  SELECT COUNT(*) as count
  FROM publish_runs pr
  LEFT JOIN publish_jobs pj ON pr."jobId" = pj.id
  WHERE pj.id IS NULL
`);

const orphanCount = parseInt(countResult[0].count, 10);
console.log(`📊 Résultat: ${orphanCount} runs orphelins trouvés\n`);

if (orphanCount === 0) {
  console.log('✅ Aucune donnée orpheline. Base de données propre!');
  console.log('👉 Vous pouvez activer constraints: true en toute sécurité.\n');
  await sequelize.close();
  process.exit(0);
}

// 2️⃣ Afficher un aperçu
console.log('📋 Aperçu des runs orphelins (max 5):');
const [orphans] = await sequelize.query(`
  SELECT 
    pr.id,
    pr."jobId" as missing_job_id,
    pr.status,
    pr."createdAt"
  FROM publish_runs pr
  LEFT JOIN publish_jobs pj ON pr."jobId" = pj.id
  WHERE pj.id IS NULL
  ORDER BY pr."createdAt" DESC
  LIMIT 5
`);

orphans.forEach((run, i) => {
  console.log(`  ${i + 1}. Run ${run.id.slice(0, 8)} → Job manquant: ${run.missing_job_id.slice(0, 8)} (${run.status})`);
});
console.log('');

// 3️⃣ Demander confirmation (simulation)
console.log(`⚠️  Vous êtes sur le point de supprimer ${orphanCount} runs orphelins.`);
console.log('🗑️  Suppression en cours...\n');

// 4️⃣ Supprimer
await sequelize.query(`
  DELETE FROM publish_runs
  WHERE "jobId" NOT IN (SELECT id FROM publish_jobs)
`);

console.log(`✅ ${orphanCount} runs orphelins supprimés avec succès!\n`);

// 5️⃣ Vérification finale
const [verifyResult] = await sequelize.query(`
  SELECT COUNT(*) as count
  FROM publish_runs pr
  LEFT JOIN publish_jobs pj ON pr."jobId" = pj.id
  WHERE pj.id IS NULL
`);

const remainingOrphans = parseInt(verifyResult[0].count, 10);

if (remainingOrphans === 0) {
  console.log('✅ Nettoyage terminé! Base de données propre.');
  console.log('👉 Vous pouvez maintenant redémarrer l\'app avec constraints: true\n');
} else {
  console.warn(`⚠️  Attention: Il reste ${remainingOrphans} runs orphelins`);
}

await sequelize.close();
process.exit(0);
} catch (error) {
console.error('❌ Erreur lors du nettoyage:');
console.error(error.message);
console.error('\n💡 Vérifiez que:');
console.error('   - PostgreSQL est démarré');
console.error('   - Les variables DB_* dans .env sont correctes');
console.error('   - La base de données existe\n');
process.exit(1);
}
}
