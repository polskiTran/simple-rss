import { systemClock } from './clock.js'
import { loadConfig } from './config.js'
import { runCli } from './cli.js'

/** Executable wrapper around `runCli`, kept separate so tests can skip it. */
process.exitCode = await runCli(process.argv.slice(2), {
  config: loadConfig(),
  clock: systemClock,
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
})
