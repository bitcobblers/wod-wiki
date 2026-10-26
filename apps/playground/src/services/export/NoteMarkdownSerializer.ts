import type { INowProvider } from '@bitcobblers/wod-wiki-engine';
import type { HistoryRecord } from '@/types/history';

export function noteToMarkdown(entry: HistoryRecord, _clock?: INowProvider): string {
    const metadata = [
        `# ${entry.title}`,
        '',
        '## Metadata',
        '',
        `- **ID**: ${entry.id}`,
        `- **Created**: ${new Date(entry.createdAt).toISOString()}`,
        `- **Updated**: ${new Date(entry.updatedAt).toISOString()}`,
        `- **Target Date**: ${new Date(entry.targetDate).toISOString()}`,
        `- **Tags**: ${entry.tags.join(', ') || 'None'}`,
    ];

    if (entry.sourceRevision !== undefined) metadata.push(`- **Source Revision**: ${entry.sourceRevision}`);
    if (entry.blocks) metadata.push(`- **Blocks**: ${JSON.stringify(entry.blocks)}`);
    if (entry.sourceId) {
        metadata.push(`- **Cloned From**: ${entry.sourceId}`);
    }

    metadata.push('', '## Content', '', entry.rawContent);

    return metadata.join('\n');
}
