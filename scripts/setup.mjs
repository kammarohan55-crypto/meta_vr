import { npmCommand, requireSupportedNode, run } from './project.mjs';

try {
  requireSupportedNode();
  console.log('Installing the locked project dependencies…');
  await run(...npmCommand(['ci']));
  await run(...npmCommand(['run', 'doctor']));
  await run(...npmCommand(['run', 'typecheck']));
  console.log('\nReady. Run npm run dev:all to open the game and multiplayer server.');
} catch (error) {
  console.error(`Setup stopped: ${error.message}`);
  process.exitCode = 1;
}
