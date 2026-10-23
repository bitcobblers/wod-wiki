import { IRuntimeBlockStrategy } from "../../../contracts/IRuntimeBlockStrategy";
import { BlockBuilder } from "../../BlockBuilder";
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import type { IRuntimeContext } from "../../../contracts/IRuntimeContext";

import { SoundProfileBehavior } from "../../../behaviors";
import { resolveSoundProfile } from "../../../sound/resolveSoundProfile";

/**
 * SoundStrategy attaches the block's sound cues.
 *
 * Unlike the strategies it replaces, this one carries no hardcoded cues. The
 * cues come from a **sound profile** — a user-defined set of rules mapping
 * trigger points to sounds — resolved here at compile time:
 *
 * 1. A `sound` metric on the block's own statements (the line-level
 *    selection) wins.
 * 2. Otherwise the note-level selection, passed in by the host.
 * 3. Otherwise the default profile.
 *
 * The resolved profile's rules are handed to {@link SoundProfileBehavior},
 * which fires them at their trigger points.
 */
export class SoundStrategy implements IRuntimeBlockStrategy {
    priority = 20;
    readonly id = 'sound';

    match(statements: ICodeStatement[], _runtime: IRuntimeContext): boolean {
        return statements.length > 0;
    }

    apply(builder: BlockBuilder, statements: ICodeStatement[], runtime: IRuntimeContext): void {
        if (builder.hasBehavior(SoundProfileBehavior)) {
            return;
        }

        // Only blocks with a timeline carry cues — a rule is expressed
        // relative to the block's own duration, so a block without one has
        // nothing to count down from.
        if (!builder.hasTimerBehavior()) {
            return;
        }

        const profile = resolveSoundProfile(statements, runtime.options?.soundOptions);
        builder.addBehavior(new SoundProfileBehavior({ profile }));
    }
}
