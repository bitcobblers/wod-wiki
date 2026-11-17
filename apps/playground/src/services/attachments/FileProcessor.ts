import { IAttachmentStrategy, AttachmentMetadata } from './IAttachmentStrategy';
import { defaultAttachmentStrategy } from './DefaultAttachmentStrategy';
import { gpxAttachmentStrategy } from './GpxAttachmentStrategy';
import { jsonAttachmentStrategy } from './JsonAttachmentStrategy';

export class FileProcessor {
  private readonly strategies: IAttachmentStrategy[];

  constructor(strategies: IAttachmentStrategy[] = [gpxAttachmentStrategy, jsonAttachmentStrategy, defaultAttachmentStrategy]) {
    this.strategies = strategies;
  }

  /**
   * Processes a dropped file by trying a set of strategies.
   */
  async process(file: File): Promise<AttachmentMetadata> {
    for (const strategy of this.strategies) {
      if (await strategy.canProcess(file)) {
        console.log(`[FileProcessor] Using strategy: ${strategy.name}`);
        try {
          return await strategy.process(file);
        } catch (e) {
          console.error(`[FileProcessor] Strategy ${strategy.name} failed:`, e);
          // Continue to next strategy if one fails
        }
      }
    }
    // Fallback if all else fails (should not happen with default strategy)
    return defaultAttachmentStrategy.process(file);
  }
}

export const fileProcessor = new FileProcessor();
