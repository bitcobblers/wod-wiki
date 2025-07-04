import { ICodeFragment, FragmentType } from "../CodeFragment";
import { ICodeStatement } from "../CodeStatement";
import { EffortFragment } from "../fragments/EffortFragment";
import { ActionFragment } from "../fragments/ActionFragment";
import { IncrementFragment } from "../fragments/IncrementFragment";
import { LapFragment } from "../fragments/LapFragment";
import { RepFragment } from "../fragments/RepFragment";
import { ResistanceFragment } from "../fragments/ResistanceFragment";
import { DistanceFragment } from "../fragments/DistanceFragment";
import { RoundsFragment } from "../fragments/RoundsFragment";
import { TimerFragment } from "../fragments/TimerFragment";
import { MdTimerParse } from "./timer.parser";

export type GroupType = 'round' | 'compose' | 'repeat';

const parser = new MdTimerParse() as any;
const BaseCstVisitor = parser.getBaseCstVisitorConstructor();

export class MdTimerInterpreter extends BaseCstVisitor {
  constructor() {
    super();
    // This helper will detect any missing or redundant methods on this visitor
    this.validateVisitor();
  }

  /// High level entry point, contains any number of simple of compound timers.
  wodMarkdown(ctx: any) {
    try {
      if (!ctx || !Array.isArray(ctx.markdown)) {
        return [{ SyntaxError: "Invalid context: markdown array is required" }];
      }

      let blocks = ctx.markdown
        .filter((block: any) => block !== null && block !== undefined)
        .flatMap((block: any) => {
          try {
            return this.visit(block) || [];
          } catch (blockError) {
            return [
              { SyntaxError: "Error processing markdown block:", blockError },
            ];
          }
        }) as ICodeStatement[];
     
      let stack: { columnStart: number; block: ICodeStatement }[] = []; 
      for (let block of blocks) {
        const history = stack.filter(
          (item: any) => item.columnStart == block.meta.columnStart
        );

        stack = stack.filter(
          (item: any) => item.columnStart < block.meta.columnStart
        );

        block.id = block.meta.startOffset;
        if (block.children == undefined) {
          block.children = [];
        }

        if (stack.length > 0) {
          for (let parent of stack) {
            const lapFragments = block.fragments.filter(f => f.fragmentType === FragmentType.Lap);            
            parent.block.isLeaf = parent.block.isLeaf || lapFragments.length > 0;
            parent.block.children.push(block.id);
            block.parent = parent.block.id;
          }
        }
                
        stack.push({ columnStart: block.meta.columnStart, block });
      }

      return blocks;
    } catch (error) {
      return [
        {
          SyntaxError: `Error in wodMarkdown: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ];
    }
  }

  wodBlock(ctx: any): ICodeStatement {
    let statement = { fragments: [] as ICodeFragment[] } as ICodeStatement;
    const lapFragments = ctx.lap && this.visit(ctx.lap);
    statement.fragments.push(...(lapFragments || []));
    if (ctx.rounds) {
      statement.fragments.push(...this.visit(ctx.rounds));
    }

    // Trend Parsing
    if (ctx.trend) {
      statement.fragments.push(...this.visit(ctx.trend));
    } else if (ctx.duration) {
      statement.fragments.push(
        new IncrementFragment(
          "-",
          this.getMeta([ctx.duration[0].children.Timer[0]])
        )
      );
    }

    ctx.duration && statement.fragments.push(...this.visit(ctx.duration));
    ctx.action && statement.fragments.push(...this.visit(ctx.action));
    ctx.reps && statement.fragments.push(...this.visit(ctx.reps));
    ctx.effort && statement.fragments.push(...this.visit(ctx.effort));
    ctx.resistance && statement.fragments.push(...this.visit(ctx.resistance));
    ctx.distance && statement.fragments.push(...this.visit(ctx.distance));

    statement.meta = this.combineMeta(
      statement.fragments.map((fragment: any) => fragment.meta)
    );
    statement.id = statement.meta.startOffset;
        
    // Lap fragment logic  
    // If statement is a child (has parent) and no lap fragment, add a repeat LapFragment
    if (lapFragments?.length === 0 && statement.parent !== undefined) {
      const meta = {
        line: statement.meta.line,
        startOffset: statement.meta.startOffset,
        endOffset: statement.meta.startOffset,
        columnStart: statement.meta.columnStart,
        columnEnd: statement.meta.columnStart,
        length: 1,
      };
      statement.fragments.push(new LapFragment('repeat', "", meta as any));
    }

    statement.isLeaf = statement.fragments.filter(f => f.fragmentType === FragmentType.Lap).length > 0;
    return statement;
  }
 
  action(ctx: any): ActionFragment[] {
    const meta = this.getMeta([ctx.ActionOpen[0], ctx.ActionClose[0]]);
    const action = ctx.Identifier.map(
      (identifier: any) => identifier.image
    ).join(" ");
    return [new ActionFragment(action, meta)];
  }


  lap(ctx: any): LapFragment[] {
    if (ctx.Plus) {
      const meta = this.getMeta([ctx.Plus[0]]);
      return [new LapFragment('compose', "+", meta)];
    }

    if (ctx.Minus) {
      const meta = this.getMeta([ctx.Minus[0]]);
      return [new LapFragment("round" ,"-", meta)];
    }

    return [];
  }

  trend(ctx: any): IncrementFragment[] {
    const meta = this.getMeta([ctx.Trend[0]]);
    return [new IncrementFragment(ctx.Trend[0].image, meta)];
  }

  reps(ctx: any): RepFragment[] {
    const meta = this.getMeta([ctx.Number[0]]);
    return [new RepFragment(ctx.Number[0].image * 1, meta)];
  }

  duration(ctx: any): TimerFragment[] {
    const meta = this.getMeta([ctx.Timer[0]]);
    return [new TimerFragment(ctx.Timer[0].image, meta)];
  }

  distance(ctx: any): DistanceFragment[] {
    let load =
      (ctx.Number && ctx.Number.length > 0 && ctx.Number[0].image) || "1";
    let units = (ctx.Distance && ctx.Distance[0].image) || "";
    let meta = [ctx.Number[0], ctx.Distance[0]];
    return [new DistanceFragment(load, units, this.getMeta(meta))];
  }

  resistance(ctx: any): ResistanceFragment[] {
    let load =
      (ctx.Number && ctx.Number.length > 0 && ctx.Number[0].image) || "1";
    let units = (ctx.Weight && ctx.Weight[0].image) || "";

    let meta = [ctx.Number[0], ctx.Weight[0]];
    return [new ResistanceFragment(load, units, this.getMeta(meta))];
  }

  labels(ctx: any) {
    return [ctx.label.Map((identifier: any) => identifier.image), ctx.label];
  }

  effort(ctx: any): EffortFragment[] {
    const effort = ctx.Identifier.map(
      (identifier: any) => identifier.image
    ).join(" ");
    return [new EffortFragment(effort, this.getMeta(ctx.Identifier))];
  }

  rounds(ctx: any): ICodeFragment[] {
    const meta = this.getMeta([ctx.GroupOpen[0], ctx.GroupClose[0]]);
    const groups = this.visit(ctx.sequence[0]);
    
    if (groups.length == 1) {
      return [new RoundsFragment(groups[0], meta)];
    }

    return [
      new RoundsFragment(groups.length, meta),
      ...groups.map((group: any) => new RepFragment(group, meta)),
    ];
  }

  sequence(ctx: any): number[] {
    return ctx.Number.map((identifier: any) => identifier.image * 1);
  }

  combineMeta(meta: any[]) {
    if (meta.length == 0) {
      return {
        line: 0,
        startOffset: 0,
        endOffset: 0,
        columnStart: 0,
        columnEnd: 0,
        length: 0,
      };
    }
    const sorted = meta
      .filter((item: any) => item != undefined)
      .map((item: any) => ({ ...item, ...item.meta }))
      .sort((a: any, b: any) => a.startOffset - b.startOffset);
    const columnEnd = sorted[sorted.length - 1].columnEnd;
    const columnStart = sorted[0].columnStart;
    return {
      line: sorted[0].line,
      startOffset: sorted[0].startOffset,
      endOffset: sorted[sorted.length - 1].endOffset,
      columnStart: columnStart,
      columnEnd: columnEnd,
      length: columnEnd - columnStart,
    };
  }

  getMeta(tokens: any[]) {
    const endToken = tokens[tokens.length - 1];
    return {
      line: tokens[0].startLine,
      startOffset: tokens[0].startOffset,
      endOffset: endToken.endOffset,
      columnStart: tokens[0].startColumn,
      columnEnd: endToken.endColumn,
      length: endToken.endColumn - tokens[0].startColumn,
    };
  }
}
