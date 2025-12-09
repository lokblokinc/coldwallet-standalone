const { Sequelize } = require('sequelize');
const path = require('path');

// Detect if running from pkg
const isPkg = typeof process.pkg !== 'undefined';

// Use writable location for database
const dbDir = isPkg
  ? path.join(process.cwd(), 'data')
  : path.join(__dirname, '../data');

const dbPath = path.join(dbDir, 'database.sqlite');

console.log(`Database path: ${dbPath}`);

// Initialize Sequelize with SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
  pool: {
    max: 1,
    min: 0,
    acquire: 30000,
    idle: 5000
  }
});

module.exports = sequelize;
