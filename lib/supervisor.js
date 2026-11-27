'use strict';
/**
 * Kleiner Wächter: startet den eigentlichen Server als Kindprozess und startet ihn neu, wenn er mit
 * Code 75 endet (z. B. nach „Sicherung einspielen“ oder „Daten übernehmen“). So muss niemand das
 * Terminal-Fenster neu öffnen. Mit WOC_NO_SUPERVISOR=1 läuft der Server direkt (z. B. für node --watch).
 */
const { spawn } = require('child_process');

const RESTART = 75;

module.exports = function supervise(script) {
  if (process.env.WOC_CHILD || process.env.WOC_NO_SUPERVISOR || process.execArgv.some((a) => a.startsWith('--watch'))) return false;
  let child = null;
  let stopping = false;
  const start = () => {
    child = spawn(process.execPath, [...process.execArgv, script, ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, WOC_CHILD: '1' },
    });
    child.on('exit', (code, signal) => {
      if (!stopping && code === RESTART) {
        console.log('\n  ↻ Wall of Content startet neu …\n');
        setTimeout(start, 300);
        return;
      }
      process.exit(signal ? 1 : code ?? 0);
    });
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { stopping = true; if (child) child.kill(sig); });
  }
  start();
  return true;
};
module.exports.RESTART = RESTART;
