// backend/scripts/force-cleanup.js
// Nettoyage forcé: supprime les contraintes, nettoie les données, recrée les contraintes
require('dotenv').config();
const { sequelize } = require('../src/config/database');

async function forceCleanup() {
  try {
    console.log('🔧 Nettoyage forcé de la base de données\n');
    await sequelize.authenticate();

    // 1️⃣ SUPPRIMER toutes les contraintes FK sur publish_runs
    console.log('1️⃣ Suppression des contraintes FK...');
    await sequelize.query(`
      DO $$ 
      DECLARE
        constraint_record RECORD;
      BEGIN
        FOR constraint_record IN 
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = 'publish_runs' 
            AND constraint_type = 'FOREIGN KEY'
        LOOP
          EXECUTE 'ALTER TABLE publish_runs DROP CONSTRAINT IF EXISTS ' || constraint_record.constraint_name;
        END LOOP;
      END $$;
    `);
    console.log('   ✅ Contraintes supprimées\n');

    // 2️⃣ NETTOYER les données orphelines
    console.log('2️⃣ Nettoyage des données orphelines...');

    // Runs avec jobId invalide
    const [deletedJobs] = await sequelize.query(`
      DELETE FROM publish_runs
      WHERE "jobId" IS NOT NULL 
        AND NOT EXISTS (SELECT 1 FROM publish_jobs WHERE id = publish_runs."jobId")
    `);
    console.log(`   🗑️  ${deletedJobs.rowCount || 0} runs avec jobId invalide supprimés`);

    // Runs avec userId invalide
    const [deletedUsers] = await sequelize.query(`
      DELETE FROM publish_runs
      WHERE "userId" IS NOT NULL 
        AND NOT EXISTS (SELECT 1 FROM users WHERE id = publish_runs."userId")
    `);
    console.log(`   🗑️  ${deletedUsers.rowCount || 0} runs avec userId invalide supprimés\n`);

    // 3️⃣ RECRÉER les contraintes FK avec CASCADE
    console.log('3️⃣ Recréation des contraintes FK...');

    await sequelize.query(`
      ALTER TABLE publish_runs
      ADD CONSTRAINT publish_runs_jobId_fkey
      FOREIGN KEY ("jobId") 
      REFERENCES publish_jobs(id)
      ON DELETE CASCADE
      ON UPDATE CASCADE;
    `);
    console.log('   ✅ Contrainte jobId créée');

    await sequelize.query(`
      ALTER TABLE publish_runs
      ADD CONSTRAINT publish_runs_userId_fkey
      FOREIGN KEY ("userId") 
      REFERENCES users(id)
      ON DELETE CASCADE
      ON UPDATE CASCADE;
    `);
    console.log('   ✅ Contrainte userId créée\n');

    // 4️⃣ Vérification finale
    console.log('4️⃣ Vérification finale...');
    const [orphans] = await sequelize.query(`
      SELECT COUNT(*) as count
      FROM publish_runs pr
      LEFT JOIN publish_jobs pj ON pr."jobId" = pj.id
      WHERE pj.id IS NULL
    `);

    if (parseInt(orphans[0].count, 10) === 0) {
      console.log('   ✅ Aucune donnée orpheline\n');
      console.log('='.repeat(60));
      console.log('🎉 Nettoyage terminé avec succès!');
      console.log("👉 Vous pouvez maintenant redémarrer l'application\n");
    } else {
      console.log(`   ⚠️  Il reste ${orphans[0].count} runs orphelins\n`);
    }

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

forceCleanup();
