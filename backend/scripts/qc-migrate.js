// scripts/qc-migrate.js
// CLI de migration du schéma qc (et de lui seul).
//
// Usage :
//   node scripts/qc-migrate.js up        # applique les migrations en attente
//   node scripts/qc-migrate.js down      # annule la dernière migration
//   node scripts/qc-migrate.js down-all  # annule tout + DROP SCHEMA qc (rollback complet)
//   node scripts/qc-migrate.js status    # liste exécutées / en attente
//
// Prérequis : la base doit déjà contenir public.users (l'app a démarré au moins une fois),
// car qc.jobs / qc.runs portent une FK vers public.users(id).

require('dotenv').config();
const qcMigrator = require('../src/config/qcMigrator');
const { sequelize } = require('../src/config/database');

async function main() {
  const cmd = (process.argv[2] || 'status').toLowerCase();

  switch (cmd) {
    case 'up': {
      const applied = await qcMigrator.migrateUp();
      console.log(applied.length ? `Migrations appliquées: ${applied.join(', ')}` : 'Aucune migration en attente.');
      break;
    }
    case 'down': {
      const reverted = await qcMigrator.migrateDown();
      console.log(reverted.length ? `Migrations annulées: ${reverted.join(', ')}` : 'Rien à annuler.');
      break;
    }
    case 'down-all': {
      const reverted = await qcMigrator.migrateDownAll();
      console.log(`Migrations annulées: ${reverted.join(', ') || '(aucune)'} — schéma qc supprimé.`);
      break;
    }
    case 'status': {
      const s = await qcMigrator.status();
      console.log(`Exécutées: ${s.executed.join(', ') || '(aucune)'}`);
      console.log(`En attente: ${s.pending.join(', ') || '(aucune)'}`);
      break;
    }
    default:
      console.error(`Commande inconnue: ${cmd} (attendu: up | down | down-all | status)`);
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(`Erreur migration qc: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
    // Sortie explicite : le handler beforeExit de src/config/database.js re-fermerait
    // la connexion en boucle dans un process court (il est pensé pour le serveur).
    process.exit(process.exitCode || 0);
  });
