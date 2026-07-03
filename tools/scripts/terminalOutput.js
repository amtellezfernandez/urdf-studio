export const TERMINAL_COLORS = Object.freeze({
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  pink: '\x1b[35m',
  pinkBright: '\x1b[95m',
  pinkLight: '\x1b[38;5;213m',
  pinkDark: '\x1b[38;5;162m',
  purple: '\x1b[38;5;129m',
  purpleBright: '\x1b[38;5;141m',
  purpleLight: '\x1b[38;5;183m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  underline: '\x1b[4m',
});

export function createTerminalLogger({
  colors = TERMINAL_COLORS,
  writeLine = console.log,
} = {}) {
  const log = (message, color = colors.reset) => {
    writeLine(`${color}${message}${colors.reset}`);
  };

  return {
    colors,
    log,
    logArrow: (message) => log(`→ ${message}`, colors.pink),
    logInfo: (message) => log(`  ${message}`, colors.gray),
    logSuccess: (message) => log(`✓ ${message}`, colors.green),
    logUrl: (url, text) =>
      log(`  ${text}: ${colors.pinkBright}${colors.underline}${url}${colors.reset}`),
  };
}
