import { Lexer, createToken } from "chevrotain";

export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

export const Return = createToken({
  name: "Return",
  pattern: /\s*\r?\n/,
});

export const Minus = createToken({
  name: "Minus",
  pattern: /\-/,
});

export const Plus = createToken({
  name: "Plus",
  pattern: /\+/,
});

export const Timer = createToken({
  name: "Timer",
  pattern: /(?::\d+|(?:\d+:){1,3}\d+)/,
});

export const Distance = createToken({
  name: "Distance",
  pattern: /(m|ft|mile|km|miles)\b/i,
});
export const Weight = createToken({
  name: "Weight",
  pattern: /(kg|lb|bw)\b/i,
});

export const Collon = createToken({
  name: "Collon",
  pattern: /:/,
});

export const  AllowedSymbol = createToken({
  name: "AllowedSymbol",
  pattern: /[\\\/.,@!$%^*=&]+/,
  // pick up anything that isn't whitespace, a digit, or a "special" character
});
export const AtSign = createToken({
  name: "AtSign",
  pattern: /@/,
});

export const QuestionSymbol = createToken({
  name: "QuestionSymbol",
  pattern: /\?/,
});

export const Number = createToken({
  name: "Number",
  pattern: /\d*\.?\d+/,
});

export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-zA-Z]\w*/,
});

export const Comma = createToken({
  
  name: "Comma",
  pattern: /,/,
});

export const Trend = createToken({
  name: "Trend",
  pattern: Lexer.NA,
});

export const Up = createToken({
  name: "Up",
  pattern: /\^/,
  categories: Trend,
});

export const ActionOpen = createToken({
  name: "ActionOpen",
  pattern: /\[/,
});

export const ActionClose = createToken({
  name: "ActionClose",
  pattern: /\]/,
});

export const GroupOpen = createToken({
  name: "GroupOpen",
  pattern: /\(/,
});
export const GroupClose = createToken({
  name: "GroupClose",
  pattern: /\)/,
});

export const allTokens = [  
  Return,
  WhiteSpace,
  // "keywords" appear before the Identifier
  ActionOpen,
  ActionClose,
  GroupOpen,
  GroupClose,
  Comma,
  AtSign,
  Timer,
  Trend,    
  Collon,  
  Up,
  Minus,
  Plus,
  Weight,
  Distance,
  QuestionSymbol,
  AllowedSymbol,
  Identifier,
  Number,
];
