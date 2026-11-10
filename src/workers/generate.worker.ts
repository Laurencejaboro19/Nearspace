/// <reference lib="webworker" />
/**
 * Generation runs here so the page stays responsive: a 1000-compound run is tens of seconds of
 * solid cheminformatics, and the main thread still has to paint progress.
 */
import { generate, type GenerateOptions, type GenerateResult, type Progress } from "../chem/generate";

export type WorkerRequest = { type: "generate"; options: GenerateOptions };
export type WorkerResponse =
  | { type: "progress"; progress: Progress }
  | { type: "result"; result: GenerateResult }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data?.type !== "generate") return;
  try {
    const result = generate(event.data.options, (progress) => {
      (self as unknown as Worker).postMessage({ type: "progress", progress } satisfies WorkerResponse);
    });
    (self as unknown as Worker).postMessage({ type: "result", result } satisfies WorkerResponse);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Generation failed",
    } satisfies WorkerResponse);
  }
};
