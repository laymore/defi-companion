import * as webllm from "@mlc-ai/web-llm";

export type EngineStatus = {
  status: string;
  progress: number;
};

let engine: webllm.MLCEngine | null = null;

export async function getLocalEngine(onProgress?: (status: EngineStatus) => void) {
  if (engine) return engine;

  const modelId = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"; // Mô hình siêu nhẹ phù hợp local
  
  engine = await webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      if (onProgress) {
        onProgress({
          status: report.text,
          progress: report.progress
        });
      }
    }
  });

  return engine;
}

export async function chatLocal(text: string, systemPrompt: string) {
  if (!engine) throw new Error("Local AI chưa được khởi tạo.");

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text }
  ];

  const reply = await engine.chat.completions.create({
    messages,
  });

  return reply.choices[0].message.content || "";
}
