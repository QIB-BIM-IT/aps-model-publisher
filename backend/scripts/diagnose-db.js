// Script de diagnostic complet pour identifier le problème
require('dotenv').config();
const { sequelize } = require('../src/config/database');

async function diagnose() {
  try {
    console.log('🔌 Connexion à PostgreSQL...\n');
    await sequelize.authenticate();

    // 1️⃣ Vérifier les runs orphelins
    console.log('1️⃣ Vérification des runs orphelins:');
    const [orphans] = await sequelize.query(`
  SELECT COUNT(*) as count
  FROM publish_runs pr
  LEFT JOIN publish_jobs pj ON pr."jobId" = pj.id
  WHERE pj.id IS NULL
`);
    console.log(`   Runs orphelins: ${orphans[0].count}\n`);

    // 2️⃣ Vérifier les contraintes existantes
    console.log('2️⃣ Contraintes FK actuelles sur publish_runs:');
    const [constraints] = await sequelize.query(`
  SELECT
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.table_name = 'publish_runs' 
    AND tc.constraint_type = 'FOREIGN KEY'
`);

    if (constraints.length === 0) {
      console.log('   ❌ Aucune contrainte FK trouvée\n');
    } else {
      constraints.forEach(c => {
        console.log(`   ✅ ${c.constraint_name}: ${c.column_name} → ${c.foreign_table_name}.${c.foreign_column_name}`);
      });
      console.log('');
    }

    // 3️⃣ Compter les enregistrements
    console.log("3️⃣ Nombre d'enregistrements:");
    const [userCount] = await sequelize.query(`SELECT COUNT(*) as count FROM users`);
    const [jobCount] = await sequelize.query(`SELECT COUNT(*) as count FROM publish_jobs`);
    const [runCount] = await sequelize.query(`SELECT COUNT(*) as count FROM publish_runs`);

    console.log(`   Users: ${userCount[0].count}`);
    console.log(`   Jobs: ${jobCount[0].count}`);
    console.log(`   Runs: ${runCount[0].count}\n`);

    // 4️⃣ Vérifier les valeurs NULL dans les FK
    console.log('4️⃣ Vérification des valeurs NULL:');
    const [nullJobs] = await sequelize.query(`
  SELECT COUNT(*) as count FROM publish_runs WHERE "jobId" IS NULL
`);
    const [nullUsers] = await sequelize.query(`
  SELECT COUNT(*) as count FROM publish_runs WHERE "userId" IS NULL
`);

    console.log(`   Runs avec jobId NULL: ${nullJobs[0].count}`);
    console.log(`   Runs avec userId NULL: ${nullUsers[0].count}\n`);

    // 5️⃣ Vérifier l'intégrité des données
    console.log('5️⃣ Intégrité des données:');
    const [invalidJobIds] = await sequelize.query(`
  SELECT COUNT(*) as count
  FROM publish_runs pr
  WHERE pr."jobId" IS NOT NULL 
    AND NOT EXISTS (SELECT 1 FROM publish_jobs pj WHERE pj.id = pr."jobId")
`);

    const [invalidUserIds] = await sequelize.query(`
  SELECT COUNT(*) as count
  FROM publish_runs pr
  WHERE pr."userId" IS NOT NULL 
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = pr."userId")
`);

    console.log(`   Runs avec jobId invalide: ${invalidJobIds[0].count}`);
    console.log(`   Runs avec userId invalide: ${invalidUserIds[0].count}\n`);

    // 6️⃣ Afficher des exemples problématiques
    if (invalidJobIds[0].count > 0) {
      console.log('⚠️  Exemples de runs avec jobId invalide:');
      const [examples] = await sequelize.query(`
    SELECT pr.id, pr."jobId", pr.status, pr."createdAt"
    FROM publish_runs pr
    WHERE pr."jobId" IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM publish_jobs pj WHERE pj.id = pr."jobId")
    LIMIT 5
  `);
      examples.forEach(r => {
        console.log(`   - Run ${r.id.slice(0, 8)} → Job manquant: ${r.jobId.slice(0, 8)}`);
      });
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('🎯 RECOMMANDATION:\n');

    if (orphans[0].count > 0 || invalidJobIds[0].count > 0 || invalidUserIds[0].count > 0) {
      console.log('❌ Données invalides détectées!');
      console.log('👉 Exécutez: node scripts/force-cleanup.js\n');
    } else {
      console.log('✅ Données OK! Le problème vient de Sequelize sync.');
      console.log('👉 Solution: Désactivez temporairement DB_SYNC_ALTER\n');
    }

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

diagnose();
