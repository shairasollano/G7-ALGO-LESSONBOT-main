import { useState } from "react";
import type { AlgorithmTrace } from "@shared/contract";
import { IconArrowLeft, IconArrowRight, IconRestart } from "../icons";
import { GraphBlock } from "./GraphBlock";
import { TableBlock } from "./TableBlock";

interface TraceBlockProps {
  trace: AlgorithmTrace;
}

export function TraceBlock({ trace }: TraceBlockProps) {
  const [step, setStep] = useState(0);
  const total = trace.steps.length;
  const current = trace.steps[Math.min(step, total - 1)];

  const goTo = (n: number) => setStep(Math.max(0, Math.min(n, total - 1)));

  return (
    <div className="block trace-block">
      <div className="trace-header">
        <span className="trace-title">{trace.title}</span>
        <span className="trace-algo-id">{trace.algorithmId}</span>
      </div>

      {/* Result summary — computed by the solver, shown before the trace. */}
      <div className="trace-result" aria-label="Computed result">
        <span className="trace-result-label">Result</span>
        <code className="trace-result-value">
          {Object.entries(trace.result)
            .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
            .join(", ")}
        </code>
      </div>
      {trace.guarantee && (
        <p className="trace-guarantee">
          <strong>Guarantee:</strong> {trace.guarantee}
        </p>
      )}
      <p className="trace-complexity">
        <strong>Complexity:</strong> time {trace.complexity.time} · space {trace.complexity.space}
        {trace.seed !== undefined && <> · seed {trace.seed}</>}
      </p>
      {trace.warnings?.map((w, i) => (
        <p key={i} className="trace-warning">{w}</p>
      ))}

      {/* Step controls */}
      <div className="trace-controls" role="group" aria-label="Trace step controls">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
          aria-label="Previous step"
          title="Previous step"
        >
          <IconArrowLeft size={15} />
          Prev
        </button>
        <span className="trace-step-indicator" aria-live="polite">
          Step {current.step} of {total}
        </span>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => goTo(step + 1)}
          disabled={step >= total - 1}
          aria-label="Next step"
          title="Next step"
        >
          Next
          <IconArrowRight size={15} />
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => goTo(0)}
          aria-label="Reset to first step"
          title="Reset to the first step"
        >
          <IconRestart size={15} />
          Reset
        </button>
      </div>

      {/* Current step explanation */}
      <div className="trace-step">
        <h4 className="trace-step-title">{current.title}</h4>
        <p className="trace-step-desc">{current.description}</p>
        {current.table && <TableBlock columns={current.table.columns} rows={current.table.rows} caption={current.table.caption} />}
      </div>

      {/* Graph snapshot at this step */}
      {current.graph && <GraphBlock graphId={`${trace.algorithmId}-${current.step}`} data={current.graph} caption={`State at step ${current.step}`} />}

      {/* Full step table */}
      <details className="trace-all-steps">
        <summary>All steps ({total})</summary>
        <ol className="trace-step-list">
          {trace.steps.map((s) => (
            <li key={s.step}>
              <strong>{s.title}.</strong> {s.description}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
