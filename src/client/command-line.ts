const SAFE_ARGUMENT = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const WHITESPACE = /\s/u;

interface ParseState {
  argument: string;
  argumentStarted: boolean;
  escaping: boolean;
  quote: "double" | "single" | null;
}

const quoteArgument = (argument: string): string => {
  if (argument === "") {
    return "''";
  }
  if (SAFE_ARGUMENT.test(argument)) {
    return argument;
  }
  return `'${argument.replaceAll("'", `'"'"'`)}'`;
};

export const formatCommandLine = (argv: string[]): string =>
  argv.map(quoteArgument).join(" ");

const consumeEscaped = (state: ParseState, character: string): boolean => {
  if (!state.escaping) {
    return false;
  }
  state.argument += character;
  state.argumentStarted = true;
  state.escaping = false;
  return true;
};

const consumeQuoted = (state: ParseState, character: string): boolean => {
  if (state.quote === "single") {
    if (character === "'") {
      state.quote = null;
    } else {
      state.argument += character;
    }
    return true;
  }
  if (state.quote !== "double") {
    return false;
  }
  if (character === '"') {
    state.quote = null;
  } else if (character === "\\") {
    state.escaping = true;
  } else {
    state.argument += character;
  }
  return true;
};

const consumeUnquoted = (
  state: ParseState,
  character: string,
  argv: string[]
): void => {
  if (WHITESPACE.test(character)) {
    if (state.argumentStarted) {
      argv.push(state.argument);
      state.argument = "";
      state.argumentStarted = false;
    }
    return;
  }
  state.argumentStarted = true;
  if (character === "'") {
    state.quote = "single";
  } else if (character === '"') {
    state.quote = "double";
  } else if (character === "\\") {
    state.escaping = true;
  } else {
    state.argument += character;
  }
};

export const parseCommandLine = (value: string): string[] => {
  const argv: string[] = [];
  const state: ParseState = {
    argument: "",
    argumentStarted: false,
    escaping: false,
    quote: null,
  };

  for (const character of value.trim()) {
    if (consumeEscaped(state, character)) {
      continue;
    }
    if (consumeQuoted(state, character)) {
      continue;
    }
    consumeUnquoted(state, character, argv);
  }
  if (state.escaping) {
    throw new Error("Command cannot end with an escape character");
  }
  if (state.quote) {
    throw new Error(`Command has an unclosed ${state.quote} quote`);
  }
  if (state.argumentStarted) {
    argv.push(state.argument);
  }
  return argv;
};
