import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from '../grammar/parser';
import { whiteboardScriptCompletion } from './completion';
import type { WhiteboardScriptCompletionOptions } from './completion';

export const whiteboardScriptLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        Identifier: t.variableName,
        String: t.string,
        Number: t.number,
        "schemeNumber schemeSpaced": t.number,
        Timer: t.keyword,
        collectibleTimer: t.keyword,
        textComment: t.lineComment,
        heading: t.heading,
        minus: t.operator,
        plus: t.operator,
        trend: t.operator,
        atSign: t.operator,
        "Slash/slash": t.operator,
        question: t.keyword,
        actionOpen: t.bracket,
        actionClose: t.bracket,
        groupOpen: t.bracket,
        groupClose: t.bracket,
        colon: t.punctuation,
        Property: t.propertyName,
        "Block/Lap": t.keyword,
      })
    ]
  }),
  languageData: {
    commentTokens: { line: "//" },
    closeBrackets: { brackets: ["(", "[", "'", '"'] },
  }
});

/**
 * Whiteboard Script language support with syntax-aware completion attached.
 *
 * @param options Optional completion configuration (sport, catalog callbacks).
 *   Omit for the default provider; pass `whiteboardScriptLanguage` instead when
 *   a host composes its own completion sources.
 */
export function whiteboardScript(options?: WhiteboardScriptCompletionOptions) {
  return new LanguageSupport(whiteboardScriptLanguage, whiteboardScriptCompletion(options ?? {}));
}
