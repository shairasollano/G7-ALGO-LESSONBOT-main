import type { ChatBlock } from "@shared/contract";
import { TextBlock } from "./TextBlock";
import { MathBlock } from "./MathBlock";
import { CalloutBlock } from "./CalloutBlock";
import { GraphBlock } from "./GraphBlock";
import { TableBlock } from "./TableBlock";
import { ChartBlock } from "./ChartBlock";
import { TraceBlock } from "./TraceBlock";
import { QuizBlock } from "./QuizBlock";
import { SourceReferenceBlock } from "./SourceReferenceBlock";

export function BlockRenderer({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <div className="blocks">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return <TextBlock key={i} markdown={block.markdown} />;
          case "math":
            return <MathBlock key={i} latex={block.latex} displayMode={block.displayMode} />;
          case "callout":
            return <CalloutBlock key={i} variant={block.variant} title={block.title} markdown={block.markdown} />;
          case "graph":
            return <GraphBlock key={i} graphId={block.graphId} data={block.data} caption={block.caption} />;
          case "table":
            return <TableBlock key={i} columns={block.columns} rows={block.rows} caption={block.caption} />;
          case "chart":
            return <ChartBlock key={i} chartType={block.chartType} data={block.data} caption={block.caption} />;
          case "algorithm_trace":
            return <TraceBlock key={i} trace={block.trace} />;
          case "quiz":
            return <QuizBlock key={i} quiz={block.quiz} />;
          case "source_reference":
            return <SourceReferenceBlock key={i} source={block.ref} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
