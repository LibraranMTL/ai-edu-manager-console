export function renderTerminalMarkdown(markdown: unknown): string;
export const terminalMarkdownInternals: {
  escapeHtml(value: unknown): string;
  inlineMarkdown(value: unknown): string;
  splitMarkdownTableRow(value: unknown): string[];
  isMarkdownTableDivider(value: unknown): boolean;
};
