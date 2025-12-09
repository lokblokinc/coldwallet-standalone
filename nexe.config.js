module.exports = {
  input: 'server.js',
  output: 'dist/coldwallet-win.exe',
  targets: ['windows-x64-18.5.0'],
  resources: [
    'views/**/*',
    'public/**/*',
    'models/**/*',
    'config/**/*',
    'node_modules/ejs/**/*',
    'node_modules/ejs-mate/**/*'
  ],
  native: {
    sqlite3: {
      modulePath: 'node_modules/sqlite3',
      nodeGypBuild: true
    }
  }
};
