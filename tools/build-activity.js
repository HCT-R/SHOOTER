const path = require('node:path');
require('./build.js');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, '../activity/discord.js')],
  outfile: path.join(__dirname, '../dist/discord.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true
});
console.log('built dist/discord.js (Discord Embedded App SDK)');
