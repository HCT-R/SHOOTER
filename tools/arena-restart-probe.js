/* Compare equivalent rendered states after warmup, so visibility changes
   cannot conceal a growing resource baseline during arena teardown. */
module.exports = function arenaRestartProbe() {
  const results = [];
  for (const mode of ['ffa', 'royale']) {
    const samples = [];
    for (let round = 0; round < 10; round++) {
      game.startRun(4271, mode, { botCount: 31 });
      for (let frame = 0; frame < 220; frame++) game.update(1 / 60);
      game.render();
      samples.push({ geometry: game.renderer.info.memory.geometries, textures: game.renderer.info.memory.textures,
        actors: game.arena.participants.size, loot: game.arena.visualLoot.size, projectiles: game.arena.visualProjectiles.size });
    }
    const reference = JSON.stringify(samples[1]);
    if (samples.slice(2).some(sample => JSON.stringify(sample) !== reference)) throw Error(mode + ': restart resource baseline changed: ' + JSON.stringify(samples));
    results.push({ mode, restarts: samples.length, resources: samples.at(-1) });
  }
  game.network.returnToLobby();
  return results;
};
